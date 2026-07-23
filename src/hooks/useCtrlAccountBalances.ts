import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CtrlAccountWithBalance = {
  id: string;
  name: string;
  bank: string | null;
  company: string | null;
  account_number: string | null;
  kind: string | null;
  overdraft_limit: number;
  is_passthrough: boolean;
  active: boolean;
  balance: { own_balance: number; as_of: string } | null;
};

export function useCtrlAccountBalances() {
  return useQuery({
    queryKey: ['ctrl', 'account-balances'],
    queryFn: async (): Promise<CtrlAccountWithBalance[]> => {
      const { data: accounts, error: accErr } = await supabase
        .from('cashflow_accounts')
        .select('*')
        .eq('active', true)
        .order('company', { ascending: true })
        .order('name', { ascending: true });
      if (accErr) throw accErr;

      const { data: balances, error: balErr } = await (supabase as any)
        .from('ctrl_account_balances')
        .select('account_id, own_balance, updated_at');
      if (balErr) throw balErr;

      const map = new Map<string, { own_balance: number; as_of: string }>();
      for (const b of (balances ?? []) as any[]) {
        map.set(b.account_id, { own_balance: Number(b.own_balance ?? 0), as_of: b.updated_at });
      }

      return (accounts ?? []).map((a: any) => ({
        ...a,
        balance: map.get(a.id) ?? null,
      }));
    },
  });
}

export function useUpdateCtrlBalances() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: { account_id: string; own_balance: number }[]) => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      const payload = rows.map((r) => ({
        account_id: r.account_id,
        own_balance: r.own_balance,
        updated_by: uid,
        updated_at: new Date().toISOString(),
      }));
      const { error } = await (supabase as any)
        .from('ctrl_account_balances')
        .upsert(payload, { onConflict: 'account_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ctrl', 'account-balances'] });
    },
  });
}
