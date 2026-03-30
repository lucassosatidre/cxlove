import { useState, useEffect, useMemo } from 'react';
import { format, startOfWeek, addDays, isBefore, isToday, addWeeks, subWeeks, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Save, Settings2, CalendarDays, Plus, Trash2, Clock, UserPlus, X } from 'lucide-react';
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
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

interface ShiftSlot {
  id?: string;
  horario_inicio: string;
  horario_fim: string;
  vagas: number;
  checkins: number;
  confirmedDrivers: { nome: string; confirmedAt: string }[];
}

interface DayData {
  date: Date;
  dateStr: string;
  shifts: ShiftSlot[];
}

interface QuickConfig {
  turnosQtd: number;
  turno1Inicio: string;
  turno1Fim: string;
  turno1Vagas: number;
  turno2Inicio: string;
  turno2Fim: string;
  turno2Vagas: number;
  days: boolean[];
}

export default function DriverShifts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [weekData, setWeekData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showQuickConfig, setShowQuickConfig] = useState(false);
  const [quickConfig, setQuickConfig] = useState<QuickConfig>({
    turnosQtd: 1, turno1Inicio: '19:00', turno1Fim: '23:00', turno1Vagas: 6,
    turno2Inicio: '11:00', turno2Fim: '15:00', turno2Vagas: 6,
    days: [true, true, true, true, true, true, true],
  });
  const [confirmDelete, setConfirmDelete] = useState<{ dayIdx: number; shiftIdx: number; checkins: number } | null>(null);
  const [editPopover, setEditPopover] = useState<{ dayIdx: number; shiftIdx: number } | null>(null);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  useEffect(() => {
    fetchWeekData();
  }, [weekStart]);

  const fetchWeekData = async () => {
    setLoading(true);
    const days: DayData[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekStart, i);
      days.push({ date: d, dateStr: format(d, 'yyyy-MM-dd'), shifts: [] });
    }

    const startStr = days[0].dateStr;
    const endStr = days[6].dateStr;

    const { data: shifts } = await supabase
      .from('delivery_shifts')
      .select('*')
      .gte('data', startStr)
      .lte('data', endStr)
      .order('horario_inicio', { ascending: true });

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

    // Fetch driver names for confirmed checkins
    const driverIds = [...new Set(checkins.map(c => c.driver_id))];
    let driverMap: Record<string, string> = {};
    if (driverIds.length > 0) {
      const { data: drivers } = await supabase
        .from('delivery_drivers')
        .select('id, nome')
        .in('id', driverIds);
      (drivers || []).forEach(d => { driverMap[d.id] = d.nome; });
    }

    // Group checkins by shift
    const checkinsByShift: Record<string, { count: number; drivers: { nome: string; confirmedAt: string }[] }> = {};
    checkins.forEach(c => {
      if (!checkinsByShift[c.shift_id]) {
        checkinsByShift[c.shift_id] = { count: 0, drivers: [] };
      }
      checkinsByShift[c.shift_id].count++;
      const firstName = (driverMap[c.driver_id] || 'Desconhecido').split(' ')[0];
      checkinsByShift[c.shift_id].drivers.push({
        nome: firstName,
        confirmedAt: c.confirmed_at ? format(new Date(c.confirmed_at), 'HH:mm') : '-',
      });
    });

    const updated = days.map(day => {
      const dayShifts = (shifts || []).filter(s => s.data === day.dateStr);
      return {
        ...day,
        shifts: dayShifts.map(s => ({
          id: s.id,
          horario_inicio: s.horario_inicio?.slice(0, 5) || '19:00',
          horario_fim: s.horario_fim?.slice(0, 5) || '23:00',
          vagas: s.vagas,
          checkins: checkinsByShift[s.id]?.count || 0,
          confirmedDrivers: checkinsByShift[s.id]?.drivers || [],
        })),
      };
    });
    setWeekData(updated);
    setLoading(false);
  };

  const addShift = (dayIdx: number) => {
    setWeekData(prev => {
      const copy = [...prev];
      copy[dayIdx] = {
        ...copy[dayIdx],
        shifts: [...copy[dayIdx].shifts, { horario_inicio: '19:00', horario_fim: '23:00', vagas: 6, checkins: 0, confirmedDrivers: [] }],
      };
      return copy;
    });
  };

  const updateShift = (dayIdx: number, shiftIdx: number, field: string, value: any) => {
    setWeekData(prev => {
      const copy = [...prev];
      const shifts = [...copy[dayIdx].shifts];
      shifts[shiftIdx] = { ...shifts[shiftIdx], [field]: value };
      copy[dayIdx] = { ...copy[dayIdx], shifts };
      return copy;
    });
  };

  const removeShift = (dayIdx: number, shiftIdx: number) => {
    const shift = weekData[dayIdx].shifts[shiftIdx];
    if (shift.checkins > 0) {
      setConfirmDelete({ dayIdx, shiftIdx, checkins: shift.checkins });
      return;
    }
    doRemoveShift(dayIdx, shiftIdx);
  };

  const doRemoveShift = (dayIdx: number, shiftIdx: number) => {
    setWeekData(prev => {
      const copy = [...prev];
      const shifts = [...copy[dayIdx].shifts];
      shifts.splice(shiftIdx, 1);
      copy[dayIdx] = { ...copy[dayIdx], shifts };
      return copy;
    });
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // Get existing shift IDs for this week to track deletions
      const startStr = weekData[0].dateStr;
      const endStr = weekData[6].dateStr;
      const { data: existingShifts } = await supabase
        .from('delivery_shifts')
        .select('id')
        .gte('data', startStr)
        .lte('data', endStr);
      const existingIds = new Set((existingShifts || []).map(s => s.id));
      const keptIds = new Set<string>();

      for (const day of weekData) {
        for (const shift of day.shifts) {
          if (shift.vagas > 0) {
            const payload = {
              data: day.dateStr,
              vagas: shift.vagas,
              horario_inicio: shift.horario_inicio,
              horario_fim: shift.horario_fim,
              created_by: user.id,
            };
            if (shift.id) {
              await supabase.from('delivery_shifts').update(payload).eq('id', shift.id);
              keptIds.add(shift.id);
            } else {
              await supabase.from('delivery_shifts').insert(payload);
            }
          }
        }
      }

      // Delete removed shifts (that had IDs but are no longer in the grid)
      for (const id of existingIds) {
        if (!keptIds.has(id)) {
          // Check if it has checkins before deleting
          const { count } = await supabase
            .from('delivery_checkins')
            .select('*', { count: 'exact', head: true })
            .eq('shift_id', id)
            .eq('status', 'confirmado');
          if ((count || 0) === 0) {
            await supabase.from('delivery_shifts').delete().eq('id', id);
          }
        }
      }

      toast({ title: 'Configuração salva com sucesso' });
      await fetchWeekData();
    } catch {
      toast({ title: 'Erro ao salvar', variant: 'destructive' });
    }
    setSaving(false);
  };

  const handleForceDeleteAndSave = async () => {
    if (!confirmDelete) return;
    const shift = weekData[confirmDelete.dayIdx].shifts[confirmDelete.shiftIdx];
    if (shift.id) {
      await supabase.from('delivery_checkins').delete().eq('shift_id', shift.id);
      await supabase.from('delivery_shifts').delete().eq('id', shift.id);
    }
    doRemoveShift(confirmDelete.dayIdx, confirmDelete.shiftIdx);
    setConfirmDelete(null);
  };

  const applyQuickConfig = () => {
    setWeekData(prev => prev.map((day, idx) => {
      if (!quickConfig.days[idx]) return day;
      const newShifts: ShiftSlot[] = [];
      newShifts.push({
        horario_inicio: quickConfig.turno1Inicio,
        horario_fim: quickConfig.turno1Fim,
        vagas: quickConfig.turno1Vagas,
        checkins: 0,
        confirmedDrivers: [],
      });
      if (quickConfig.turnosQtd >= 2) {
        newShifts.push({
          horario_inicio: quickConfig.turno2Inicio,
          horario_fim: quickConfig.turno2Fim,
          vagas: quickConfig.turno2Vagas,
          checkins: 0,
          confirmedDrivers: [],
        });
      }
      return { ...day, shifts: newShifts };
    }));
    setShowQuickConfig(false);
    toast({ title: 'Padrão aplicado — confira e salve' });
  };

  const isPast = (date: Date) => isBefore(startOfDay(date), startOfDay(new Date())) && !isToday(date);

  // Today's detailed summary
  const todayData = weekData.find(d => isToday(d.date));

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <CalendarDays className="h-5 w-5" /> Escalas de Entregadores
            </h1>
            <p className="text-sm text-muted-foreground">Gerencie os turnos e vagas semanais</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowQuickConfig(true)}>
              <Settings2 className="h-4 w-4 mr-1" /> Aplicar padrão
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || loading}>
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
          {weekData.map((day, dayIdx) => {
            const past = isPast(day.date);
            const today = isToday(day.date);
            return (
              <div
                key={day.dateStr}
                className={`rounded-lg border p-2.5 space-y-2 text-xs transition-opacity ${
                  past ? 'opacity-50 bg-muted/40' : today ? 'border-primary bg-primary/5' : 'bg-card'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground text-[13px]">
                    {format(day.date, 'dd/MM')} {DAY_LABELS[dayIdx]}
                  </span>
                  {today && <Badge variant="default" className="text-[9px] px-1.5 py-0">Hoje</Badge>}
                </div>

                {/* Shift cards */}
                {day.shifts.length === 0 && (
                  <p className="text-muted-foreground text-[11px] py-2">Nenhum turno</p>
                )}

                {day.shifts.map((shift, shiftIdx) => {
                  const fillPct = shift.vagas > 0 ? Math.round((shift.checkins / shift.vagas) * 100) : 0;
                  const barColor = fillPct >= 100 ? 'bg-destructive' : fillPct > 75 ? 'bg-warning' : 'bg-green-500';
                  return (
                    <div key={shiftIdx} className="rounded-md border border-border p-2 space-y-1.5 bg-background">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-foreground text-[12px]">
                          {shift.horario_inicio} — {shift.horario_fim}
                        </span>
                        {!past && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button className="text-muted-foreground hover:text-foreground p-0.5">
                                <Settings2 className="h-3 w-3" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-56 p-3 space-y-2" align="end">
                              <div className="space-y-1.5">
                                <label className="text-xs text-muted-foreground">Início</label>
                                <Input type="time" value={shift.horario_inicio} onChange={e => updateShift(dayIdx, shiftIdx, 'horario_inicio', e.target.value)} className="h-7 text-xs" />
                                <label className="text-xs text-muted-foreground">Fim</label>
                                <Input type="time" value={shift.horario_fim} onChange={e => updateShift(dayIdx, shiftIdx, 'horario_fim', e.target.value)} className="h-7 text-xs" />
                                <label className="text-xs text-muted-foreground">Vagas</label>
                                <Input type="number" min={1} max={20} value={shift.vagas} onChange={e => updateShift(dayIdx, shiftIdx, 'vagas', Math.max(1, +e.target.value))} className="h-7 text-xs" />
                              </div>
                              <Button
                                variant="destructive"
                                size="sm"
                                className="w-full text-xs h-7"
                                onClick={() => removeShift(dayIdx, shiftIdx)}
                              >
                                <Trash2 className="h-3 w-3 mr-1" /> Remover turno
                              </Button>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-[10px]">{shift.checkins}/{shift.vagas}</span>
                        </div>
                        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(fillPct, 100)}%` }} />
                        </div>
                      </div>

                      {/* Driver names */}
                      {shift.confirmedDrivers.length > 0 ? (
                        <p className="text-[10px] text-muted-foreground leading-tight">
                          {shift.confirmedDrivers.map(d => d.nome).join(', ')}
                        </p>
                      ) : (
                        <p className="text-[10px] text-muted-foreground italic">sem confirmações</p>
                      )}
                    </div>
                  );
                })}

                {/* Add shift button */}
                {!past && (
                  <button
                    onClick={() => addShift(dayIdx)}
                    className="w-full flex items-center justify-center gap-1 text-[11px] text-muted-foreground hover:text-foreground py-1 rounded border border-dashed border-border hover:border-foreground/30 transition-colors"
                  >
                    <Plus className="h-3 w-3" /> Turno
                  </button>
                )}
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
            {!todayData || todayData.shifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum turno configurado para hoje</p>
            ) : (
              <div className="space-y-3">
                {todayData.shifts.map((shift, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-semibold text-foreground">{shift.horario_inicio} — {shift.horario_fim}</span>
                      <Badge variant={shift.checkins >= shift.vagas ? 'default' : 'secondary'} className="text-[10px]">
                        {shift.checkins}/{shift.vagas} confirmados
                      </Badge>
                    </div>
                    {shift.confirmedDrivers.length > 0 ? (
                      <div className="ml-6 space-y-0.5">
                        {shift.confirmedDrivers.map((d, j) => (
                          <div key={j} className="flex items-center gap-2 text-sm">
                            <span className="font-medium text-foreground">{d.nome}</span>
                            <span className="text-muted-foreground text-xs">às {d.confirmedAt}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="ml-6 text-sm text-muted-foreground">Nenhuma confirmação ainda</p>
                    )}
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
            <div>
              <label className="text-sm font-medium">Turnos por dia</label>
              <div className="flex gap-2 mt-1">
                {[1, 2].map(n => (
                  <Button
                    key={n}
                    variant={quickConfig.turnosQtd === n ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setQuickConfig(p => ({ ...p, turnosQtd: n }))}
                  >
                    {n} turno{n > 1 ? 's' : ''}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-2">
                <p className="text-sm font-medium">Turno 1</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Início</label>
                    <Input type="time" value={quickConfig.turno1Inicio} onChange={e => setQuickConfig(p => ({ ...p, turno1Inicio: e.target.value }))} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Fim</label>
                    <Input type="time" value={quickConfig.turno1Fim} onChange={e => setQuickConfig(p => ({ ...p, turno1Fim: e.target.value }))} className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Vagas</label>
                    <Input type="number" min={1} value={quickConfig.turno1Vagas} onChange={e => setQuickConfig(p => ({ ...p, turno1Vagas: +e.target.value }))} className="h-8 text-xs" />
                  </div>
                </div>
              </div>
              {quickConfig.turnosQtd >= 2 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Turno 2</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Início</label>
                      <Input type="time" value={quickConfig.turno2Inicio} onChange={e => setQuickConfig(p => ({ ...p, turno2Inicio: e.target.value }))} className="h-8 text-xs" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Fim</label>
                      <Input type="time" value={quickConfig.turno2Fim} onChange={e => setQuickConfig(p => ({ ...p, turno2Fim: e.target.value }))} className="h-8 text-xs" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Vagas</label>
                      <Input type="number" min={1} value={quickConfig.turno2Vagas} onChange={e => setQuickConfig(p => ({ ...p, turno2Vagas: +e.target.value }))} className="h-8 text-xs" />
                    </div>
                  </div>
                </div>
              )}
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
