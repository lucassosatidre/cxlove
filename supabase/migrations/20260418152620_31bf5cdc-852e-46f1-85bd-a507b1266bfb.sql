-- 1. audit_periods
CREATE TABLE public.audit_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year integer NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'importado', 'conciliado', 'fechado')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(month, year)
);
ALTER TABLE public.audit_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_periods" ON public.audit_periods
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 2. audit_card_transactions (renomeado de card_transactions para evitar colisão)
CREATE TABLE public.audit_card_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  sale_date date NOT NULL,
  sale_time time,
  payment_method text NOT NULL,
  brand text,
  gross_amount numeric(12,2) NOT NULL,
  tax_rate numeric(6,4),
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  net_amount numeric(12,2) NOT NULL,
  promotion_amount numeric(12,2) DEFAULT 0,
  expected_deposit_date date,
  machine_serial text,
  transaction_id text UNIQUE NOT NULL,
  nsu text,
  deposit_group text,
  matched boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_card_tx_period ON public.audit_card_transactions(audit_period_id);
CREATE INDEX idx_audit_card_tx_expected ON public.audit_card_transactions(expected_deposit_date);
CREATE INDEX idx_audit_card_tx_group ON public.audit_card_transactions(deposit_group);
ALTER TABLE public.audit_card_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_card_transactions" ON public.audit_card_transactions
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3. audit_bank_deposits
CREATE TABLE public.audit_bank_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  bank text NOT NULL CHECK (bank IN ('cresol', 'bb')),
  deposit_date date NOT NULL,
  description text,
  detail text,
  amount numeric(12,2) NOT NULL,
  category text,
  auto_categorized boolean NOT NULL DEFAULT true,
  matched boolean NOT NULL DEFAULT false,
  doc_number text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_bank_dep_period ON public.audit_bank_deposits(audit_period_id);
CREATE INDEX idx_audit_bank_dep_date ON public.audit_bank_deposits(deposit_date);
CREATE INDEX idx_audit_bank_dep_category ON public.audit_bank_deposits(category);
ALTER TABLE public.audit_bank_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_bank_deposits" ON public.audit_bank_deposits
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 4. audit_daily_matches
CREATE TABLE public.audit_daily_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  match_date date NOT NULL,
  expected_amount numeric(12,2) NOT NULL DEFAULT 0,
  deposited_amount numeric(12,2) NOT NULL DEFAULT 0,
  difference numeric(12,2) NOT NULL DEFAULT 0,
  transaction_count integer NOT NULL DEFAULT 0,
  deposit_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(audit_period_id, match_date)
);
ALTER TABLE public.audit_daily_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_daily_matches" ON public.audit_daily_matches
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 5. audit_voucher_matches
CREATE TABLE public.audit_voucher_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  company text NOT NULL CHECK (company IN ('alelo', 'ticket', 'pluxee', 'vr')),
  sold_amount numeric(12,2) NOT NULL DEFAULT 0,
  sold_count integer NOT NULL DEFAULT 0,
  deposited_amount numeric(12,2) NOT NULL DEFAULT 0,
  deposit_count integer NOT NULL DEFAULT 0,
  difference numeric(12,2) NOT NULL DEFAULT 0,
  effective_tax_rate numeric(6,4) DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(audit_period_id, company)
);
ALTER TABLE public.audit_voucher_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_voucher_matches" ON public.audit_voucher_matches
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 6. audit_imports
CREATE TABLE public.audit_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  file_type text NOT NULL CHECK (file_type IN ('maquinona', 'cresol', 'bb')),
  file_name text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  imported_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_imports_period ON public.audit_imports(audit_period_id);
ALTER TABLE public.audit_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_imports" ON public.audit_imports
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Trigger para updated_at em audit_periods
CREATE OR REPLACE FUNCTION public.update_audit_periods_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_periods_updated_at
  BEFORE UPDATE ON public.audit_periods
  FOR EACH ROW
  EXECUTE FUNCTION public.update_audit_periods_updated_at();