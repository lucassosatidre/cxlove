import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Phone, X, CheckCircle, Clock, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, startOfWeek, addDays, addWeeks, subWeeks, isToday, isBefore, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

interface ShiftCheckin {
  checkinId: string;
  driverName: string;
  driverPhone: string;
  confirmedAt: string | null;
  status: string;
  origin: string;
}

interface ShiftBlock {
  shiftId: string;
  horarioInicio: string;
  horarioFim: string;
  vagas: number;
  confirmados: ShiftCheckin[];
}

interface DayBlock {
  date: Date;
  dateStr: string;
  shifts: ShiftBlock[];
}

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function pillColor(status: string) {
  if (status === 'concluido' || status === 'confirmado') return 'bg-green-500 text-white';
  if (status === 'no_show') return 'bg-destructive text-white';
  return 'bg-muted text-muted-foreground';
}

export default function DriverTodaySection() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [weekData, setWeekData] = useState<DayBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailShift, setDetailShift] = useState<{ day: DayBlock; shift: ShiftBlock } | null>(null);
  const [actionDialog, setActionDialog] = useState<{
    type: 'no_show' | 'concluir';
    checkinId?: string;
    shiftId?: string;
    name?: string;
    horario?: string;
  } | null>(null);
  const [acting, setActing] = useState(false);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  const fetchWeek = useCallback(async () => {
    setLoading(true);
    const days: DayBlock[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      days.push({ date: d, dateStr: format(d, 'yyyy-MM-dd'), shifts: [] });
    }

    const { data: shifts } = await supabase
      .from('delivery_shifts')
      .select('id, data, horario_inicio, horario_fim, vagas')
      .gte('data', days[0].dateStr)
      .lte('data', days[6].dateStr)
      .order('horario_inicio');

    const shiftIds = (shifts || []).map(s => s.id);
    let checkins: any[] = [];
    if (shiftIds.length > 0) {
      const { data } = await supabase
        .from('delivery_checkins')
        .select('id, shift_id, driver_id, status, confirmed_at, origin')
        .in('shift_id', shiftIds)
        .in('status', ['confirmado', 'concluido', 'no_show']);
      checkins = data || [];
    }

    const driverIds = [...new Set(checkins.map(c => c.driver_id))];
    let driversMap: Record<string, { nome: string; telefone: string }> = {};
    if (driverIds.length > 0) {
      const { data: drivers } = await supabase
        .from('delivery_drivers')
        .select('id, nome, telefone')
        .in('id', driverIds);
      (drivers || []).forEach(d => { driversMap[d.id] = { nome: d.nome, telefone: d.telefone }; });
    }

    const updated = days.map(day => {
      const dayShifts = (shifts || []).filter(s => s.data === day.dateStr);
      return {
        ...day,
        shifts: dayShifts.map(s => ({
          shiftId: s.id,
          horarioInicio: s.horario_inicio?.slice(0, 5) || '',
          horarioFim: s.horario_fim?.slice(0, 5) || '',
          vagas: s.vagas,
          confirmados: checkins
            .filter(c => c.shift_id === s.id)
            .map(c => ({
              checkinId: c.id,
              driverName: driversMap[c.driver_id]?.nome || 'Desconhecido',
              driverPhone: driversMap[c.driver_id]?.telefone || '',
              confirmedAt: c.confirmed_at,
              status: c.status,
              origin: (c as any).origin || 'entregador',
            })),
        })),
      };
    });
    setWeekData(updated);
    setLoading(false);
  }, [weekStart]);

  useEffect(() => { fetchWeek(); }, [fetchWeek]);

  const handleNoShow = async () => {
    if (!actionDialog?.checkinId) return;
    setActing(true);
    const { error } = await supabase
      .from('delivery_checkins')
      .update({ status: 'no_show' })
      .eq('id', actionDialog.checkinId);
    if (error) toast.error('Erro ao marcar no-show');
    else { toast.success('Marcado como faltou'); fetchWeek(); }
    setActing(false);
    setActionDialog(null);
  };

  const handleConcluirTurno = async () => {
    if (!actionDialog?.shiftId) return;
    setActing(true);
    const allShifts = weekData.flatMap(d => d.shifts);
    const shift = allShifts.find(s => s.shiftId === actionDialog.shiftId);
    const toUpdate = (shift?.confirmados || [])
      .filter(c => c.status === 'confirmado')
      .map(c => c.checkinId);
    if (toUpdate.length === 0) { toast.info('Nenhum check-in para concluir'); setActing(false); setActionDialog(null); return; }
    const { error } = await supabase.from('delivery_checkins').update({ status: 'concluido' }).in('id', toUpdate);
    if (error) toast.error('Erro ao concluir turno');
    else { toast.success(`${toUpdate.length} presenças concluídas`); fetchWeek(); }
    setActing(false);
    setActionDialog(null);
  };

  const isPast = (date: Date) => isBefore(startOfDay(date), startOfDay(new Date())) && !isToday(date);
  const isShiftPast = (dateStr: string, horarioFim: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    if (isPast(d)) return true;
    if (isToday(d)) {
      const now = new Date();
      const [h, m] = horarioFim.split(':').map(Number);
      const end = new Date(); end.setHours(h, m, 0, 0);
      return now >= end;
    }
    return false;
  };

  // Compact today summary
  const todayData = weekData.find(d => isToday(d.date));
  const todayShifts = todayData?.shifts || [];

  if (loading) {
    return <Card><CardContent className="py-6 text-center text-muted-foreground text-sm">Carregando...</CardContent></Card>;
  }

  return (
    <TooltipProvider delayDuration={200}>
      {/* Compact Today card */}
      {todayShifts.length > 0 && (
        <Card className="border-l-4 border-l-primary mb-4">
          <CardContent className="py-3 px-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-semibold">Hoje {format(new Date(), 'dd/MM')}</span>
              {todayShifts.map(s => {
                const active = s.confirmados.filter(c => c.status === 'confirmado' || c.status === 'concluido').length;
                const faltas = s.confirmados.filter(c => c.status === 'no_show').length;
                return (
                  <span key={s.shiftId} className="text-muted-foreground">
                    {s.horarioInicio}-{s.horarioFim}: <span className="font-medium text-foreground">{active}/{s.vagas}</span>
                    {faltas > 0 && <span className="text-destructive ml-1">({faltas} falta{faltas > 1 ? 's' : ''})</span>}
                  </span>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Week navigation */}
      <div className="flex items-center gap-3 mb-3">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setWeekStart(s => subWeeks(s, 1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-medium">
          {format(weekStart, 'dd/MM', { locale: ptBR })} — {format(weekEnd, 'dd/MM', { locale: ptBR })}
        </span>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setWeekStart(s => addWeeks(s, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
          Hoje
        </Button>
      </div>

      {/* Weekly grid */}
      <div className="grid grid-cols-7 gap-1.5">
        {weekData.map((day, dayIdx) => {
          const past = isPast(day.date);
          const today = isToday(day.date);
          return (
            <div
              key={day.dateStr}
              className={`rounded-lg border p-2 text-xs transition-opacity min-h-[80px] ${
                past ? 'opacity-50 bg-muted/30' : today ? 'border-primary bg-primary/5' : 'bg-card'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-[11px]">
                  {format(day.date, 'dd/MM')} {DAY_LABELS[dayIdx]}
                </span>
                {today && <Badge variant="default" className="text-[8px] px-1 py-0 h-3.5">Hoje</Badge>}
              </div>

              {day.shifts.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">—</p>
              ) : day.shifts.map(shift => {
                const active = shift.confirmados.filter(c => c.status === 'confirmado' || c.status === 'concluido').length;
                const fillPct = shift.vagas > 0 ? Math.round((active / shift.vagas) * 100) : 0;
                const barColor = fillPct >= 100 ? 'bg-destructive' : fillPct > 75 ? 'bg-yellow-500' : 'bg-green-500';

                return (
                  <div
                    key={shift.shiftId}
                    className="mb-1.5 last:mb-0 cursor-pointer hover:bg-muted/50 rounded p-1 -mx-1 transition-colors"
                    onClick={() => setDetailShift({ day, shift })}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium">{shift.horarioInicio}—{shift.horarioFim}</span>
                      <span className="text-[9px] text-muted-foreground">{active}/{shift.vagas}</span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-muted overflow-hidden mt-0.5">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(fillPct, 100)}%` }} />
                    </div>
                    {shift.confirmados.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-1">
                        {shift.confirmados.map(c => (
                          <Tooltip key={c.checkinId}>
                            <TooltipTrigger asChild>
                              <span className={`inline-flex items-center justify-center rounded-full text-[8px] font-bold w-5 h-5 ${pillColor(c.status)}`}>
                                {getInitials(c.driverName)}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              <p className="font-medium">{c.driverName}</p>
                              <p className="text-muted-foreground">
                                {c.status === 'confirmado' ? 'Confirmado' : c.status === 'concluido' ? 'Concluído' : c.status === 'no_show' ? 'Faltou' : c.status}
                                
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Detail modal */}
      <Dialog open={!!detailShift} onOpenChange={() => setDetailShift(null)}>
        <DialogContent className="max-w-md">
          {detailShift && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">
                  {format(detailShift.day.date, "EEEE, dd/MM", { locale: ptBR })} — {detailShift.shift.horarioInicio} — {detailShift.shift.horarioFim}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {detailShift.shift.confirmados.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma confirmação</p>
                ) : detailShift.shift.confirmados.map(c => (
                  <div key={c.checkinId} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {c.driverName}
                        
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {c.driverPhone && (
                          <a href={`tel:${c.driverPhone.replace(/\D/g, '')}`} className="flex items-center gap-1 hover:text-primary">
                            <Phone className="h-3 w-3" /> {c.driverPhone}
                          </a>
                        )}
                        {c.confirmedAt && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {format(new Date(c.confirmedAt), 'HH:mm')}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {c.status === 'concluido' && <Badge variant="secondary" className="bg-blue-100 text-blue-700 text-[10px]">Concluído</Badge>}
                      {c.status === 'no_show' && <Badge variant="destructive" className="text-[10px]">Faltou</Badge>}
                      {c.status === 'confirmado' && (
                        <>
                          <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-[10px]">Confirmado</Badge>
                          {isShiftPast(detailShift.day.dateStr, detailShift.shift.horarioFim) && (
                            <Button
                              variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:bg-destructive/10"
                              title="Marcar falta"
                              onClick={() => setActionDialog({ type: 'no_show', checkinId: c.checkinId, name: c.driverName, horario: `${detailShift.shift.horarioInicio} — ${detailShift.shift.horarioFim}` })}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {isShiftPast(detailShift.day.dateStr, detailShift.shift.horarioFim) && detailShift.shift.confirmados.some(c => c.status === 'confirmado') && (
                <DialogFooter>
                  <Button
                    size="sm"
                    onClick={() => setActionDialog({ type: 'concluir', shiftId: detailShift.shift.shiftId, horario: `${detailShift.shift.horarioInicio} — ${detailShift.shift.horarioFim}` })}
                  >
                    <CheckCircle className="h-3.5 w-3.5 mr-1" /> Concluir turno
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Action dialog */}
      <Dialog open={!!actionDialog} onOpenChange={() => setActionDialog(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{actionDialog?.type === 'no_show' ? 'Marcar Falta?' : 'Concluir Turno?'}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {actionDialog?.type === 'no_show'
              ? `Marcar ${actionDialog.name} como falta no turno de ${actionDialog.horario}?`
              : `Marcar todos os confirmados do turno ${actionDialog?.horario} como concluídos?`}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setActionDialog(null)}>Cancelar</Button>
            <Button
              variant={actionDialog?.type === 'no_show' ? 'destructive' : 'default'}
              onClick={actionDialog?.type === 'no_show' ? handleNoShow : handleConcluirTurno}
              disabled={acting}
            >
              {acting ? 'Processando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
