import { supabase } from '@/integrations/supabase/client';
import { DenomCounts } from '@/components/DenominationCountTable';

const DENOMINATIONS = ['200', '100', '50', '20', '10', '5', '2'] as const;

/**
 * Convert Bloco 2 trocos (stored as R$ per denomination) to quantity per denomination,
 * then upsert cash_expectations for the same closing_date so that the
 * "ESPERADO" column in the operator's Abertura calculator is pre-filled.
 *
 * The trocos DenomCounts stores R$ values (e.g. {100: 300} means 3 × R$100).
 * cash_expectations.counts expects QUANTITIES (e.g. {100: 3}).
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

  const upsertExpectation = async (
    sector: 'salao' | 'tele',
    counts: Record<string, number>,
    total: number,
  ) => {
    const now = new Date().toISOString();

    // Check if expectation already exists for this date+sector
    const { data: existing } = await supabase
      .from('cash_expectations')
      .select('id')
      .eq('closing_date', closingDate)
      .eq('sector', sector)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from('cash_expectations')
        .update({
          counts,
          total,
          created_by: userId,
          updated_at: now,
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('cash_expectations')
        .insert({
          closing_date: closingDate,
          sector,
          counts,
          total,
          created_by: userId,
        });
    }
  };

  if (salonTotal > 0) {
    await upsertExpectation('salao', salonQty, salonTotal);
  }

  if (teleTotal > 0) {
    await upsertExpectation('tele', teleQty, teleTotal);
  }

  return {};
}
