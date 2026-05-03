-- Refactor (3rd iteration): audit_brendi_daily agora keyed por bb_credit_date.
--
-- Histórico:
-- - v1: keyed por expected_credit_date (D+1 útil calc) → misturava Sex+Sáb+Dom
-- - v2: keyed por sale_date (1:1 PIX prefix) → individual fechava ~ mas dia
--   a dia tinha ruído porque Brendi tem cutoff ~06:00 BRT (não meia-noite)
--   e pedidos late-night BRT vão pra batch diferente do que esperaríamos.
-- - v3 (esta): keyed por bb_credit_date REAL. Cada PIX tem prefix → sale_date,
--   e tem deposit_date real do BB extrato. Agrupamos sale_dates pelo
--   deposit_date real do PIX correspondente. Janela de crédito BB casa com
--   janela de crédito BB → match limpo, soma fecha.

DELETE FROM public.audit_brendi_daily;

ALTER TABLE public.audit_brendi_daily
  DROP CONSTRAINT IF EXISTS audit_brendi_daily_audit_period_id_sale_date_key;

ALTER TABLE public.audit_brendi_daily
  DROP COLUMN IF EXISTS sale_date;

ALTER TABLE public.audit_brendi_daily
  ADD COLUMN IF NOT EXISTS sale_dates date[] NOT NULL DEFAULT '{}';

-- bb_credit_date passa a ser a chave. Pra grupos sem_deposito (sales Brendi
-- sem PIX correspondente), o edge popula com nextBusinessDay(sale_date) como
-- fallback — pode colidir com outro grupo do mesmo dia, mas é raro e funciona.
ALTER TABLE public.audit_brendi_daily
  ALTER COLUMN bb_credit_date SET NOT NULL;

ALTER TABLE public.audit_brendi_daily
  ADD CONSTRAINT audit_brendi_daily_audit_period_id_bb_credit_date_key
  UNIQUE (audit_period_id, bb_credit_date);

CREATE INDEX IF NOT EXISTS idx_brendi_daily_period_credit_date
  ON public.audit_brendi_daily(audit_period_id, bb_credit_date);
