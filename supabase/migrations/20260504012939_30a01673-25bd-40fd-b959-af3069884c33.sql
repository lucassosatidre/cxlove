-- Re-key audit_brendi_daily by bb_credit_date (BB credit window) instead of sale_date.
-- match-brendi v3 aggregates multiple sale_dates into one row per real BB credit date.
DELETE FROM public.audit_brendi_daily;

ALTER TABLE public.audit_brendi_daily DROP CONSTRAINT IF EXISTS audit_brendi_daily_audit_period_id_sale_date_key;
DROP INDEX IF EXISTS public.idx_brendi_daily_period_sale_date;

ALTER TABLE public.audit_brendi_daily DROP COLUMN IF EXISTS sale_date;
ALTER TABLE public.audit_brendi_daily ADD COLUMN IF NOT EXISTS sale_dates date[] NOT NULL DEFAULT '{}';
ALTER TABLE public.audit_brendi_daily ALTER COLUMN bb_credit_date SET NOT NULL;

ALTER TABLE public.audit_brendi_daily
  ADD CONSTRAINT audit_brendi_daily_audit_period_id_bb_credit_date_key
  UNIQUE (audit_period_id, bb_credit_date);

CREATE INDEX IF NOT EXISTS idx_brendi_daily_period_credit_date
  ON public.audit_brendi_daily (audit_period_id, bb_credit_date);
