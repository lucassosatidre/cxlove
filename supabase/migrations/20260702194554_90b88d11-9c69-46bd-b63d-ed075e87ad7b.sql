
-- 1. pluggy_accounts
CREATE TABLE public.pluggy_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pluggy_account_id text NOT NULL UNIQUE,
  item_id text NOT NULL,
  name text,
  type text,
  subtype text,
  number text,
  balance numeric,
  currency text,
  cashflow_account_id uuid NULL REFERENCES public.cashflow_accounts(id) ON DELETE SET NULL,
  last_synced_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pluggy_accounts TO authenticated;
GRANT ALL ON public.pluggy_accounts TO service_role;

ALTER TABLE public.pluggy_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read pluggy_accounts"
  ON public.pluggy_accounts FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated update pluggy_accounts"
  ON public.pluggy_accounts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role all pluggy_accounts"
  ON public.pluggy_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_pluggy_accounts_updated_at
  BEFORE UPDATE ON public.pluggy_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. external_id em cashflow_transactions + índice único parcial
ALTER TABLE public.cashflow_transactions
  ADD COLUMN IF NOT EXISTS external_id text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_cf_tx_account_external
  ON public.cashflow_transactions (account_id, external_id)
  WHERE external_id IS NOT NULL;
