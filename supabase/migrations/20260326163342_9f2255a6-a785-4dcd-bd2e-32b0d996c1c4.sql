ALTER TABLE public.salon_orders 
  ADD COLUMN IF NOT EXISTS table_number text,
  ADD COLUMN IF NOT EXISTS card_number text,
  ADD COLUMN IF NOT EXISTS ticket_number text,
  ADD COLUMN IF NOT EXISTS customers_count integer,
  ADD COLUMN IF NOT EXISTS service_charge_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sale_number text;