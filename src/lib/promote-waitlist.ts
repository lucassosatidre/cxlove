import { supabase } from '@/integrations/supabase/client';
import { logCheckinAction } from '@/lib/checkin-logger';

/**
 * Promote the next driver(s) from the waitlist for a given shift.
 * Strictly orders by waitlist_entered_at ASC.
 */
export async function promoteFromWaitlist(
  shiftId: string,
  isAfter18h: boolean,
  maxPromotions: number = 1
): Promise<{ id: string; driver_id: string; nome: string }[]> {
  const { data: waitlist } = await supabase
    .from('delivery_checkins')
    .select('id, driver_id, waitlist_entered_at')
    .eq('shift_id', shiftId)
    .eq('status', 'fila_espera')
    .not('waitlist_entered_at', 'is', null)
    .order('waitlist_entered_at', { ascending: true })
    .limit(maxPromotions);

  if (!waitlist?.length) return [];

  const promoted: { id: string; driver_id: string; nome: string }[] = [];

  for (const next of waitlist) {
    const nowIso = new Date().toISOString();
    const updatePayload: any = {
      status: 'confirmado',
      confirmed_at: nowIso,
    };
    if (isAfter18h) {
      updatePayload.substituto_pos_18h = true;
    }
    await supabase.from('delivery_checkins').update(updatePayload).eq('id', next.id);

    const { data: driverData } = await supabase
      .from('delivery_drivers')
      .select('nome, auth_user_id')
      .eq('id', next.driver_id)
      .single();

    const driverName = driverData?.nome || 'Entregador';
    const driverAuthId = driverData?.auth_user_id;
    promoted.push({ id: next.id, driver_id: next.driver_id, nome: driverName });

    // Log the promotion
    if (driverAuthId) {
      await logCheckinAction({
        checkinId: next.id,
        driverId: next.driver_id,
        action: 'fila_promovido',
        performedBy: 'system' as any,
      });
    }

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
      const waitlistPos = waitlist.indexOf(next) + 1;
      const adminMessage = isAfter18h
        ? `O entregador ${driverName} (posição ${waitlistPos} da fila) foi adicionado da fila de espera. Avise-o pois o horário já passou das 18h`
        : `O entregador ${driverName} (posição ${waitlistPos} da fila) foi promovido automaticamente da fila de espera`;

      for (const admin of adminRoles) {
        await supabase.from('notifications').insert({
          user_id: admin.user_id,
          title: 'Fila de espera — promoção',
          message: adminMessage,
          type: 'fila_promovido_admin',
        } as any);
      }
    }
  }

  return promoted;
}
