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
import NotificationBell from '@/components/NotificationBell';

interface DriverProfile {
  id: string;
  nome: string;
  status: string;
}

type CheckinState = 'none' | 'confirmed' | 'waitlist';

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

  // Promoted notification
  const [promotedNotification, setPromotedNotification] = useState<string | null>(null);

  const todayStr = getBrasiliaToday();
  const todayFormatted = getBrasiliaDateFormatted();
  const brasiliaHour = getBrasiliaHour();

  const fetchAll = useCallback(async () => {
    if (!user) return;
    setRefreshing(true);

    // Fetch driver profile
    const { data: driverData } = await supabase
      .from('delivery_drivers')
      .select('id, nome, status')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (!driverData) {
      setDriver(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setDriver(driverData);

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
    const { data: myCheckins } = await supabase
      .from('delivery_checkins')
      .select('id, status, waitlist_entered_at')
      .eq('shift_id', shift.id)
      .eq('driver_id', driverData.id)
      .in('status', ['confirmado', 'fila_espera']);

    const myCheckin = myCheckins?.[0];
    if (myCheckin) {
      if (myCheckin.status === 'confirmado') {
        setCheckinState('confirmed');
        setCheckinId(myCheckin.id);
      } else if (myCheckin.status === 'fila_espera') {
        setCheckinState('waitlist');
        setCheckinId(myCheckin.id);
        // Get position in waitlist
        const { data: allWaitlist } = await supabase
          .from('delivery_checkins')
          .select('id, waitlist_entered_at')
          .eq('shift_id', shift.id)
          .eq('status', 'fila_espera')
          .order('waitlist_entered_at', { ascending: true });
        const pos = (allWaitlist || []).findIndex(w => w.id === myCheckin.id) + 1;
        setWaitlistPosition(pos);
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
      // Mark as read
      await supabase.from('notifications').update({ read: true } as any).eq('id', promoNotifs[0].id);
    } else {
      setPromotedNotification(null);
    }

    setLoading(false);
    setRefreshing(false);
  }, [user, todayStr]);

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

  const handleCheckin = async () => {
    if (!driver || !todayShiftId) return;
    setActionLoading(true);

    // Check for ANY existing records for this driver+shift
    const { data: existing } = await supabase
      .from('delivery_checkins')
      .select('id, status')
      .eq('shift_id', todayShiftId)
      .eq('driver_id', driver.id);

    if (existing?.length) {
      const active = existing.find(c => c.status === 'confirmado' || c.status === 'concluido');
      if (active) {
        toast.info('Você já confirmou este turno');
        setActionLoading(false);
        fetchAll();
        return;
      }
      // Delete ALL old records (cancelled, no_show, fila_espera) to avoid unique constraint
      await supabase.from('delivery_checkins').delete().in('id', existing.map(c => c.id));
    }

    const { deviceIp, deviceUserAgent, deviceInfo } = await getDeviceInfo();

    const { error } = await supabase.from('delivery_checkins').insert({
      shift_id: todayShiftId,
      driver_id: driver.id,
      status: 'confirmado',
      device_ip: deviceIp,
      device_user_agent: deviceUserAgent,
      device_info: deviceInfo,
      origin: 'entregador',
    } as any);

    if (error) {
      if (error.code === '23505') {
        toast.info('Você já está confirmado neste turno');
        fetchAll();
      } else {
        toast.error('Erro ao fazer check-in');
      }
    } else {
      toast.success('Check-in confirmado!');
      fetchAll();
    }
    setActionLoading(false);
  };

  const handleJoinWaitlist = async () => {
    if (!driver || !todayShiftId) return;
    setActionLoading(true);

    // Check for ANY existing records for this driver+shift
    const { data: existing } = await supabase
      .from('delivery_checkins')
      .select('id, status')
      .eq('shift_id', todayShiftId)
      .eq('driver_id', driver.id);

    if (existing?.length) {
      const active = existing.find(c => c.status === 'confirmado' || c.status === 'concluido');
      if (active) {
        toast.info('Você já está confirmado neste turno');
        setActionLoading(false);
        fetchAll();
        return;
      }
      const inQueue = existing.find(c => c.status === 'fila_espera');
      if (inQueue) {
        toast.info('Você já está na fila de espera');
        setActionLoading(false);
        fetchAll();
        return;
      }
      // Delete ALL old records (cancelled, no_show) to avoid unique constraint
      await supabase.from('delivery_checkins').delete().in('id', existing.map(c => c.id));
    }

    const { deviceIp, deviceUserAgent, deviceInfo } = await getDeviceInfo();

    const { error } = await supabase.from('delivery_checkins').insert({
      shift_id: todayShiftId,
      driver_id: driver.id,
      status: 'fila_espera',
      device_ip: deviceIp,
      device_user_agent: deviceUserAgent,
      device_info: deviceInfo,
      origin: 'entregador',
      waitlist_entered_at: new Date().toISOString(),
    } as any);

    if (error) {
      if (error.code === '23505') {
        toast.info('Você já está na fila de espera');
        fetchAll();
      } else {
        toast.error('Erro ao entrar na fila');
      }
    } else {
      toast.success('Você entrou na fila de espera');
      fetchAll();
    }
    setActionLoading(false);
  };

  const handleCancelCheckin = async () => {
    if (!checkinId || !todayShiftId) return;
    setActionLoading(true);

    const wasConfirmed = checkinState === 'confirmed';

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

    // If was confirmed (not waitlist), try to promote from waitlist
    if (wasConfirmed) {
      await promoteFromWaitlist(todayShiftId, false);
    }

    toast.success(wasConfirmed ? 'Check-in cancelado' : 'Saiu da fila de espera');
    setCancelDialog(false);
    setCancelReason('');
    fetchAll();
    setActionLoading(false);
  };

  const handleLeaveWaitlist = async () => {
    if (!checkinId) return;
    setActionLoading(true);
    await supabase
      .from('delivery_checkins')
      .update({ status: 'cancelado', cancelled_at: new Date().toISOString() } as any)
      .eq('id', checkinId);
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
      toast.success('Senha alterada com sucesso!');
      setPasswordDialog(false);
      setNewPassword('');
    }
    setPasswordSaving(false);
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
        <span className="text-sidebar-accent-foreground font-bold text-base tracking-tight">CX Love</span>
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
                    onClick={handleCheckin}
                  >
                    {actionLoading ? 'Processando...' : 'FAZER CHECK-IN HOJE'}
                  </button>
                )}

                {isInWindow && checkinState === 'none' && !hasVagas && (
                  <button
                    className="w-full h-14 rounded-xl border-2 border-orange-500 text-orange-600 font-bold text-lg uppercase tracking-wide hover:bg-orange-50 transition-colors disabled:opacity-60"
                    disabled={actionLoading}
                    onClick={handleJoinWaitlist}
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

      {/* Password dialog */}
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
    </div>
  );
}

/**
 * Promote the next driver from the waitlist for a given shift.
 * Called when a confirmed driver cancels or is removed by admin.
 */
export async function promoteFromWaitlist(shiftId: string, isAfter18h: boolean) {
  // Find next in waitlist
  const { data: waitlist } = await supabase
    .from('delivery_checkins')
    .select('id, driver_id')
    .eq('shift_id', shiftId)
    .eq('status', 'fila_espera')
    .order('waitlist_entered_at', { ascending: true })
    .limit(1);

  const next = waitlist?.[0];
  if (!next) return null;

  // Promote
  const updatePayload: any = {
    status: 'confirmado',
    confirmed_at: new Date().toISOString(),
  };
  if (isAfter18h) {
    updatePayload.substituto_pos_18h = true;
  }
  await supabase.from('delivery_checkins').update(updatePayload).eq('id', next.id);

  // Get driver name
  const { data: driverData } = await supabase
    .from('delivery_drivers')
    .select('nome, auth_user_id')
    .eq('id', next.driver_id)
    .single();

  const driverName = driverData?.nome || 'Entregador';
  const driverAuthId = driverData?.auth_user_id;

  // Notify promoted driver
  if (driverAuthId) {
    const driverMessage = isAfter18h
      ? 'Você foi chamado da fila de espera para o turno de hoje. Entre em contato com a pizzaria'
      : 'Você foi promovido da fila de espera! Seu check-in está confirmado para hoje.';

    await supabase.from('notifications').insert({
      user_id: driverAuthId,
      title: 'Fila de espera',
      message: driverMessage,
      type: 'fila_promovido',
    } as any);
  }

  // Notify all admins
  const { data: adminRoles } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin');

  if (adminRoles?.length) {
    const adminMessage = isAfter18h
      ? `O entregador ${driverName} foi adicionado da fila de espera. Avise-o pois o horário já passou das 18h`
      : `O entregador ${driverName} foi promovido automaticamente da fila de espera`;

    for (const admin of adminRoles) {
      await supabase.from('notifications').insert({
        user_id: admin.user_id,
        title: 'Fila de espera — promoção',
        message: adminMessage,
        type: 'fila_promovido_admin',
      } as any);
    }
  }

  return next;
}
