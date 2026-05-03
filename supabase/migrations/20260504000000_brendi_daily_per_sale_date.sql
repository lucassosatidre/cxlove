-- Refactor audit_brendi_daily pra ser keyed por sale_date (não expected_credit_date).
--
-- Motivação: BB Brendi PIX detalhe tem prefix "DD/MM" que é a data do batch
-- (= sale_date + 1 calendar day). Cada sale_date Brendi gera UM PIX com esse
-- prefix, e o PIX cai no próximo dia útil bancário do batch. Antes
-- agregávamos por expected_credit_date (data útil bancária), o que misturava
-- PIX de Sex+Sáb+Dom no daily Mon — diff_pct estourava mesmo com cada PIX
-- individual fechando direitinho. Agora 1 daily = 1 sale_date = 1 PIX → match
-- limpo dia-a-dia.
--
-- Mudanças no schema:
-- - Remove constraint UNIQUE(period, expected_credit_date)
-- - Remove sale_dates[] (sempre singleton agora)
-- - Adiciona sale_date date NOT NULL com nova UNIQUE
-- - expected_credit_date vira informativa (D+1 útil de sale_date)
-- - cresol_credit_date guarda data efetiva do BB credit (pra UI)

-- Limpa dailies existentes — match-brendi re-popula com novo schema
DELETE FROM public.audit_brendi_daily;

ALTER TABLE public.audit_brendi_daily
  DROP CONSTRAINT IF EXISTS audit_brendi_daily_audit_period_id_expected_credit_date_key;

ALTER TABLE public.audit_brendi_daily
  DROP COLUMN IF EXISTS sale_dates;

ALTER TABLE public.audit_brendi_daily
  ADD COLUMN IF NOT EXISTS sale_date date NOT NULL,
  ADD COLUMN IF NOT EXISTS bb_credit_date date;  -- data real em que o BB creditou (pode diferir do ECD em weekend/feriado)

ALTER TABLE public.audit_brendi_daily
  ADD CONSTRAINT audit_brendi_daily_audit_period_id_sale_date_key
  UNIQUE (audit_period_id, sale_date);

-- expected_credit_date NOT NULL relaxa pra opcional (calculado, informativo)
ALTER TABLE public.audit_brendi_daily
  ALTER COLUMN expected_credit_date DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brendi_daily_period_sale_date
  ON public.audit_brendi_daily(audit_period_id, sale_date);
