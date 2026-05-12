ALTER TABLE public.audit_voucher_lot_items
  ADD COLUMN IF NOT EXISTS status_remote text;
COMMENT ON COLUMN public.audit_voucher_lot_items.status_remote IS
  'Status reportado pela operadora (Pluxee: PAGO/ERRO NO PAGAMENTO). NULL = não confirmado ainda.';