
-- Step 1: Delete the old prod closing for 2026-03-22 (d67961fd) and its children
-- First clear card_transaction FK refs to orders in the prod closing
UPDATE public.card_transactions 
SET matched_order_id = NULL, match_type = NULL, match_confidence = NULL
WHERE daily_closing_id = 'd67961fd-6fc4-44eb-9657-ab597dff510d';

-- Delete order payment breakdowns for prod orders
DELETE FROM public.order_payment_breakdowns
WHERE imported_order_id IN (
  SELECT id FROM public.imported_orders WHERE daily_closing_id = 'd67961fd-6fc4-44eb-9657-ab597dff510d'
);

-- Delete prod imported orders
DELETE FROM public.imported_orders WHERE daily_closing_id = 'd67961fd-6fc4-44eb-9657-ab597dff510d';

-- Delete prod card transactions
DELETE FROM public.card_transactions WHERE daily_closing_id = 'd67961fd-6fc4-44eb-9657-ab597dff510d';

-- Delete prod cash snapshots
DELETE FROM public.cash_snapshots WHERE daily_closing_id = 'd67961fd-6fc4-44eb-9657-ab597dff510d';

-- Delete prod imports
DELETE FROM public.imports WHERE daily_closing_id = 'd67961fd-6fc4-44eb-9657-ab597dff510d';

-- Delete the prod closing itself
DELETE FROM public.daily_closings WHERE id = 'd67961fd-6fc4-44eb-9657-ab597dff510d';

-- Step 2: Now safe to set all test data to non-test
UPDATE public.daily_closings SET is_test = false WHERE is_test = true;
UPDATE public.imports SET is_test = false WHERE is_test = true;
