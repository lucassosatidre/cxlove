ALTER TABLE public.audit_brendi_daily
  ADD COLUMN IF NOT EXISTS cumulative_diff numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cumulative_diff_pct numeric NOT NULL DEFAULT 0;

ALTER TABLE public.audit_brendi_daily
  DROP CONSTRAINT IF EXISTS audit_brendi_daily_status_check;

ALTER TABLE public.audit_brendi_daily
  ADD CONSTRAINT audit_brendi_daily_status_check
  CHECK (status IN (
    'matched', 'matched_window', 'pending_manual',
    'mensalidade_descontada', 'sem_deposito', 'pending'
  ));