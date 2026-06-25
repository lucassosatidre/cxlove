
-- Accounts
CREATE TABLE public.cashflow_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  bank text,
  company text NOT NULL CHECK (company IN ('estrela','proposito','prover')),
  account_number text,
  kind text NOT NULL CHECK (kind IN ('corrente','passagem','financiamento')),
  overdraft_limit numeric NOT NULL DEFAULT 0,
  is_passthrough boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashflow_accounts TO authenticated;
GRANT ALL ON public.cashflow_accounts TO service_role;
ALTER TABLE public.cashflow_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage cashflow_accounts" ON public.cashflow_accounts
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Transactions
CREATE TABLE public.cashflow_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.cashflow_accounts(id) ON DELETE CASCADE,
  tx_date date NOT NULL,
  description text,
  detail text,
  amount numeric NOT NULL,
  running_balance numeric,
  category text,
  is_internal_transfer boolean NOT NULL DEFAULT false,
  counterparty text,
  is_future boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'extrato',
  import_id uuid,
  row_hash text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cf_tx_account_date ON public.cashflow_transactions(account_id, tx_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashflow_transactions TO authenticated;
GRANT ALL ON public.cashflow_transactions TO service_role;
ALTER TABLE public.cashflow_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage cashflow_transactions" ON public.cashflow_transactions
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Saipos
CREATE TABLE public.cashflow_saipos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text,
  payment_method text,
  category text,
  vencimento date,
  emissao date,
  pagamento date,
  amount numeric NOT NULL,
  paid boolean NOT NULL DEFAULT false,
  fornecedor text,
  descricao text,
  source text NOT NULL DEFAULT 'saipos',
  import_id uuid,
  row_hash text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cf_saipos_pgto ON public.cashflow_saipos(pagamento);
CREATE INDEX idx_cf_saipos_venc ON public.cashflow_saipos(vencimento);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashflow_saipos TO authenticated;
GRANT ALL ON public.cashflow_saipos TO service_role;
ALTER TABLE public.cashflow_saipos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage cashflow_saipos" ON public.cashflow_saipos
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Loans
CREATE TABLE public.cashflow_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contract text,
  company text,
  outstanding_balance numeric,
  monthly_payment numeric,
  total_installments int,
  remaining_installments int,
  first_due date,
  last_due date,
  annual_rate numeric,
  pays_from_account_id uuid REFERENCES public.cashflow_accounts(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashflow_loans TO authenticated;
GRANT ALL ON public.cashflow_loans TO service_role;
ALTER TABLE public.cashflow_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage cashflow_loans" ON public.cashflow_loans
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Loan installments
CREATE TABLE public.cashflow_loan_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.cashflow_loans(id) ON DELETE CASCADE,
  seq int NOT NULL,
  due_date date NOT NULL,
  amount numeric NOT NULL,
  principal numeric,
  interest numeric,
  balance_after numeric,
  paid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cf_loan_inst_loan ON public.cashflow_loan_installments(loan_id, seq);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashflow_loan_installments TO authenticated;
GRANT ALL ON public.cashflow_loan_installments TO service_role;
ALTER TABLE public.cashflow_loan_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage cashflow_loan_installments" ON public.cashflow_loan_installments
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Balances
CREATE TABLE public.cashflow_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.cashflow_accounts(id) ON DELETE CASCADE,
  as_of date NOT NULL,
  own_balance numeric NOT NULL,
  provisioned numeric NOT NULL DEFAULT 0,
  limit_available numeric NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, as_of)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashflow_balances TO authenticated;
GRANT ALL ON public.cashflow_balances TO service_role;
ALTER TABLE public.cashflow_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage cashflow_balances" ON public.cashflow_balances
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Imports
CREATE TABLE public.cashflow_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_type text NOT NULL,
  file_name text,
  account_id uuid REFERENCES public.cashflow_accounts(id) ON DELETE SET NULL,
  total_rows int,
  imported_rows int,
  duplicate_rows int,
  status text,
  error_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashflow_imports TO authenticated;
GRANT ALL ON public.cashflow_imports TO service_role;
ALTER TABLE public.cashflow_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage cashflow_imports" ON public.cashflow_imports
  FOR ALL USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
