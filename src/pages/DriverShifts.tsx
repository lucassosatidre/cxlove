import { useState, useEffect, useMemo } from 'react';
import { format, startOfWeek, addDays, isBefore, isToday, addWeeks, subWeeks, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Save, Settings2, CalendarDays } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

interface ShiftDay {
  date: Date;
  dateStr: string;
  dia: { vagas: number; inicio: string; fim: string; shiftId?: string; checkins: number };
  noite: { vagas: number; inicio: string; fim: string; shiftId?: string; checkins: number };
}

interface QuickConfig {
  vagasDia: number;
  inicioDia: string;
  fimDia: string;
  vagasNoite: number;
  inicioNoite: string;
  fimNoite: string;
  days: boolean[];
}

export default function DriverShifts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [weekData, setWeekData] = useState<ShiftDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showQuickConfig, setShowQuickConfig] = useState(false);
  const [quickConfig, setQuickConfig] = useState<QuickConfig>({
    vagasDia: 6, inicioDia: '11:00', fimDia: '15:00',
    vagasNoite: 6, inicioNoite: '18:00', fimNoite: '23:00',
    days: [true, true, true, true, true, true, true],
  });
  const [confirmDelete, setConfirmDelete] = useState<{ dayIdx: number; periodo: string; checkins: number } | null>(null);
  const [todayDrivers, setTodayDrivers] = useState<{ turno: string; nome: string; confirmedAt: string; status: string }[]>([]);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  // Initialize empty week
  useEffect(() => {
    const days: ShiftDay[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      days.push({
        date: d,
        dateStr: format(d, 'yyyy-MM-dd'),
        dia: { vagas: 0, inicio: '11:00', fim: '15:00', checkins: 0 },
        noite: { vagas: 0, inicio: '18:00', fim: '23:00', checkins: 0 },
      });
    }
    setWeekData(days);
    fetchWeekData(days);
  }, [weekStart]);

  const fetchWeekData = async (days: ShiftDay[]) => {
    setLoading(true);
    const startStr = days[0].dateStr;
    const endStr = days[6].dateStr;

    const { data: shifts } = await supabase
      .from('delivery_shifts')
      .select('*')
      .gte('data', startStr)
      .lte('data', endStr);

    const shiftIds = (shifts || []).map(s => s.id);
    let checkins: any[] = [];
    if (shiftIds.length > 0) {
      const { data } = await supabase
        .from('delivery_checkins')
        .select('shift_id, status, driver_id, confirmed_at')
        .in('shift_id', shiftIds)
        .eq('status', 'confirmado');
      checkins = data || [];
    }

    const checkinsByShift: Record<string, number> = {};
    checkins.forEach(c => {
      checkinsByShift[c.shift_id] = (checkinsByShift[c.shift_id] || 0) + 1;
    });

    const updated = days.map(day => {
      const copy = { ...day };
      const diaShift = (shifts || []).find(s => s.data === day.dateStr && s.periodo === 'dia');
      const noiteShift = (shifts || []).find(s => s.data === day.dateStr && s.periodo === 'noite');
      if (diaShift) {
        copy.dia = {
          vagas: diaShift.vagas,
          inicio: diaShift.horario_inicio?.slice(0, 5) || '11:00',
          fim: diaShift.horario_fim?.slice(0, 5) || '15:00',
          shiftId: diaShift.id,
          checkins: checkinsByShift[diaShift.id] || 0,
        };
      }
      if (noiteShift) {
        copy.noite = {
          vagas: noiteShift.vagas,
          inicio: noiteShift.horario_inicio?.slice(0, 5) || '18:00',
          fim: noiteShift.horario_fim?.slice(0, 5) || '23:00',
          shiftId: noiteShift.id,
          checkins: checkinsByShift[noiteShift.id] || 0,
        };
      }
      return copy;
    });
    setWeekData(updated);

    // Fetch today's confirmed drivers
    await fetchTodayDrivers(shifts || [], checkins);
    setLoading(false);
  };

  const fetchTodayDrivers = async (shifts: any[], checkins: any[]) => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todayShifts = shifts.filter(s => s.data === todayStr);
    if (todayShifts.length === 0) { setTodayDrivers([]); return; }

    const todayShiftIds = todayShifts.map(s => s.id);
    const todayCheckins = checkins.filter(c => todayShiftIds.includes(c.shift_id));
    if (todayCheckins.length === 0) { setTodayDrivers([]); return; }

    const driverIds = [...new Set(todayCheckins.map(c => c.driver_id))];
    const { data: drivers } = await supabase
      .from('delivery_drivers')
      .select('id, nome')
      .in('id', driverIds);

    const driverMap: Record<string, string> = {};
    (drivers || []).forEach(d => { driverMap[d.id] = d.nome; });

    const result = todayCheckins.map(c => {
      const shift = todayShifts.find(s => s.id === c.shift_id);
      return {
        turno: shift?.periodo === 'dia' ? 'Dia' : 'Noite',
        nome: driverMap[c.driver_id] || 'Desconhecido',
        confirmedAt: c.confirmed_at ? format(new Date(c.confirmed_at), 'HH:mm') : '-',
        status: c.status,
      };
    });
    setTodayDrivers(result);
  };

  const updateField = (dayIdx: number, periodo: 'dia' | 'noite', field: string, value: any) => {
    setWeekData(prev => {
      const copy = [...prev];
      copy[dayIdx] = {
        ...copy[dayIdx],
        [periodo]: { ...copy[dayIdx][periodo], [field]: value },
      };
      return copy;
    });
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      for (const day of weekData) {
        for (const periodo of ['dia', 'noite'] as const) {
          const shift = day[periodo];
          if (shift.vagas > 0) {
            const payload = {
              data: day.dateStr,
              periodo,
              vagas: shift.vagas,
              horario_inicio: shift.inicio || null,
              horario_fim: shift.fim || null,
              created_by: user.id,
            };
            if (shift.shiftId) {
              await supabase.from('delivery_shifts').update(payload).eq('id', shift.shiftId);
            } else {
              await supabase.from('delivery_shifts').insert(payload);
            }
          } else if (shift.shiftId && shift.vagas === 0) {
            if (shift.checkins > 0) {
              // Will be handled by confirmDelete dialog
              continue;
            }
            await supabase.from('delivery_shifts').delete().eq('id', shift.shiftId);
          }
        }
      }
      toast({ title: 'Configuração salva com sucesso' });
      // Re-fetch
      const days: ShiftDay[] = [];
      for (let i = 0; i < 7; i++) {
        const d = addDays(weekStart, i);
        days.push({
          date: d,
          dateStr: format(d, 'yyyy-MM-dd'),
          dia: { vagas: 0, inicio: '11:00', fim: '15:00', checkins: 0 },
          noite: { vagas: 0, inicio: '18:00', fim: '23:00', checkins: 0 },
        });
      }
      setWeekData(days);
      await fetchWeekData(days);
    } catch (err) {
      toast({ title: 'Erro ao salvar', variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleBeforeSave = () => {
    // Check if any shift with checkins is being set to 0
    for (let i = 0; i < weekData.length; i++) {
      for (const periodo of ['dia', 'noite'] as const) {
        const shift = weekData[i][periodo];
        if (shift.shiftId && shift.vagas === 0 && shift.checkins > 0) {
          setConfirmDelete({ dayIdx: i, periodo, checkins: shift.checkins });
          return;
        }
      }
    }
    handleSave();
  };

  const handleForceDeleteAndSave = async () => {
    if (!confirmDelete) return;
    const day = weekData[confirmDelete.dayIdx];
    const shift = day[confirmDelete.periodo as 'dia' | 'noite'];
    if (shift.shiftId) {
      await supabase.from('delivery_checkins').delete().eq('shift_id', shift.shiftId);
      await supabase.from('delivery_shifts').delete().eq('id', shift.shiftId);
    }
    setConfirmDelete(null);
    handleSave();
  };

  const applyQuickConfig = () => {
    setWeekData(prev => prev.map((day, idx) => {
      if (!quickConfig.days[idx]) return day;
      return {
        ...day,
        dia: { ...day.dia, vagas: quickConfig.vagasDia, inicio: quickConfig.inicioDia, fim: quickConfig.fimDia },
        noite: { ...day.noite, vagas: quickConfig.vagasNoite, inicio: quickConfig.inicioNoite, fim: quickConfig.fimNoite },
      };
    }));
    setShowQuickConfig(false);
    toast({ title: 'Padrão aplicado — confira e salve' });
  };

  const isPast = (date: Date) => isBefore(startOfDay(date), startOfDay(new Date())) && !isToday(date);

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <CalendarDays className="h-5 w-5" /> Escalas de Entregadores
            </h1>
            <p className="text-sm text-muted-foreground">Gerencie os turnos e vagas semanais</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowQuickConfig(true)}>
              <Settings2 className="h-4 w-4 mr-1" /> Aplicar padrão
            </Button>
            <Button size="sm" onClick={handleBeforeSave} disabled={saving || loading}>
              <Save className="h-4 w-4 mr-1" /> {saving ? 'Salvando...' : 'Salvar configuração'}
            </Button>
          </div>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => setWeekStart(s => subWeeks(s, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-foreground">
            Semana de {format(weekStart, 'dd/MM', { locale: ptBR })} a {format(weekEnd, 'dd/MM', { locale: ptBR })}
          </span>
          <Button variant="outline" size="icon" onClick={() => setWeekStart(s => addWeeks(s, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
            Hoje
          </Button>
        </div>

        {/* Weekly grid */}
        <div className="grid grid-cols-7 gap-2">
          {weekData.map((day, idx) => {
            const past = isPast(day.date);
            const today = isToday(day.date);
            return (
              <div
                key={day.dateStr}
                className={`rounded-lg border p-2 space-y-2 text-xs ${
                  past ? 'bg-muted/60 opacity-70' : today ? 'border-primary bg-primary/5' : 'bg-card'
                }`}
              >
                <div className="font-semibold text-foreground flex items-center justify-between">
                  <span>{format(day.date, 'dd/MM')} {DAY_LABELS[idx]}</span>
                  {today && <Badge variant="default" className="text-[9px] px-1.5 py-0">Hoje</Badge>}
                </div>

                {/* Turno Dia */}
                <ShiftBlock
                  label="☀️ Dia"
                  vagas={day.dia.vagas}
                  inicio={day.dia.inicio}
                  fim={day.dia.fim}
                  checkins={day.dia.checkins}
                  readOnly={past}
                  onVagasChange={v => updateField(idx, 'dia', 'vagas', v)}
                  onInicioChange={v => updateField(idx, 'dia', 'inicio', v)}
                  onFimChange={v => updateField(idx, 'dia', 'fim', v)}
                />

                {/* Turno Noite */}
                <ShiftBlock
                  label="🌙 Noite"
                  vagas={day.noite.vagas}
                  inicio={day.noite.inicio}
                  fim={day.noite.fim}
                  checkins={day.noite.checkins}
                  readOnly={past}
                  onVagasChange={v => updateField(idx, 'noite', 'vagas', v)}
                  onInicioChange={v => updateField(idx, 'noite', 'inicio', v)}
                  onFimChange={v => updateField(idx, 'noite', 'fim', v)}
                />
              </div>
            );
          })}
        </div>

        {/* Today summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Hoje — {format(new Date(), 'dd/MM', { locale: ptBR })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {todayDrivers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {weekData.find(d => isToday(d.date))?.dia.vagas || weekData.find(d => isToday(d.date))?.noite.vagas
                  ? 'Nenhuma confirmação ainda'
                  : 'Nenhum turno configurado para hoje'}
              </p>
            ) : (
              <div className="space-y-1">
                {todayDrivers.map((d, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm py-1 border-b last:border-0 border-border">
                    <Badge variant={d.turno === 'Dia' ? 'default' : 'secondary'} className="text-[10px]">{d.turno}</Badge>
                    <span className="font-medium text-foreground">{d.nome}</span>
                    <span className="text-muted-foreground text-xs">Confirmado às {d.confirmedAt}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick config dialog */}
      <Dialog open={showQuickConfig} onOpenChange={setShowQuickConfig}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Aplicar padrão na semana</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <p className="text-sm font-medium">☀️ Turno Dia</p>
                <label className="text-xs text-muted-foreground">Vagas</label>
                <Input type="number" min={0} value={quickConfig.vagasDia} onChange={e => setQuickConfig(p => ({ ...p, vagasDia: +e.target.value }))} />
                <label className="text-xs text-muted-foreground">Início</label>
                <Input type="time" value={quickConfig.inicioDia} onChange={e => setQuickConfig(p => ({ ...p, inicioDia: e.target.value }))} />
                <label className="text-xs text-muted-foreground">Fim</label>
                <Input type="time" value={quickConfig.fimDia} onChange={e => setQuickConfig(p => ({ ...p, fimDia: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">🌙 Turno Noite</p>
                <label className="text-xs text-muted-foreground">Vagas</label>
                <Input type="number" min={0} value={quickConfig.vagasNoite} onChange={e => setQuickConfig(p => ({ ...p, vagasNoite: +e.target.value }))} />
                <label className="text-xs text-muted-foreground">Início</label>
                <Input type="time" value={quickConfig.inicioNoite} onChange={e => setQuickConfig(p => ({ ...p, inicioNoite: e.target.value }))} />
                <label className="text-xs text-muted-foreground">Fim</label>
                <Input type="time" value={quickConfig.fimNoite} onChange={e => setQuickConfig(p => ({ ...p, fimNoite: e.target.value }))} />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Dias da semana</p>
              <div className="flex gap-3 flex-wrap">
                {DAY_LABELS.map((label, i) => (
                  <label key={i} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={quickConfig.days[i]}
                      onCheckedChange={c => setQuickConfig(p => {
                        const d = [...p.days];
                        d[i] = !!c;
                        return { ...p, days: d };
                      })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowQuickConfig(false)}>Cancelar</Button>
            <Button onClick={applyQuickConfig}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete with checkins */}
      <AlertDialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turno com confirmações</AlertDialogTitle>
            <AlertDialogDescription>
              Este turno já tem {confirmDelete?.checkins} confirmação(ões). Deseja realmente remover? As confirmações serão canceladas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleForceDeleteAndSave}>Remover mesmo assim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

function ShiftBlock({
  label, vagas, inicio, fim, checkins, readOnly,
  onVagasChange, onInicioChange, onFimChange,
}: {
  label: string;
  vagas: number;
  inicio: string;
  fim: string;
  checkins: number;
  readOnly: boolean;
  onVagasChange: (v: number) => void;
  onInicioChange: (v: string) => void;
  onFimChange: (v: string) => void;
}) {
  const active = vagas > 0;
  return (
    <div className={`rounded-md p-1.5 space-y-1 ${active ? 'bg-green-500/10 border border-green-500/30' : 'bg-muted/40 border border-border'}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        {active && (
          <Badge variant={checkins >= vagas ? 'default' : 'secondary'} className="text-[9px] px-1 py-0">
            {checkins}/{vagas}
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-1">
        <label className="text-muted-foreground w-10 shrink-0">Vagas</label>
        <Input
          type="number"
          min={0}
          max={20}
          value={vagas}
          onChange={e => onVagasChange(Math.max(0, +e.target.value))}
          disabled={readOnly}
          className="h-6 text-xs px-1.5 w-14"
        />
      </div>
      {active && (
        <div className="flex items-center gap-1">
          <Input type="time" value={inicio} onChange={e => onInicioChange(e.target.value)} disabled={readOnly} className="h-6 text-xs px-1 flex-1" />
          <span className="text-muted-foreground">—</span>
          <Input type="time" value={fim} onChange={e => onFimChange(e.target.value)} disabled={readOnly} className="h-6 text-xs px-1 flex-1" />
        </div>
      )}
    </div>
  );
}
