DROP INDEX IF EXISTS public.uniq_cf_tx_account_external;
CREATE UNIQUE INDEX uniq_cf_tx_account_external ON public.cashflow_transactions (account_id, external_id);