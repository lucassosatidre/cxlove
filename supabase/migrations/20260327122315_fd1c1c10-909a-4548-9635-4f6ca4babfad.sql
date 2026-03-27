
-- First, move card transaction matches from Excel duplicates to API counterparts
-- Update salon_card_transactions to point to the API version of the order
UPDATE public.salon_card_transactions sct
SET matched_order_id = api.id
FROM salon_orders excel
JOIN salon_orders api ON 
  excel.salon_closing_id = api.salon_closing_id
  AND excel.total_amount = api.total_amount
  AND excel.payment_method = api.payment_method
  AND excel.id != api.id
  AND api.saipos_sale_id IS NOT NULL
WHERE sct.matched_order_id = excel.id
  AND excel.salon_closing_id = 'b799e1ed-0660-4493-9704-5f76c63b0c30'
  AND excel.saipos_sale_id IS NULL;

-- Unlink card transactions from numeric-type duplicates
UPDATE public.salon_card_transactions
SET matched_order_id = NULL, match_type = NULL, match_confidence = NULL
WHERE matched_order_id IN (
  SELECT id FROM salon_orders
  WHERE salon_closing_id = 'b799e1ed-0660-4493-9704-5f76c63b0c30'
    AND order_type ~ '^\d+$'
);

-- Delete salon_order_payments for duplicates
DELETE FROM public.salon_order_payments
WHERE salon_order_id IN (
  SELECT excel.id
  FROM salon_orders excel
  JOIN salon_orders api ON 
    excel.salon_closing_id = api.salon_closing_id
    AND excel.total_amount = api.total_amount
    AND excel.payment_method = api.payment_method
    AND excel.id != api.id
  WHERE excel.salon_closing_id = 'b799e1ed-0660-4493-9704-5f76c63b0c30'
    AND excel.saipos_sale_id IS NULL
    AND api.saipos_sale_id IS NOT NULL
);

-- Delete the duplicate Excel orders
DELETE FROM public.salon_orders
WHERE id IN (
  SELECT excel.id
  FROM salon_orders excel
  JOIN salon_orders api ON 
    excel.salon_closing_id = api.salon_closing_id
    AND excel.total_amount = api.total_amount
    AND excel.payment_method = api.payment_method
    AND excel.id != api.id
  WHERE excel.salon_closing_id = 'b799e1ed-0660-4493-9704-5f76c63b0c30'
    AND excel.saipos_sale_id IS NULL
    AND api.saipos_sale_id IS NOT NULL
);

-- Delete payments for numeric order_type duplicates
DELETE FROM public.salon_order_payments
WHERE salon_order_id IN (
  SELECT id FROM salon_orders
  WHERE salon_closing_id = 'b799e1ed-0660-4493-9704-5f76c63b0c30'
    AND order_type ~ '^\d+$'
);

-- Delete numeric order_type duplicates
DELETE FROM public.salon_orders
WHERE salon_closing_id = 'b799e1ed-0660-4493-9704-5f76c63b0c30'
  AND order_type ~ '^\d+$';
