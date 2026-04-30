ALTER TABLE public.audit_voucher_lots
  ADD COLUMN IF NOT EXISTS bb_deposit_id_2 uuid
  REFERENCES public.audit_bank_deposits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_voucher_lots_bb_deposit_2
  ON public.audit_voucher_lots(bb_deposit_id_2);