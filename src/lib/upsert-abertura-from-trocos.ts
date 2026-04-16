import { supabase } from '@/integrations/supabase/client';
import { DenomCounts } from '@/components/DenominationCountTable';

const DENOMINATIONS = ['200', '100', '50', '20', '10', '5', '2'] as const;

/**
 * Convert Bloco 2 trocos (stored as R$ per denomination) to quantity per denomination,
 * then upsert cash_snapshots with snapshot_type='abertura' for the same-day closing.
 *
 * The trocos DenomCounts stores R$ values (e.g. {100: 300} means 3 × R$100).
 * cash_snapshots.counts expects QUANTITIES (e.g. {100: 3}).
 */
export async function upsertAberturaFromTrocos(
  trocosSalao: DenomCounts,
  trocosTele: DenomCounts,
  closingDate: string,
  userId: string,
): Promise<{ error?: string }> {
  // Convert R$ → qty for each denomination
  const toQtyCounts = (reais: DenomCounts): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const d of DENOMINATIONS) {
      const val = reais[d] || 0;
      const qty = Math.round(val / Number(d));
      if (qty > 0) counts[d] = qty;
    }
    return counts;
  };

  const salonQty = toQtyCounts(trocosSalao);
  const teleQty = toQtyCounts(trocosTele);
  const salonTotal = DENOMINATIONS.reduce((s, d) => s + (trocosSalao[d] || 0), 0);
  const teleTotal = DENOMINATIONS.reduce((s, d) => s + (trocosTele[d] || 0), 0);

  // Skip if both are empty
  if (salonTotal === 0 && teleTotal === 0) return {};

  // Find same-day closings
  const [salonClosing, teleClosing] = await Promise.all([
    supabase
      .from('salon_closings')
      .select('id')
      .eq('closing_date', closingDate)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('daily_closings')
      .select('id')
      .eq('closing_date', closingDate)
      .limit(1)
      .maybeSingle(),
  ]);

  const errors: string[] = [];

  // Upsert salon abertura
  if (salonTotal > 0) {
    if (!salonClosing?.data?.id) {
      errors.push('Salão');
    } else {
      await upsertSnapshot(salonClosing.data.id, null, salonQty, salonTotal, userId);
    }
  }

  // Upsert tele abertura
  if (teleTotal > 0) {
    if (!teleClosing?.data?.id) {
      errors.push('Tele');
    } else {
      await upsertSnapshot(null, teleClosing.data.id, teleQty, teleTotal, userId);
    }
  }

  if (errors.length > 0) {
    return { error: `Caixa do dia ainda não foi aberto (${errors.join(', ')}). Aguarde a abertura automática às 03h.` };
  }

  return {};
}

async function upsertSnapshot(
  salonClosingId: string | null,
  dailyClosingId: string | null,
  counts: Record<string, number>,
  total: number,
  userId: string,
) {
  const now = new Date().toISOString();
  const filterCol = salonClosingId ? 'salon_closing_id' : 'daily_closing_id';
  const filterVal = salonClosingId || dailyClosingId;

  // Check if abertura snapshot already exists for this closing
  const { data: existing } = await supabase
    .from('cash_snapshots')
    .select('id')
    .eq(filterCol, filterVal!)
    .eq('snapshot_type', 'abertura')
    .limit(1)
    .maybeSingle();

  const payload = {
    salon_closing_id: salonClosingId,
    daily_closing_id: dailyClosingId,
    user_id: userId,
    counts,
    total,
    snapshot_type: 'abertura',
    updated_at: now,
  };

  if (existing?.id) {
    await supabase.from('cash_snapshots').update(payload).eq('id', existing.id);
  } else {
    await supabase.from('cash_snapshots').insert(payload);
  }
}
