DELETE FROM public.audit_brendi_daily;

ALTER TABLE public.audit_brendi_daily
  DROP CONSTRAINT IF EXISTS audit_brendi_daily_audit_period_id_expected_credit_date_key;

ALTER TABLE public.audit_brendi_daily
  DROP COLUMN IF EXISTS sale_dates;

ALTER TABLE public.audit_brendi_daily
  ADD COLUMN IF NOT EXISTS sale_date date NOT NULL,
  ADD COLUMN IF NOT EXISTS bb_credit_date date;

ALTER TABLE public.audit_brendi_daily
  ADD CONSTRAINT audit_brendi_daily_audit_period_id_sale_date_key
  UNIQUE (audit_period_id, sale_date);

ALTER TABLE public.audit_brendi_daily
  ALTER COLUMN expected_credit_date DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brendi_daily_period_sale_date
  ON public.audit_brendi_daily(audit_period_id, sale_date);