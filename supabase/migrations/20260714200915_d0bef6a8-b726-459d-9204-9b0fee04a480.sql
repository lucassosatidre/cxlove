CREATE TABLE public.saipos_fin_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_store_fin_transaction bigint NOT NULL UNIQUE,
  id_store integer,
  date date,
  issuance_date date,
  payment_date date,
  paid text,
  conciliated text,
  amount numeric(14,2),
  desc_store_fin_transaction text,
  desc_store_category_financial text,
  desc_store_payment_method text,
  desc_store_bank_account text,
  provider_trade_name text,
  children jsonb,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_saipos_fin_date ON public.saipos_fin_transactions(date);
CREATE INDEX idx_saipos_fin_paid ON public.saipos_fin_transactions(paid);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saipos_fin_transactions TO authenticated;
GRANT ALL ON public.saipos_fin_transactions TO service_role;

ALTER TABLE public.saipos_fin_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read saipos_fin_transactions"
  ON public.saipos_fin_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated insert saipos_fin_transactions"
  ON public.saipos_fin_transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated update saipos_fin_transactions"
  ON public.saipos_fin_transactions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated delete saipos_fin_transactions"
  ON public.saipos_fin_transactions FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.tg_saipos_fin_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_saipos_fin_updated_at
  BEFORE UPDATE ON public.saipos_fin_transactions
  FOR EACH ROW EXECUTE FUNCTION public.tg_saipos_fin_updated_at();