DO $$
DECLARE
  v_period_id uuid;
BEGIN
  SELECT id INTO v_period_id FROM public.audit_periods WHERE month = 3 AND year = 2026;
  IF v_period_id IS NOT NULL THEN
    DELETE FROM public.audit_period_log     WHERE audit_period_id = v_period_id;
    DELETE FROM public.audit_daily_matches  WHERE audit_period_id = v_period_id;
    DELETE FROM public.audit_voucher_matches WHERE audit_period_id = v_period_id;
    DELETE FROM public.audit_bank_deposits  WHERE audit_period_id = v_period_id;
    DELETE FROM public.audit_card_transactions WHERE audit_period_id = v_period_id;
    DELETE FROM public.audit_imports        WHERE audit_period_id = v_period_id;
    DELETE FROM public.audit_periods        WHERE id = v_period_id;
  END IF;
END $$;