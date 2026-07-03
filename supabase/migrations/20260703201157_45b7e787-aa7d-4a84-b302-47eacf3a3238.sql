ALTER TABLE public.cashflow_accounts
  ADD COLUMN IF NOT EXISTS balance_anchor numeric NULL,
  ADD COLUMN IF NOT EXISTS balance_anchor_date date NULL;

UPDATE public.cashflow_accounts
   SET balance_anchor = -44900.00,
       balance_anchor_date = '2026-07-03'
 WHERE id = 'c49a8c21-46fd-456e-8a29-fb26a77fde07';