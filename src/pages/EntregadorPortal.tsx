import { useState, useEffect, useCallback } from 'react';
import { format, addDays, isBefore, isToday, startOfDay, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { LogOut, RefreshCw, Check, AlertTriangle, Settings } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

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
  origin: string;
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

export default function EntregadorPortal() {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [confirmedShifts, setConfirmedShifts] = useState<ConfirmedShift[]>([]);
  const [availableShifts, setAvailableShifts] = useState<AvailableShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [cancelDialog, setCancelDialog] = useState<{ checkinId: string; data: string; horario: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [passwordDialog, setPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

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
        .select('id, shift_id, driver_id, status, confirmed_at, cancelled_at, cancel_reason, origin')
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
          origin: (c as any).origin || 'entregador',
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
        _dayLimit: false,
      }))
      .filter(s => !isShiftPast(s.data, s.horario_inicio));
    setAvailableShifts(available);

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

  const canCancel = (data: string, horarioInicio: string | null): boolean => !isShiftPast(data, horarioInicio);

  const getDeviceInfo = async () => {
    let deviceIp = 'indisponível';
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const data = await res.json();
      deviceIp = data.ip || 'indisponível';
    } catch { /* ignore */ }
    const deviceUserAgent = navigator.userAgent;
    const deviceInfo = `${screen.width}x${screen.height}`;
    return { deviceIp, deviceUserAgent, deviceInfo };
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

      const { deviceIp, deviceUserAgent, deviceInfo } = await getDeviceInfo();

      // Delete old cancelled/no_show records to allow re-confirmation
      const { data: existingCheckins } = await supabase
        .from('delivery_checkins')
        .select('id, status')
        .eq('shift_id', shift.shiftId)
        .eq('driver_id', driver.id);

      if (existingCheckins && existingCheckins.length > 0) {
        const activeCheckin = existingCheckins.find(c => c.status === 'confirmado' || c.status === 'concluido');
        if (activeCheckin) {
          toast({ title: 'Você já confirmou este turno', variant: 'destructive' });
          setActionLoading(null);
          return;
        }
        const oldIds = existingCheckins.map(c => c.id);
        await supabase.from('delivery_checkins').delete().in('id', oldIds);
      }

      const { error } = await supabase.from('delivery_checkins').insert({
        shift_id: shift.shiftId,
        driver_id: driver.id,
        status: 'confirmado',
        device_ip: deviceIp,
        device_user_agent: deviceUserAgent,
        device_info: deviceInfo,
        origin: 'entregador',
      } as any);

      if (error) {
        toast({ title: 'Erro ao confirmar', description: error.message, variant: 'destructive' });
      } else {
        const dateFormatted = format(parseISO(shift.data), "dd/MM (EEEE)", { locale: ptBR });
        toast({ title: `Presença confirmada para ${dateFormatted}` });
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
      .update({ status: 'cancelado', cancelled_at: new Date().toISOString(), cancel_reason: cancelReason || null })
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

  const handleChangePassword = async () => {
    if (!/^\d{4}$/.test(newPassword)) {
      setPasswordError('A senha deve ter exatamente 4 dígitos numéricos');
      return;
    }
    setPasswordSaving(true);
    setPasswordError('');
    const { padPin } = await import('@/lib/pin-utils');
    const { error } = await supabase.auth.updateUser({ password: padPin(newPassword) });
    if (error) {
      setPasswordError(error.message);
    } else {
      toast({ title: 'Senha alterada com sucesso!' });
      setPasswordDialog(false);
      setNewPassword('');
    }
    setPasswordSaving(false);
  };

  const formatDateFull = (dateStr: string) => {
    const d = parseISO(dateStr);
    return format(d, "EEEE, dd 'de' MMMM", { locale: ptBR }).replace(/^\w/, c => c.toUpperCase());
  };

  // Blocked states
  if (!loading && driver && (driver.status === 'inativo' || driver.status === 'suspenso')) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
        <div className="w-full max-w-[480px] bg-white rounded-xl border border-[#E5E7EB] p-6 text-center space-y-4">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
          <h2 className="text-lg font-semibold text-[#1A1A1A]">Conta {driver.status === 'inativo' ? 'inativa' : 'suspensa'}</h2>
          <p className="text-[#6B7280] text-sm">Entre em contato com a administração.</p>
          <button onClick={signOut} className="w-full h-12 rounded-lg border border-[#E5E7EB] text-[#6B7280] font-medium text-sm hover:bg-[#F3F4F6] transition-colors flex items-center justify-center gap-2">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </div>
    );
  }

  if (!loading && !driver) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
        <div className="w-full max-w-[480px] bg-white rounded-xl border border-[#E5E7EB] p-6 text-center space-y-4">
          <p className="text-[#6B7280] text-sm">Perfil de entregador não encontrado. Contacte a administração.</p>
          <button onClick={signOut} className="w-full h-12 rounded-lg border border-[#E5E7EB] text-[#6B7280] font-medium text-sm hover:bg-[#F3F4F6] transition-colors flex items-center justify-center gap-2">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </div>
    );
  }

  // Group available by day
  const availableByDay: Record<string, AvailableShift[]> = {};
  availableShifts.forEach(s => {
    if (!availableByDay[s.data]) availableByDay[s.data] = [];
    availableByDay[s.data].push(s);
  });
  const sortedDays = Object.keys(availableByDay).sort();

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Header — 56px, black */}
      <header className="sticky top-0 z-20 h-14 bg-[#1A1A1A] flex items-center justify-between px-4">
        <span className="text-white font-bold text-base tracking-tight">CX Love</span>
        <div className="flex items-center gap-3">
          {driver && <span className="text-white/70 text-sm hidden sm:block">{driver.nome}</span>}
          <button onClick={() => fetchAll()} disabled={refreshing} className="text-white/70 hover:text-white transition-colors">
            <RefreshCw className={`h-[18px] w-[18px] ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setPasswordDialog(true)} className="text-white/70 hover:text-white transition-colors">
            <Settings className="h-[18px] w-[18px]" />
          </button>
          <button onClick={signOut} className="text-white/70 hover:text-white transition-colors">
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      <main className="max-w-[480px] mx-auto px-4 py-5 space-y-6">
        {loading ? (
          <LoadingSkeleton />
        ) : (
          <>
            {/* Próximos Turnos */}
            <section>
              <h2 className="text-lg font-semibold text-[#1A1A1A] mb-3">Próximos Turnos</h2>
              {confirmedShifts.length === 0 ? (
                <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 text-center">
                  <p className="text-sm text-[#6B7280]">Nenhum turno confirmado</p>
                  <p className="text-sm text-[#9CA3AF] mt-0.5">Confira as vagas abaixo</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {confirmedShifts.map(cs => (
                    <div key={cs.checkinId} className="bg-white rounded-xl border border-[#E5E7EB] border-l-4 border-l-[#F97316] p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1A1A1A] leading-snug">{formatDateFull(cs.data)}</p>
                        <p className="text-[13px] text-[#6B7280] mt-0.5">{cs.horario_inicio} — {cs.horario_fim}</p>
                        {cs.origin === 'admin' && (
                          <p className="text-[11px] text-[#9CA3AF] mt-0.5 italic">adicionado pela gestão</p>
                        )}
                      </div>
                      {canCancel(cs.data, cs.horario_inicio) && (
                        <button
                          className="shrink-0 h-8 px-3 rounded-md border border-destructive text-destructive text-xs font-semibold uppercase tracking-wide hover:bg-destructive/5 transition-colors disabled:opacity-50"
                          disabled={actionLoading === cs.checkinId}
                          onClick={() => setCancelDialog({ checkinId: cs.checkinId, data: cs.data, horario: `${cs.horario_inicio} — ${cs.horario_fim}` })}
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Vagas Disponíveis */}
            <section>
              <h2 className="text-lg font-semibold text-[#1A1A1A] mb-3">Vagas Disponíveis</h2>
              {sortedDays.length === 0 ? (
                <div className="bg-white rounded-xl border border-[#E5E7EB] p-5 text-center">
                  <p className="text-sm text-[#6B7280]">Nenhum turno com vagas nos próximos dias.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {sortedDays.map(dateStr => {
                    const dayShifts = availableByDay[dateStr];
                    return (
                      <div key={dateStr}>
                        <p className="text-sm font-semibold text-[#1A1A1A] mb-2">{formatDateFull(dateStr)}</p>
                        <div className="space-y-2">
                          {dayShifts.map(s => (
                            <div key={s.shiftId} className="bg-white rounded-xl border border-[#E5E7EB] p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-[#1A1A1A]">{s.horario_inicio} — {s.horario_fim}</span>
                                {s.alreadyConfirmed && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#DCFCE7] text-[#166534] text-xs font-medium px-2.5 py-0.5">
                                    <Check className="h-3 w-3" /> Confirmado
                                  </span>
                                )}
                              </div>

                              {!s.alreadyConfirmed && (
                                <>
                                  <p className={`text-[13px] ${s.vagasRestantes > 0 && s.vagasRestantes < 3 ? 'text-destructive font-medium' : s.vagasRestantes <= 0 ? 'text-destructive font-medium' : 'text-[#6B7280]'}`}>
                                    {s.vagasRestantes <= 0
                                      ? 'Esgotado'
                                      : s.vagasRestantes < 3
                                        ? `Últimas ${s.vagasRestantes} vaga${s.vagasRestantes > 1 ? 's' : ''}!`
                                        : `${s.vagasRestantes} vaga${s.vagasRestantes > 1 ? 's' : ''} restante${s.vagasRestantes > 1 ? 's' : ''}`}
                                  </p>

                                  {s.vagasRestantes > 0 && (
                                    s._dayLimit ? (
                                      <button disabled className="w-full h-12 rounded-lg bg-[#E5E7EB] text-[#9CA3AF] font-semibold text-sm uppercase tracking-wide cursor-not-allowed">
                                        Limite diário atingido
                                      </button>
                                    ) : (
                                      <button
                                        className="w-full h-12 rounded-lg bg-[#F97316] hover:bg-[#EA580C] text-white font-bold text-sm uppercase tracking-wide transition-colors disabled:opacity-60"
                                        disabled={actionLoading === s.shiftId}
                                        onClick={() => handleConfirm(s)}
                                      >
                                        {actionLoading === s.shiftId ? 'Confirmando...' : 'Confirmar'}
                                      </button>
                                    )
                                  )}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Cancel dialog */}
      <Dialog open={!!cancelDialog} onOpenChange={() => { setCancelDialog(null); setCancelReason(''); }}>
        <DialogContent className="sm:max-w-[400px] rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base">Cancelar presença?</DialogTitle>
          </DialogHeader>
          {cancelDialog && (
            <p className="text-sm text-[#6B7280]">
              Turno: {formatDateFull(cancelDialog.data)} — {cancelDialog.horario}
            </p>
          )}
          <Textarea
            placeholder="Motivo (opcional)"
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
            className="min-h-[80px] text-sm"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCancelDialog(null); setCancelReason(''); }} className="h-11">
              Voltar
            </Button>
            <Button variant="destructive" onClick={handleCancel} disabled={actionLoading === cancelDialog?.checkinId} className="h-11">
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password change dialog */}
      <Dialog open={passwordDialog} onOpenChange={(open) => { setPasswordDialog(open); if (!open) { setNewPassword(''); setPasswordError(''); } }}>
        <DialogContent className="sm:max-w-[360px] rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base">Alterar senha</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={4}
                pattern="[0-9]*"
                placeholder="Digite 4 dígitos"
                value={newPassword}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setNewPassword(v);
                  setPasswordError('');
                }}
                className="text-center text-2xl tracking-[0.5em] font-mono h-14 bg-background"
              />
              <p className="text-xs text-[#9CA3AF] mt-1.5 text-center">Use 4 dígitos numéricos</p>
            </div>
            {passwordError && <p className="text-sm text-destructive text-center">{passwordError}</p>}
          </div>
          <DialogFooter>
            <button
              className="w-full h-12 rounded-lg bg-[#F97316] hover:bg-[#EA580C] text-white font-bold text-sm uppercase tracking-wide transition-colors disabled:opacity-60"
              disabled={passwordSaving}
              onClick={handleChangePassword}
            >
              {passwordSaving ? 'Salvando...' : 'Salvar nova senha'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-5 w-40 mb-3" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
      <div>
        <Skeleton className="h-5 w-40 mb-3" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
