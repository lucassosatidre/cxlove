ALTER TABLE public.audit_brendi_daily
  ADD COLUMN IF NOT EXISTS expected_liquido numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxa_calculada numeric NOT NULL DEFAULT 0;