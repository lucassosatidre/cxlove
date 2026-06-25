import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type CashflowLoan = {
  id: string;
  name: string;
  contract: string | null;
  company: string | null;
  outstanding_balance: number | null;
  monthly_payment: number | null;
  total_installments: number | null;
  remaining_installments: number | null;
  first_due: string | null;
  last_due: string | null;
  annual_rate: number | null;
  pays_from_account_id: string | null;
  active: boolean;
};

export type CashflowLoanInstallment = {
  id: string;
  loan_id: string;
  seq: number;
  due_date: string;
  amount: number;
  principal: number | null;
  interest: number | null;
  balance_after: number | null;
  paid: boolean;
};

export function useCashflowLoans() {
  return useQuery({
    queryKey: ['cashflow', 'loans'],
    queryFn: async (): Promise<{ loans: CashflowLoan[]; installments: CashflowLoanInstallment[] }> => {
      const { data: loans, error: lErr } = await supabase
        .from('cashflow_loans')
        .select('*')
        .eq('active', true)
        .order('name', { ascending: true });
      if (lErr) throw lErr;

      const { data: installments, error: iErr } = await supabase
        .from('cashflow_loan_installments')
        .select('*')
        .order('due_date', { ascending: true });
      if (iErr) throw iErr;

      return {
        loans: (loans ?? []) as CashflowLoan[],
        installments: (installments ?? []) as CashflowLoanInstallment[],
      };
    },
  });
}
