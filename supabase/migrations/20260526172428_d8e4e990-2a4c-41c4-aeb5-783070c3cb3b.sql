ALTER TABLE audit_brendi_daily DROP CONSTRAINT IF EXISTS audit_brendi_daily_period_creditdate_uniq;
ALTER TABLE audit_brendi_daily DROP CONSTRAINT IF EXISTS audit_brendi_daily_audit_period_id_bb_credit_date_key;
ALTER TABLE audit_brendi_daily ADD COLUMN IF NOT EXISTS sale_date date;
ALTER TABLE audit_brendi_daily ALTER COLUMN bb_credit_date DROP NOT NULL;
DELETE FROM audit_brendi_daily;
ALTER TABLE audit_brendi_daily ADD CONSTRAINT audit_brendi_daily_period_saledate_uniq UNIQUE (audit_period_id, sale_date);
ALTER TABLE audit_brendi_daily ALTER COLUMN sale_date SET NOT NULL;