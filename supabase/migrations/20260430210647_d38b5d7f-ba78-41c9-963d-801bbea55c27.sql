DELETE FROM public.audit_voucher_lot_items
WHERE lot_id IN (SELECT id FROM public.audit_voucher_lots WHERE operadora = 'vr');