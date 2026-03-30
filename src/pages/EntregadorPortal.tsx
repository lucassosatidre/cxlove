import { useState, useEffect, useCallback } from 'react';
import { format, addDays, isBefore, isToday, startOfDay, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { LogOut, RefreshCw, ChevronDown, AlertTriangle, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import propositoLogo from '@/assets/proposito-logo.png';

interface DriverProfile {
  id: string;
  nome: string;
  status: string;
  max_periodos_dia: number;
}

interface ConfirmedShift {
  checkinId: string;
  shiftId: string;
  data: string;
  horario_inicio: string;
  horario_fim: string;
}

interface AvailableShift {
  shiftId: string;
  data: string;
  vagas: number;
  vagasRestantes: number;
  horario_inicio: string;
  horario_fim: string;
  alreadyConfirmed: boolean;
  _dayLimit?: boolean;
}

interface HistoryItem {
  data: string;
  horario_inicio: string;
  horario_fim: string;
  status: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export default function EntregadorPortal() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [confirmedShifts, setConfirmedShifts] = useState<ConfirmedShift[]>([]);
  const [availableShifts, setAvailableShifts] = useState<AvailableShift[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [cancelDialog, setCancelDialog] = useState<{ checkinId: string; data: string; horario: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);

    const { data: driverData } = await supabase
      .from('delivery_drivers')
      .select('id, nome, status, max_periodos_dia')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (!driverData) {
      setDriver(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setDriver(driverData);

    const futureEnd = format(addDays(new Date(), 14), 'yyyy-MM-dd');

    const { data: shifts } = await supabase
      .from('delivery_shifts')
      .select('*')
      .gte('data', todayStr)
      .lte('data', futureEnd)
      .order('data', { ascending: true })
      .order('horario_inicio', { ascending: true });

    const allShifts = shifts || [];
    const shiftIds = allShifts.map(s => s.id);

    let allCheckins: any[] = [];
    if (shiftIds.length > 0) {
      const { data } = await supabase
        .from('delivery_checkins')
        .select('id, shift_id, driver_id, status, confirmed_at, cancelled_at, cancel_reason')
        .in('shift_id', shiftIds);
      allCheckins = data || [];
    }

    const confirmedCountByShift: Record<string, number> = {};
    allCheckins.forEach(c => {
      if (c.status === 'confirmado') {
        confirmedCountByShift[c.shift_id] = (confirmedCountByShift[c.shift_id] || 0) + 1;
      }
    });

    const myCheckins = allCheckins.filter(c => c.driver_id === driverData.id && c.status === 'confirmado');
    const myConfirmedShiftIds = new Set(myCheckins.map(c => c.shift_id));

    const myConfirmedPerDay: Record<string, number> = {};
    myCheckins.forEach(c => {
      const shift = allShifts.find(s => s.id === c.shift_id);
      if (shift) {
        myConfirmedPerDay[shift.data] = (myConfirmedPerDay[shift.data] || 0) + 1;
      }
    });

    const confirmed: ConfirmedShift[] = myCheckins
      .map(c => {
        const shift = allShifts.find(s => s.id === c.shift_id);
        if (!shift) return null;
        return {
          checkinId: c.id,
          shiftId: shift.id,
          data: shift.data,
          horario_inicio: shift.horario_inicio?.slice(0, 5) || '',
          horario_fim: shift.horario_fim?.slice(0, 5) || '',
        };
      })
      .filter(Boolean) as ConfirmedShift[];
    confirmed.sort((a, b) => a.data.localeCompare(b.data) || a.horario_inicio.localeCompare(b.horario_inicio));
    setConfirmedShifts(confirmed);

    const available: AvailableShift[] = allShifts
      .filter(s => s.vagas > 0)
      .map(s => ({
        shiftId: s.id,
        data: s.data,
        vagas: s.vagas,
        vagasRestantes: s.vagas - (confirmedCountByShift[s.id] || 0),
        horario_inicio: s.horario_inicio?.slice(0, 5) || '',
        horario_fim: s.horario_fim?.slice(0, 5) || '',
        alreadyConfirmed: myConfirmedShiftIds.has(s.id),
        _dayLimit: (myConfirmedPerDay[s.data] || 0) >= driverData.max_periodos_dia && !myConfirmedShiftIds.has(s.id),
      }))
      .filter(s => !isShiftPast(s.data, s.horario_inicio));
    setAvailableShifts(available);

    // History
    const thirtyDaysAgo = format(addDays(new Date(), -30), 'yyyy-MM-dd');
    const { data: histCheckins } = await supabase
      .from('delivery_checkins')
      .select('shift_id, status, confirmed_at, cancelled_at, cancel_reason')
      .eq('driver_id', driverData.id)
      .order('created_at', { ascending: false });

    const histShiftIds = [...new Set((histCheckins || []).map(c => c.shift_id))];
    let histShifts: any[] = [];
    if (histShiftIds.length > 0) {
      const { data } = await supabase
        .from('delivery_shifts')
        .select('id, data, horario_inicio, horario_fim')
        .in('id', histShiftIds)
        .gte('data', thirtyDaysAgo)
        .order('data', { ascending: false });
      histShifts = data || [];
    }
    const histShiftMap: Record<string, any> = {};
    histShifts.forEach(s => { histShiftMap[s.id] = s; });

    const histItems: HistoryItem[] = (histCheckins || [])
      .map(c => {
        const s = histShiftMap[c.shift_id];
        if (!s) return null;
        return {
          data: s.data,
          horario_inicio: s.horario_inicio?.slice(0, 5) || '',
          horario_fim: s.horario_fim?.slice(0, 5) || '',
          status: c.status,
          confirmed_at: c.confirmed_at,
          cancelled_at: c.cancelled_at,
          cancel_reason: c.cancel_reason,
        };
      })
      .filter(Boolean) as HistoryItem[];
    setHistory(histItems);

    setLoading(false);
    setRefreshing(false);
  }, [user, todayStr]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const isShiftPast = (data: string, horarioInicio: string | null): boolean => {
    const shiftDate = parseISO(data);
    if (isBefore(startOfDay(shiftDate), startOfDay(new Date())) && !isToday(shiftDate)) return true;
    if (isToday(shiftDate) && horarioInicio) {
      const now = new Date();
      const [h, m] = horarioInicio.split(':').map(Number);
      const shiftStart = new Date();
      shiftStart.setHours(h, m, 0, 0);
      if (now >= shiftStart) return true;
    }
    return false;
  };

  const canCancel = (data: string, horarioInicio: string | null): boolean => {
    return !isShiftPast(data, horarioInicio);
  };

  const handleConfirm = async (shift: AvailableShift) => {
    if (!driver || !user) return;
    setActionLoading(shift.shiftId);

    try {
      const { count } = await supabase
        .from('delivery_checkins')
        .select('*', { count: 'exact', head: true })
        .eq('shift_id', shift.shiftId)
        .eq('status', 'confirmado');

      if ((count || 0) >= shift.vagas) {
        toast({ title: 'Vagas esgotadas, tente outro turno', variant: 'destructive' });
        fetchAll();
        return;
      }

      const { count: dayCount } = await supabase
        .from('delivery_checkins')
        .select('*, delivery_shifts!inner(data)', { count: 'exact', head: true })
        .eq('driver_id', driver.id)
        .eq('status', 'confirmado')
        .eq('delivery_shifts.data', shift.data);

      if ((dayCount || 0) >= driver.max_periodos_dia) {
        toast({ title: 'Limite de turnos por dia atingido', variant: 'destructive' });
        return;
      }

      const { error } = await supabase.from('delivery_checkins').insert({
        shift_id: shift.shiftId,
        driver_id: driver.id,
        status: 'confirmado',
      });

      if (error) {
        if (error.code === '23505') {
          toast({ title: 'Você já confirmou este turno', variant: 'destructive' });
        } else {
          toast({ title: 'Erro ao confirmar', description: error.message, variant: 'destructive' });
        }
      } else {
        const dateFormatted = format(parseISO(shift.data), "dd/MM (EEEE)", { locale: ptBR });
        toast({ title: `Presença confirmada para ${dateFormatted} — ${shift.horario_inicio}` });
        fetchAll();
      }
    } catch {
      toast({ title: 'Erro de conexão', variant: 'destructive' });
    }
    setActionLoading(null);
  };

  const handleCancel = async () => {
    if (!cancelDialog) return;
    setActionLoading(cancelDialog.checkinId);

    const { error } = await supabase
      .from('delivery_checkins')
      .update({
        status: 'cancelado',
        cancelled_at: new Date().toISOString(),
        cancel_reason: cancelReason || null,
      })
      .eq('id', cancelDialog.checkinId);

    if (error) {
      toast({ title: 'Erro ao cancelar', variant: 'destructive' });
    } else {
      toast({ title: 'Presença cancelada' });
      fetchAll();
    }
    setCancelDialog(null);
    setCancelReason('');
    setActionLoading(null);
  };

  const formatDateExtended = (dateStr: string) => {
    const d = parseISO(dateStr);
    return format(d, "EEEE, dd/MM", { locale: ptBR }).replace(/^\w/, c => c.toUpperCase());
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'confirmado': return <Badge className="bg-green-600 text-white text-[10px]">Confirmado</Badge>;
      case 'cancelado': return <Badge variant="destructive" className="text-[10px]">Cancelado</Badge>;
      case 'no_show': return <Badge className="bg-amber-500 text-white text-[10px]">Não compareceu</Badge>;
      case 'concluido': return <Badge className="bg-blue-600 text-white text-[10px]">Concluído</Badge>;
      default: return <Badge variant="secondary" className="text-[10px]">{status}</Badge>;
    }
  };

  if (!loading && driver && (driver.status === 'inativo' || driver.status === 'suspenso')) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-[480px]">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
            <h2 className="text-lg font-bold text-foreground">Conta {driver.status === 'inativo' ? 'inativa' : 'suspensa'}</h2>
            <p className="text-muted-foreground text-sm">
              Sua conta está {driver.status}. Entre em contato com a administração.
            </p>
            <Button variant="outline" onClick={signOut} className="min-h-[48px] w-full">
              <LogOut className="h-4 w-4 mr-2" /> Sair
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!loading && !driver) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-[480px]">
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-muted-foreground">Perfil de entregador não encontrado. Contacte a administração.</p>
            <Button variant="outline" onClick={signOut} className="min-h-[48px] w-full">
              <LogOut className="h-4 w-4 mr-2" /> Sair
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const availableByDay: Record<string, AvailableShift[]> = {};
  availableShifts.forEach(s => {
    if (!availableByDay[s.data]) availableByDay[s.data] = [];
    availableByDay[s.data].push(s);
  });
  const sortedAvailableDays = Object.keys(availableByDay).sort();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-sidebar border-b border-sidebar-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-sidebar-accent border border-sidebar-border flex items-center justify-center p-1 shrink-0">
            <img src={propositoLogo} alt="CX Love" className="h-full w-full object-contain" />
          </div>
          <div>
            <p className="text-sm font-bold text-sidebar-accent-foreground leading-tight">CX Love</p>
            {driver && <p className="text-[11px] text-sidebar-foreground/70">{driver.nome}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => fetchAll()} disabled={refreshing} className="text-sidebar-foreground hover:text-sidebar-accent-foreground">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="icon" onClick={signOut} className="text-sidebar-foreground hover:text-sidebar-accent-foreground">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-[480px] mx-auto px-4 py-5 space-y-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {/* Confirmed shifts */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Meus Turnos Confirmados
              </h2>
              {confirmedShifts.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-6 text-center">
                    <p className="text-sm text-muted-foreground">Você não tem turnos confirmados.</p>
                    <p className="text-sm text-muted-foreground">Confira as vagas disponíveis abaixo!</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {confirmedShifts.map(cs => {
                    const canCancelThis = canCancel(cs.data, cs.horario_inicio);
                    return (
                      <Card key={cs.checkinId} className="border-primary/30 bg-primary/5">
                        <CardContent className="py-3 px-4 flex items-center justify-between gap-3">
                          <div className="space-y-0.5 min-w-0">
                            <p className="text-sm font-semibold text-foreground">{formatDateExtended(cs.data)}</p>
                            <div className="flex items-center gap-2">
                              <Clock className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">
                                {cs.horario_inicio} — {cs.horario_fim}
                              </span>
                            </div>
                          </div>
                          {canCancelThis && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="shrink-0 min-h-[40px] text-xs"
                              disabled={actionLoading === cs.checkinId}
                              onClick={() => setCancelDialog({ checkinId: cs.checkinId, data: cs.data, horario: `${cs.horario_inicio} — ${cs.horario_fim}` })}
                            >
                              Cancelar
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Available shifts */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Vagas Disponíveis
              </h2>
              {sortedAvailableDays.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-6 text-center">
                    <p className="text-sm text-muted-foreground">Nenhum turno com vagas nos próximos dias.</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {sortedAvailableDays.map(dateStr => {
                    const dayShifts = availableByDay[dateStr];
                    return (
                      <Card key={dateStr}>
                        <CardContent className="py-3 px-4 space-y-2">
                          <p className="text-sm font-semibold text-foreground">{formatDateExtended(dateStr)}</p>
                          {dayShifts.map(s => (
                            <div key={s.shiftId} className="flex items-center justify-between gap-2 py-1.5 border-t border-border first:border-0">
                              <div className="space-y-0.5 min-w-0">
                                <div className="flex items-center gap-2">
                                  <Clock className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-xs font-medium text-foreground">
                                    {s.horario_inicio} — {s.horario_fim}
                                  </span>
                                </div>
                                <p className={`text-xs ${s.vagasRestantes > 0 ? 'text-muted-foreground' : 'text-destructive font-medium'}`}>
                                  {s.vagasRestantes > 0 ? `${s.vagasRestantes} vaga${s.vagasRestantes > 1 ? 's' : ''} restante${s.vagasRestantes > 1 ? 's' : ''}` : 'Esgotado'}
                                </p>
                              </div>
                              <div className="shrink-0">
                                {s.alreadyConfirmed ? (
                                  <Badge className="bg-green-600 text-white text-xs px-3 py-1">Confirmado</Badge>
                                ) : s.vagasRestantes <= 0 ? (
                                  <Badge variant="destructive" className="text-xs px-3 py-1">Esgotado</Badge>
                                ) : s._dayLimit ? (
                                  <Button size="sm" disabled className="min-h-[48px] text-xs opacity-50">
                                    Limite atingido
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    className="min-h-[48px] bg-green-600 hover:bg-green-700 text-white font-semibold text-xs px-4"
                                    disabled={actionLoading === s.shiftId}
                                    onClick={() => handleConfirm(s)}
                                  >
                                    {actionLoading === s.shiftId ? 'Confirmando...' : 'CONFIRMAR'}
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </section>

            {/* History */}
            <section>
              <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between text-sm text-muted-foreground">
                    Ver histórico
                    <ChevronDown className={`h-4 w-4 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {history.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">Nenhum registro encontrado.</p>
                  ) : (
                    <div className="space-y-1 mt-2">
                      {history.map((h, i) => (
                        <div key={i} className="flex items-center justify-between py-2 px-3 rounded-md bg-muted/30 text-sm">
                          <div className="space-y-0.5">
                            <p className="font-medium text-foreground text-xs">
                              {format(parseISO(h.data), 'dd/MM/yyyy')} — {h.horario_inicio} — {h.horario_fim}
                            </p>
                            {h.confirmed_at && (
                              <p className="text-[10px] text-muted-foreground">
                                Confirmado às {format(new Date(h.confirmed_at), 'HH:mm')}
                              </p>
                            )}
                            {h.cancel_reason && (
                              <p className="text-[10px] text-muted-foreground italic">Motivo: {h.cancel_reason}</p>
                            )}
                          </div>
                          {statusBadge(h.status)}
                        </div>
                      ))}
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </section>
          </>
        )}
      </main>

      {/* Cancel dialog */}
      <Dialog open={!!cancelDialog} onOpenChange={() => { setCancelDialog(null); setCancelReason(''); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Cancelar presença</DialogTitle>
          </DialogHeader>
          {cancelDialog && (
            <p className="text-sm text-muted-foreground">
              Deseja cancelar sua presença em {formatDateExtended(cancelDialog.data)} — {cancelDialog.horario}?
            </p>
          )}
          <Textarea
            placeholder="Motivo do cancelamento (opcional)"
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
            className="min-h-[80px]"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCancelDialog(null); setCancelReason(''); }}>Voltar</Button>
            <Button variant="destructive" onClick={handleCancel} disabled={actionLoading === cancelDialog?.checkinId} className="min-h-[44px]">
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
