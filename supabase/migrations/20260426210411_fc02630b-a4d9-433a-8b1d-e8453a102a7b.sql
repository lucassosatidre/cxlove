DELETE FROM public.voucher_lots WHERE audit_period_id IN (SELECT id FROM public.audit_periods WHERE month = 3 AND year = 2026);

DELETE FROM public.voucher_adjustments WHERE audit_period_id IN (SELECT id FROM public.audit_periods WHERE month = 3 AND year = 2026);

DELETE FROM public.voucher_imports WHERE audit_period_id IN (SELECT id FROM public.audit_periods WHERE month = 3 AND year = 2026);