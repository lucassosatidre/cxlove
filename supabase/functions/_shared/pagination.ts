// @ts-nocheck
// Helper para contornar o limite padrão de 1000 linhas do PostgREST/Supabase.
// Aplique em qualquer .select() onde a tabela alvo possa ter > 1000 rows
// (audit_card_transactions, audit_bank_deposits, voucher_lot_items,
// imported_orders por daily_closing_id em dias grandes, etc.).
//
// Uso:
//   const rows = await fetchAllPaginated(
//     supabase.from('audit_card_transactions')
//       .select('expected_deposit_date,net_amount')
//       .eq('audit_period_id', periodId)
//   );
//
// IMPORTANTE: NÃO chame .range() / .limit() na query passada. O helper aplica
// .range() internamente em cada iteração.
export async function fetchAllPaginated<T = any>(
  query: any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // Salvaguarda contra loop infinito (10M rows)
  const MAX_ITERATIONS = 10_000;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
