import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type MonthlySummaryRow = {
  ano: number;
  mes: number;
  account_id: string;
  account_name: string;
  company: string | null;
  entradas: number;
  saidas: number;
};

export type CategorySummaryRow = {
  company: string | null;
  category: string;
  total: number;
  n: number;
};

export function useCashflowMonthlySummary() {
  return useQuery({
    queryKey: ['cashflow', 'monthly-summary'],
    queryFn: async (): Promise<MonthlySummaryRow[]> => {
      const { data, error } = await (supabase.rpc as any)('cashflow_monthly_summary');
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        entradas: Number(r.entradas) || 0,
        saidas: Number(r.saidas) || 0,
      }));
    },
  });
}

export function useCashflowCategorySummary(start: string, end: string) {
  return useQuery({
    queryKey: ['cashflow', 'category-summary', start, end],
    queryFn: async (): Promise<CategorySummaryRow[]> => {
      const { data, error } = await (supabase.rpc as any)('cashflow_category_summary', {
        p_start: start,
        p_end: end,
      });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ...r,
        total: Number(r.total) || 0,
        n: Number(r.n) || 0,
      }));
    },
    enabled: Boolean(start && end),
  });
}
