import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type RetidoRow = { category: string; total: number; n: number };
export function useCashflowRetidoSummary(start: string, end: string) {
  return useQuery({
    queryKey: ['cashflow', 'retido', start, end],
    enabled: Boolean(start && end),
    queryFn: async (): Promise<RetidoRow[]> => {
      const { data, error } = await (supabase.rpc as any)('cashflow_retido_summary', { p_start: start, p_end: end });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ category: r.category ?? 'Sem categoria', total: Number(r.total) || 0, n: Number(r.n) || 0 }));
    },
  });
}

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

export type MonthlyConsolidatedRow = {
  ym: string;
  entradas: number;
  saidas: number;
};

export function useCashflowMonthlyConsolidated() {
  return useQuery({
    queryKey: ['cashflow', 'monthly-consolidated'],
    queryFn: async (): Promise<MonthlyConsolidatedRow[]> => {
      const { data, error } = await (supabase.rpc as any)('cashflow_monthly_consolidated');
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        ym: String(r.ym),
        entradas: Number(r.entradas) || 0,
        saidas: Number(r.saidas) || 0,
      }));
    },
  });
}

export type UpcomingBillRow = {
  vencimento: string;
  amount: number;
  category: string | null;
  fornecedor: string | null;
  descricao: string | null;
};

export function useCashflowUpcomingBills() {
  return useQuery({
    queryKey: ['cashflow', 'upcoming-bills'],
    queryFn: async (): Promise<UpcomingBillRow[]> => {
      const { data, error } = await (supabase.rpc as any)('cashflow_upcoming_bills');
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        vencimento: String(r.vencimento),
        amount: Number(r.amount) || 0,
        category: r.category ?? null,
        fornecedor: r.fornecedor ?? null,
        descricao: r.descricao ?? r.fornecedor ?? null,
      }));
    },
  });
}

export type DailyBillItem = { categoria: string; fornecedor: string | null; descricao: string | null; valor: number };
export type UpcomingBillDayRow = { date: string; total: number; n: number; items: DailyBillItem[] };

export function useCashflowUpcomingBillsDaily(start: string, days: number) {
  return useQuery({
    queryKey: ['cashflow', 'upcoming-bills-daily', start, days],
    queryFn: async (): Promise<UpcomingBillDayRow[]> => {
      const { data, error } = await (supabase.rpc as any)('cashflow_upcoming_bills_daily', {
        p_start: start,
        p_days: days,
      });
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        date: String(r.date),
        total: Number(r.total) || 0,
        n: Number(r.n) || 0,
        items: (r.items ?? []).map((it: any) => ({
          categoria: it.categoria ?? 'Sem categoria',
          fornecedor: it.fornecedor ?? null,
          descricao: it.descricao ?? it.fornecedor ?? null,
          valor: Number(it.valor) || 0,
        })),
      }));
    },
    enabled: Boolean(start),
  });
}

export type StatementCoverageRow = { account_id: string; account_name: string; company: string; min_tx: string | null; max_tx: string | null; n: number; saldo_final: number | null };
export function useCashflowStatementCoverage() {
  return useQuery({ queryKey: ['cashflow','statement-coverage'], queryFn: async (): Promise<StatementCoverageRow[]> => {
    const { data, error } = await (supabase.rpc as any)('cashflow_statement_coverage');
    if (error) throw error;
    return (data ?? []).map((r:any)=>({ account_id:String(r.account_id), account_name:r.account_name, company:r.company, min_tx:r.min_tx?String(r.min_tx):null, max_tx:r.max_tx?String(r.max_tx):null, n:Number(r.n)||0, saldo_final:r.saldo_final==null?null:Number(r.saldo_final) }));
  }});
}
export type ReconRow = { tipo:'casado'|'saipos_sem_banco'|'banco_sem_saipos'; account_name:string|null; valor:number; vencimento:string|null; fornecedor:string|null; descricao:string|null; categoria:string|null; tx_date:string|null; descricao_banco:string|null; confianca:'ALTA'|'MEDIA'|null; saipos_id:string|null; tx_id:string|null; conferido:boolean };
export function useReconcileSaidas(ini: string, fim: string) {
  return useQuery({ queryKey:['cashflow','reconcile',ini,fim], enabled: Boolean(ini&&fim), queryFn: async (): Promise<ReconRow[]> => {
    const { data, error } = await (supabase.rpc as any)('reconcile_saidas', { p_ini: ini, p_fim: fim });
    if (error) throw error;
    return (data ?? []).map((r:any)=>({ tipo:r.tipo, account_name:r.account_name, valor:Number(r.valor)||0, vencimento:r.vencimento?String(r.vencimento):null, fornecedor:r.fornecedor, descricao:r.descricao ?? r.fornecedor ?? null, categoria:r.categoria, tx_date:r.tx_date?String(r.tx_date):null, descricao_banco:r.descricao_banco, confianca:r.confianca, saipos_id:r.saipos_id ?? null, tx_id:r.tx_id ?? null, conferido:Boolean(r.conferido) }));
  }});
}
