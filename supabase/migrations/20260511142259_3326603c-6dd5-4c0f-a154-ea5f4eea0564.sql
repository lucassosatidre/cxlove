ALTER TABLE public.audit_card_transactions
  DROP CONSTRAINT IF EXISTS audit_card_transactions_transaction_id_key;

ALTER TABLE public.audit_card_transactions
  ADD CONSTRAINT audit_card_transactions_period_tx_unique
  UNIQUE (audit_period_id, transaction_id);

CREATE INDEX IF NOT EXISTS idx_audit_card_tx_tx_id
  ON public.audit_card_transactions(transaction_id);