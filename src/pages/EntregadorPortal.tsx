import { useState, useEffect, useCallback } from 'react';
import { LogOut, RefreshCw, AlertTriangle, Settings } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { getBrasiliaHour, getBrasiliaToday, getBrasiliaDateFormatted } from '@/lib/brasilia-time';
import { logCheckinAction } from '@/lib/checkin-logger';
import { promoteFromWaitlist } from '@/lib/promote-waitlist';
import NotificationBell from '@/components/NotificationBell';

interface DriverProfile {
  id: string;
  nome: string;
  status: string;
  password_changed: boolean;
}

type CheckinState = 'none' | 'confirmed' | 'waitlist';

const ACTIVE_CHECKIN_STATUSES = ['confirmado', 'fila_espera', 'em_rota'] as const;

function normalizeCheckinStatus(status: string | null | undefined) {
  return (status ?? '').trim().toLowerCase();
}

function isActiveCheckinStatus(status: string | null | undefined) {
  return ACTIVE_CHECKIN_STATUSES.includes(
    normalizeCheckinStatus(status) as (typeof ACTIVE_CHECKIN_STATUSES)[number]
  );
}

export default function EntregadorPortal() {
  const { user, signOut } = useAuth();
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Today's shift state
  const [todayShiftId, setTodayShiftId] = useState<string | null>(null);
  const [checkinState, setCheckinState] = useState<CheckinState>('none');
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [waitlistPosition, setWaitlistPosition] = useState(0);
  const [hasVagas, setHasVagas] = useState(false);
  const [shiftExists, setShiftExists] = useState(false);

  // Dialogs
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [passwordDialog, setPasswordDialog] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Force password change dialog
  const [forcePasswordDialog, setForcePasswordDialog] = useState(false);
  const [forceNewPassword, setForceNewPassword] = useState('');
  const [forcePasswordError, setForcePasswordError] = useState('');
  const [forcePasswordSaving, setForcePasswordSaving] = useState(false);

  // Promoted notification
  const [promotedNotification, setPromotedNotification] = useState<string | null>(null);

  const todayStr = getBrasiliaToday();
  const todayFormatted = getBrasiliaDateFormatted();
  const [brasiliaHour, setBrasiliaHour] = useState(getBrasiliaHour());

  useEffect(() => {
    const interval = setInterval(() => {
      setBrasiliaHour(getBrasiliaHour());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const cleanupStaleCheckins = useCallback(async (driverId: string) => {
    const { data: staleCheckins, error } = await supabase
      .from('delivery_checkins')
      .select('id, status, delivery_shifts!inner(data)')
      .eq('driver_id', driverId)
      .lt('delivery_shifts.data', todayStr);

    if (error) {
      console.error('Erro ao buscar check-ins antigos do entregador', error);
      return;
    }

    const activeStaleCheckins = (staleCheckins ?? []).filter((checkin) =>
      isActiveCheckinStatus(checkin.status)
    );

    if (!activeStaleCheckins.length) return;

    const staleConfirmedIds = activeStaleCheckins
      .filter((checkin) => ['confirmado', 'em_rota'].includes(normalizeCheckinStatus(checkin.status)))
      .map((checkin) => checkin.id);

    const staleWaitlistIds = activeStaleCheckins
      .filter((checkin) => normalizeCheckinStatus(checkin.status) === 'fila_espera')
      .map((checkin) => checkin.id);

    const nowIso = new Date().toISOString();

    const updates = [
      staleConfirmedIds.length
        ? supabase
            .from('delivery_checkins')
            .update({ status: 'concluido' } as any)
            .in('id', staleConfirmedIds)
        : Promise.resolve({ error: null }),
      staleWaitlistIds.length
        ? supabase
            .from('delivery_checkins')
            .update({
              status: 'cancelado',
              cancelled_at: nowIso,
              cancel_reason: 'Expirado automaticamente ao iniciar novo dia operacional',
            } as any)
            .in('id', staleWaitlistIds)
        : Promise.resolve({ error: null }),
    ];

    const results = await Promise.all(updates);
    const failed = results.find((result) => result?.error);

    if (failed?.error) {
      console.error('Erro ao expirar check-ins antigos do entregador', failed.error);
    }
  }, [todayStr]);

  const getCurrentOperationalCheckins = useCallback(async (driverId: string, shiftId: string) => {
    const { data, error } = await supabase
      .from('delivery_checkins')
      .select('id, status, waitlist_entered_at, created_at')
      .eq('shift_id', shiftId)
      .eq('driver_id', driverId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erro ao buscar check-ins do dia operacional', error);
      return null;
    }

    return data ?? [];
  }, []);

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);

    // Fetch driver profile
    const { data: driverData } = await supabase
      .from('delivery_drivers')
      .select('id, nome, status, password_changed')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (!driverData) {
      setDriver(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setDriver(driverData as any);

    // Check if password change is required
    if (!(driverData as any).password_changed) {
      setForcePasswordDialog(true);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    await cleanupStaleCheckins(driverData.id);

    // Fetch today's shift (first one for today)
    const { data: shifts } = await supabase
      .from('delivery_shifts')
      .select('id, vagas')
      .eq('data', todayStr)
      .order('horario_inicio', { ascending: true })
      .limit(1);

    const shift = shifts?.[0];
    setShiftExists(!!shift);

    if (!shift) {
      setTodayShiftId(null);
      setCheckinState('none');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setTodayShiftId(shift.id);

    // Get confirmed count
    const { count: confirmedCount } = await supabase
      .from('delivery_checkins')
      .select('*', { count: 'exact', head: true })
      .eq('shift_id', shift.id)
      .eq('status', 'confirmado');

    setHasVagas((confirmedCount || 0) < shift.vagas);

    // Check my checkin status
    const myCheckins = await getCurrentOperationalCheckins(driverData.id, shift.id);
    const myCheckin = myCheckins?.find((checkin) => isActiveCheckinStatus(checkin.status));
    if (myCheckin) {
      if (normalizeCheckinStatus(myCheckin.status) === 'fila_espera') {
        setCheckinState('waitlist');
        setCheckinId(myCheckin.id);
        const { data: allWaitlist } = await supabase
          .from('delivery_checkins')
          .select('id, waitlist_entered_at')
          .eq('shift_id', shift.id)
          .eq('status', 'fila_espera')
          .order('waitlist_entered_at', { ascending: true });
        const pos = (allWaitlist || []).findIndex(w => w.id === myCheckin.id) + 1;
        setWaitlistPosition(pos);
      } else {
        setCheckinState('confirmed');
        setCheckinId(myCheckin.id);
      }
    } else {
      setCheckinState('none');
      setCheckinId(null);
    }

    // Check for unread promoted notification
    const { data: promoNotifs } = await supabase
      .from('notifications')
      .select('id, message')
      .eq('user_id', user.id)
      .eq('type', 'fila_promovido')
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(1);
    if (promoNotifs?.[0]) {
      setPromotedNotification(promoNotifs[0].message);
      await supabase.from('notifications').update({ read: true } as any).eq('id', promoNotifs[0].id);
    } else {
      setPromotedNotification(null);
    }

    setLoading(false);
    setRefreshing(false);
  }, [cleanupStaleCheckins, getCurrentOperationalCheckins, user, todayStr]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const getDeviceInfo = async () => {
    let deviceIp = 'indisponível';
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const data = await res.json();
      deviceIp = data.ip || 'indisponível';
    } catch { /* ignore */ }
    return {
      deviceIp,
      deviceUserAgent: navigator.userAgent,
      deviceInfo: `${screen.width}x${screen.height}`,
    };
  };

  const markPasswordChanged = useCallback(async () => {
    if (!user) throw new Error('Usuário não autenticado');

    const { error } = await (supabase as any).rpc('mark_password_changed', {
      p_user_id: user.id,
    });

    if (error) {
      throw new Error(error.message || 'Erro ao confirmar troca de senha');
    }
  }, [user]);

  const handleAttemptCheckin = async () => {
    if (!driver || !todayShiftId || !user) return;

    // Re-check operational date at action time to prevent stale-state check-ins
    const currentOpDate = getBrasiliaToday();
    const currentHour = getBrasiliaHour();
    if (currentHour < 15 || currentHour >= 18) {
      toast.error('Check-in permitido apenas entre 15h e 17:59');
      return;
    }

    setActionLoading(true);

    // Verify shift belongs to current operational date
    const { data: shiftCheck } = await supabase
      .from('delivery_shifts')
      .select('data')
      .eq('id', todayShiftId)
      .single();

    if (shiftCheck?.data !== currentOpDate) {
      toast.error('Este turno não pertence ao dia operacional atual');
      fetchAll(); // refresh to get correct shift
      setActionLoading(false);
      return;
    }

    await cleanupStaleCheckins(driver.id);

    const { deviceIp, deviceUserAgent, deviceInfo } = await getDeviceInfo();

    const { data, error } = await supabase.rpc('attempt_checkin', {
      p_shift_id: todayShiftId,
      p_driver_id: driver.id,
      p_device_ip: deviceIp,
      p_device_user_agent: deviceUserAgent,
      p_device_info: deviceInfo,
    });

    if (error) {
      console.error('Erro no attempt_checkin RPC:', error);
      toast.error('Erro ao processar check-in');
      setActionLoading(false);
      return;
    }

    const result = data as any;

    if (result?.error) {
      toast.error(result.error);
    } else if (result?.status === 'already_confirmed') {
      toast.info('Você já confirmou este turno');
    } else if (result?.status === 'already_waitlist') {
      toast.info('Você já está na fila de espera');
    } else if (result?.status === 'confirmado') {
      toast.success('Check-in confirmado!');
    } else if (result?.status === 'fila_espera') {
      toast.success(`Você entrou na fila de espera (posição ${result.posicao})`);
    }

    fetchAll();
    setActionLoading(false);
  };

  const handleCancelCheckin = async () => {
    if (!checkinId || !todayShiftId || !driver || !user) return;
    setActionLoading(true);

    const wasConfirmed = checkinState === 'confirmed';
    const { deviceIp, deviceUserAgent, deviceInfo } = await getDeviceInfo();

    const { error } = await supabase
      .from('delivery_checkins')
      .update({
        status: 'cancelado',
        cancelled_at: new Date().toISOString(),
        cancel_reason: cancelReason || null,
      } as any)
      .eq('id', checkinId);

    if (error) {
      toast.error('Erro ao cancelar');
      setActionLoading(false);
      return;
    }

    // Log cancellation
    await logCheckinAction({
      checkinId,
      driverId: driver.id,
      action: 'cancelamento',
      performedBy: user.id,
      deviceIp,
      deviceUserAgent,
      deviceInfo,
    });

    // If was confirmed (not waitlist), try to promote from waitlist
    if (wasConfirmed) {
      const isAfter18h = getBrasiliaHour() >= 18;
      try {
        const promoted = await promoteFromWaitlist(todayShiftId, isAfter18h);
        if (promoted.length > 0) {
          toast.info(`${promoted[0].nome} foi promovido(a) da fila de espera`);
        }
      } catch (promoError) {
        console.error('Erro ao promover da fila:', promoError);
      }
    }

    toast.success(wasConfirmed ? 'Check-in cancelado' : 'Saiu da fila de espera');
    setCancelDialog(false);
    setCancelReason('');
    fetchAll();
    setActionLoading(false);
  };

  const handleLeaveWaitlist = async () => {
    if (!checkinId || !driver || !user) return;
    setActionLoading(true);
    const { deviceIp, deviceUserAgent, deviceInfo } = await getDeviceInfo();

    await supabase
      .from('delivery_checkins')
      .update({ status: 'cancelado', cancelled_at: new Date().toISOString() } as any)
      .eq('id', checkinId);

    // Log leaving waitlist
    await logCheckinAction({
      checkinId,
      driverId: driver.id,
      action: 'fila_saida',
      performedBy: user.id,
      deviceIp,
      deviceUserAgent,
      deviceInfo,
    });

    toast.success('Saiu da fila de espera');
    fetchAll();
    setActionLoading(false);
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
      try {
        await markPasswordChanged();
        toast.success('Senha alterada com sucesso!');
        setPasswordDialog(false);
        setNewPassword('');
      } catch (markError: any) {
        setPasswordError(markError.message || 'Erro ao confirmar troca de senha');
      }
    }
    setPasswordSaving(false);
  };

  const handleForceChangePassword = async () => {
    if (!/^\d{4}$/.test(forceNewPassword)) {
      setForcePasswordError('A senha deve ter exatamente 4 dígitos numéricos');
      return;
    }
    setForcePasswordSaving(true);
    setForcePasswordError('');
    const { padPin } = await import('@/lib/pin-utils');
    const { error: authError } = await supabase.auth.updateUser({ password: padPin(forceNewPassword) });
    if (authError) {
      setForcePasswordError(authError.message);
      setForcePasswordSaving(false);
      return;
    }

    try {
      await markPasswordChanged();
      toast.success('Senha alterada com sucesso!');
      setForcePasswordDialog(false);
      setForceNewPassword('');
      fetchAll();
    } catch (markError: any) {
      setForcePasswordError(markError.message || 'Erro ao confirmar troca de senha');
    }
    setForcePasswordSaving(false);
    // Reload to continue to portal
  };

  // Blocked states
  if (!loading && driver && (driver.status === 'inativo' || driver.status === 'suspenso')) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <div className="w-full max-w-[480px] bg-card rounded-xl border p-6 text-center space-y-4">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
          <h2 className="text-lg font-semibold text-foreground">Conta {driver.status === 'inativo' ? 'inativa' : 'suspensa'}</h2>
          <p className="text-muted-foreground text-sm">Entre em contato com a administração.</p>
          <button onClick={signOut} className="w-full h-12 rounded-lg border text-muted-foreground font-medium text-sm hover:bg-muted transition-colors flex items-center justify-center gap-2">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </div>
    );
  }

  if (!loading && !driver) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <div className="w-full max-w-[480px] bg-card rounded-xl border p-6 text-center space-y-4">
          <p className="text-muted-foreground text-sm">Perfil de entregador não encontrado.</p>
          <button onClick={signOut} className="w-full h-12 rounded-lg border text-muted-foreground font-medium text-sm hover:bg-muted transition-colors flex items-center justify-center gap-2">
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>
      </div>
    );
  }

  // Determine time window
  const isBeforeWindow = brasiliaHour < 15;
  const isInWindow = brasiliaHour >= 15 && brasiliaHour < 18;
  const isAfterWindow = brasiliaHour >= 18;

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <header className="sticky top-0 z-20 h-14 bg-sidebar flex items-center justify-between px-4">
        <span className="text-sidebar-accent-foreground font-bold text-base tracking-tight">CAIXA LOVE</span>
        <div className="flex items-center gap-3">
          {driver && <span className="text-sidebar-foreground/70 text-sm hidden sm:block">{driver.nome}</span>}
          <NotificationBell />
          <button onClick={() => fetchAll()} disabled={refreshing} className="text-sidebar-foreground/70 hover:text-sidebar-accent-foreground transition-colors">
            <RefreshCw className={`h-[18px] w-[18px] ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setPasswordDialog(true)} className="text-sidebar-foreground/70 hover:text-sidebar-accent-foreground transition-colors">
            <Settings className="h-[18px] w-[18px]" />
          </button>
          <button onClick={signOut} className="text-sidebar-foreground/70 hover:text-sidebar-accent-foreground transition-colors">
            <LogOut className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      <main className="max-w-[480px] mx-auto px-4 py-8 flex flex-col items-center gap-6">
        {loading ? (
          <div className="space-y-4 w-full">
            <Skeleton className="h-8 w-40 mx-auto" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : (
          <>
            {/* Promoted notification banner */}
            {promotedNotification && (
              <div className="w-full bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <p className="text-sm font-medium text-green-800">🟢 {promotedNotification}</p>
              </div>
            )}

            {/* Date */}
            <p className="text-xl font-bold text-foreground">{todayFormatted}</p>

            {/* No shift configured */}
            {!shiftExists && (
              <div className="w-full bg-card rounded-xl border p-6 text-center">
                <p className="text-sm text-muted-foreground">Sem escala configurada para hoje</p>
              </div>
            )}

            {/* Shift exists */}
            {shiftExists && (
              <div className="w-full space-y-4">
                {/* Before 15h */}
                {isBeforeWindow && (
                  <button
                    disabled
                    className="w-full h-14 rounded-xl border border-border bg-muted/50 text-muted-foreground font-semibold text-lg cursor-not-allowed"
                  >
                    Check-in disponível às 15h
                  </button>
                )}

                {/* In window 15h-17:59 */}
                {isInWindow && checkinState === 'none' && hasVagas && (
                  <button
                    className="w-full h-14 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold text-lg uppercase tracking-wide transition-colors disabled:opacity-60"
                    disabled={actionLoading}
                    onClick={handleAttemptCheckin}
                  >
                    {actionLoading ? 'Processando...' : 'FAZER CHECK-IN HOJE'}
                  </button>
                )}

                {isInWindow && checkinState === 'none' && !hasVagas && (
                  <button
                    className="w-full h-14 rounded-xl border-2 border-orange-500 text-orange-600 font-bold text-lg uppercase tracking-wide hover:bg-orange-50 transition-colors disabled:opacity-60"
                    disabled={actionLoading}
                    onClick={handleAttemptCheckin}
                  >
                    {actionLoading ? 'Processando...' : 'ENTRAR NA FILA DE ESPERA'}
                  </button>
                )}

                {isInWindow && checkinState === 'confirmed' && (
                  <div className="w-full space-y-4">
                    <div className="bg-card rounded-xl border p-6 text-center space-y-2">
                      <p className="text-lg font-semibold text-foreground">✅ Check-in confirmado para hoje</p>
                      <p className="text-sm text-muted-foreground">Alterações permitidas até 17:59</p>
                    </div>
                    <button
                      className="w-full h-14 rounded-xl border-2 border-destructive text-destructive font-bold text-lg uppercase tracking-wide hover:bg-destructive/10 transition-colors disabled:opacity-60"
                      disabled={actionLoading}
                      onClick={() => setCancelDialog(true)}
                    >
                      Cancelar Check-in
                    </button>
                  </div>
                )}

                {isInWindow && checkinState === 'waitlist' && (
                  <div className="w-full space-y-4">
                    <div className="bg-card rounded-xl border p-6 text-center space-y-3">
                      <p className="text-base font-semibold text-foreground">Você está na fila de espera</p>
                      <p className="text-3xl font-bold text-foreground">Posição: {waitlistPosition}</p>
                      <p className="text-sm text-muted-foreground">Vagas disponíveis apenas em caso de cancelamento</p>
                      <p className="text-xs text-muted-foreground">Alterações permitidas até 17:59</p>
                    </div>
                    <button
                      className="w-full h-14 rounded-xl bg-destructive hover:bg-destructive/90 text-white font-bold text-lg uppercase tracking-wide transition-colors disabled:opacity-60"
                      disabled={actionLoading}
                      onClick={handleLeaveWaitlist}
                    >
                      Sair da Fila
                    </button>
                  </div>
                )}

                {/* After 18h */}
                {isAfterWindow && (
                  <div className="w-full bg-card rounded-xl border p-6 text-center">
                    <p className="text-lg font-medium text-foreground">
                      {checkinState === 'confirmed'
                        ? '✅ Check-in confirmado para hoje'
                        : 'Sem check-in para hoje'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Cancel dialog */}
      <Dialog open={cancelDialog} onOpenChange={(open) => { setCancelDialog(open); if (!open) setCancelReason(''); }}>
        <DialogContent className="sm:max-w-[400px] rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base">Cancelar check-in?</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Motivo (opcional)"
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
            className="min-h-[80px] text-sm"
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setCancelDialog(false); setCancelReason(''); }} className="h-11">
              Voltar
            </Button>
            <Button variant="destructive" onClick={handleCancelCheckin} disabled={actionLoading} className="h-11">
              Confirmar cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password dialog (voluntary) */}
      <Dialog open={passwordDialog} onOpenChange={(open) => { setPasswordDialog(open); if (!open) { setNewPassword(''); setPasswordError(''); } }}>
        <DialogContent className="sm:max-w-[360px] rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base">Alterar senha</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
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
            <p className="text-xs text-muted-foreground text-center">Use 4 dígitos numéricos</p>
            {passwordError && <p className="text-sm text-destructive text-center">{passwordError}</p>}
          </div>
          <DialogFooter>
            <button
              className="w-full h-12 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm uppercase tracking-wide transition-colors disabled:opacity-60"
              disabled={passwordSaving}
              onClick={handleChangePassword}
            >
              {passwordSaving ? 'Salvando...' : 'Salvar nova senha'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Force password change dialog (mandatory first login) */}
      <Dialog open={forcePasswordDialog} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-[400px] rounded-xl [&>button]:hidden" onPointerDownOutside={e => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-base text-center">Troca de senha obrigatória</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              Para sua segurança, você precisa criar uma nova senha antes de continuar.
            </p>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={4}
              pattern="[0-9]*"
              placeholder="Nova senha (4 dígitos)"
              value={forceNewPassword}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                setForceNewPassword(v);
                setForcePasswordError('');
              }}
              className="text-center text-2xl tracking-[0.5em] font-mono h-14 bg-background"
            />
            <p className="text-xs text-muted-foreground text-center">Use 4 dígitos numéricos</p>
            {forcePasswordError && <p className="text-sm text-destructive text-center">{forcePasswordError}</p>}
          </div>
          <DialogFooter>
            <button
              className="w-full h-12 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm uppercase tracking-wide transition-colors disabled:opacity-60"
              disabled={forcePasswordSaving}
              onClick={handleForceChangePassword}
            >
              {forcePasswordSaving ? 'Salvando...' : 'Definir nova senha'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

