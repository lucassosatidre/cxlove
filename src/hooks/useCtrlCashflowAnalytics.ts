import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CtrlBillRow = {
  id: string;
  vencimento: string; // ISO date
  amount: number;     // positivo (valor absoluto de saída)
  fornecedor: string | null;
  descricao: string | null;
  category: string | null;
};

function toISOLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Contas a pagar em aberto vencidas + hoje (lê ctrl_contas_pagar direto).
 * Retorna itens já com valor positivo pra exibição.
 */
export function useCtrlUpcomingBillsDaily() {
  return useQuery({
    queryKey: ['ctrl', 'upcoming-daily'],
    queryFn: async () => {
      const hojeISO = toISOLocal(new Date());
      const { data, error } = await supabase
        .from('ctrl_contas_pagar' as any)
        .select('id,vencimento,amount,fornecedor,descricao,category,paid')
        .eq('paid', false)
        .lt('amount', 0)
        .lte('vencimento', hojeISO)
        .order('vencimento', { ascending: true });
      if (error) throw error;
      const rows = ((data ?? []) as any[]).map((r) => ({
        id: String(r.id),
        vencimento: String(r.vencimento),
        amount: Math.abs(Number(r.amount) || 0),
        fornecedor: r.fornecedor ?? null,
        descricao: r.descricao ?? null,
        category: r.category ?? null,
      })) as CtrlBillRow[];
      const total = rows.reduce((s, r) => s + r.amount, 0);
      return { total, n: rows.length, items: rows };
    },
  });
}

/**
 * Contas a pagar futuras (vencimento > hoje). O consumidor agrupa em faixas semanais.
 */
export function useCtrlUpcomingBills() {
  return useQuery({
    queryKey: ['ctrl', 'upcoming'],
    queryFn: async (): Promise<CtrlBillRow[]> => {
      const hojeISO = toISOLocal(new Date());
      const { data, error } = await supabase
        .from('ctrl_contas_pagar' as any)
        .select('id,vencimento,amount,fornecedor,descricao,category,paid')
        .eq('paid', false)
        .lt('amount', 0)
        .gt('vencimento', hojeISO)
        .order('vencimento', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: String(r.id),
        vencimento: String(r.vencimento),
        amount: Math.abs(Number(r.amount) || 0),
        fornecedor: r.fornecedor ?? null,
        descricao: r.descricao ?? null,
        category: r.category ?? null,
      }));
    },
  });
}
