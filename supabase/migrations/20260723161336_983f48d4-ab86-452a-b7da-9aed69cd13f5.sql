CREATE TABLE IF NOT EXISTS public.ctrl_account_balances (
  account_id uuid PRIMARY KEY,
  own_balance numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.ctrl_account_balances ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.ctrl_account_balances TO authenticated;
GRANT ALL ON public.ctrl_account_balances TO service_role;
CREATE POLICY "finance select ctrl_balances" ON public.ctrl_account_balances FOR SELECT TO authenticated USING (public.is_finance());
CREATE POLICY "finance insert ctrl_balances" ON public.ctrl_account_balances FOR INSERT TO authenticated WITH CHECK (public.is_finance());
CREATE POLICY "finance update ctrl_balances" ON public.ctrl_account_balances FOR UPDATE TO authenticated USING (public.is_finance()) WITH CHECK (public.is_finance());
INSERT INTO public.ctrl_account_balances (account_id, own_balance)
SELECT DISTINCT ON (account_id) account_id, own_balance
FROM public.cashflow_balances
ORDER BY account_id, as_of DESC
ON CONFLICT (account_id) DO NOTHING;