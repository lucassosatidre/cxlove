import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CashflowAccount = {
  id: string;
  name: string;
  bank: string | null;
  company: string | null;
  account_number: string | null;
  kind: string | null;
  overdraft_limit: number;
  is_passthrough: boolean;
  active: boolean;
};

export type CashflowBalance = {
  id: string;
  account_id: string;
  as_of: string;
  own_balance: number;
  provisioned: number;
  limit_available: number;
  note: string | null;
};

export type AccountWithBalance = CashflowAccount & {
  balance: CashflowBalance | null;
};

export function useCashflowBalances() {
  return useQuery({
    queryKey: ['cashflow', 'balances', 'latest'],
    queryFn: async (): Promise<AccountWithBalance[]> => {
      const { data: accounts, error: accErr } = await supabase
        .from('cashflow_accounts')
        .select('*')
        .eq('active', true)
        .order('company', { ascending: true })
        .order('name', { ascending: true });
      if (accErr) throw accErr;

      const { data: balances, error: balErr } = await supabase
        .from('cashflow_balances')
        .select('*')
        .order('as_of', { ascending: false });
      if (balErr) throw balErr;

      const latestByAcc = new Map<string, CashflowBalance>();
      for (const b of (balances ?? []) as CashflowBalance[]) {
        if (!latestByAcc.has(b.account_id)) latestByAcc.set(b.account_id, b);
      }

      return (accounts ?? []).map((a) => ({
        ...(a as CashflowAccount),
        balance: latestByAcc.get((a as CashflowAccount).id) ?? null,
      }));
    },
  });
}

export const fmtBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n ?? 0);
