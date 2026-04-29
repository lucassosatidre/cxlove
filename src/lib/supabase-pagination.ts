// Helper para contornar o limite padrão de 1000 linhas do PostgREST/Supabase
// no frontend. Mesmo padrão da edge function `_shared/pagination.ts`.
//
// Uso:
//   const rows = await fetchAllPaginated(
//     supabase.from('audit_card_transactions')
//       .select('expected_deposit_date,net_amount')
//       .eq('audit_period_id', periodId)
//   );
//
// IMPORTANTE: não chame .range() / .limit() na query — o helper aplica .range()
// internamente em cada iteração.
export async function fetchAllPaginated<T = any>(
  query: any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
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
