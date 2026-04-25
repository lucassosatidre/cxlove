import { supabase } from '@/integrations/supabase/client';

/**
 * Promote the next driver(s) from the waitlist for a given shift.
 *
 * Calls the SECURITY DEFINER RPC `promote_from_waitlist`, which:
 *  - Locks the shift row and counts confirmados atomically
 *  - Only promotes if vagas_abertas = vagas_configuradas - confirmados > 0
 *    (impede promoção indevida quando admin inseriu extras acima do limite)
 *  - Strictly orders waitlist by waitlist_entered_at ASC
 *  - Marks substituto_pos_18h when applicable
 *  - Logs `fila_promovido` with the cancelling user as performed_by
 *  - Notifies the promoted driver and all admins
 *
 * Bypasses the RLS conflict that previously caused silent failures when a
 * regular driver cancelled and the next-in-line was someone else.
 */
export async function promoteFromWaitlist(
  shiftId: string,
  isAfter18h: boolean,
  maxPromotions: number = 1
): Promise<{ id: string; driver_id: string; nome: string }[]> {
  const { data: { user } } = await supabase.auth.getUser();
  const freedBy = user?.id;

  if (!freedBy) {
    console.error('promoteFromWaitlist: usuário não autenticado');
    return [];
  }

  const { data, error } = await supabase.rpc('promote_from_waitlist', {
    p_shift_id: shiftId,
    p_freed_by: freedBy,
    p_is_after_18h: isAfter18h,
    p_max_promotions: maxPromotions,
  });

  if (error) {
    console.error('Erro ao promover da fila:', error);
    return [];
  }

  const result = data as {
    promoted_count: number;
    reason: string;
    promoted: { checkin_id: string; driver_id: string; nome: string }[];
  } | null;

  if (!result || !result.promoted?.length) {
    if (result?.reason && result.reason !== 'fila_vazia' && result.reason !== 'ok') {
      console.log(`promoteFromWaitlist: nenhuma promoção (${result.reason})`);
    }
    return [];
  }

  return result.promoted.map(p => ({
    id: p.checkin_id,
    driver_id: p.driver_id,
    nome: p.nome,
  }));
}
