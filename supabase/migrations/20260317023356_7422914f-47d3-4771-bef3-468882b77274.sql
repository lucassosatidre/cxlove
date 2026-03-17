
-- Create breakdown table
CREATE TABLE public.order_payment_breakdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_order_id uuid NOT NULL REFERENCES public.imported_orders(id) ON DELETE CASCADE,
  payment_method_name text NOT NULL,
  payment_type text NOT NULL DEFAULT 'fisico',
  amount numeric NOT NULL DEFAULT 0,
  is_auto_calculated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_payment_type CHECK (payment_type IN ('online', 'fisico'))
);

-- Enable RLS
ALTER TABLE public.order_payment_breakdowns ENABLE ROW LEVEL SECURITY;

-- RLS: select
CREATE POLICY "Users can view breakdowns of their orders"
ON public.order_payment_breakdowns FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1 FROM public.imported_orders io
    JOIN public.imports i ON i.id = io.import_id
    WHERE io.id = order_payment_breakdowns.imported_order_id
    AND i.user_id = auth.uid()
  )
);

-- RLS: insert
CREATE POLICY "Users can insert breakdowns for their orders"
ON public.order_payment_breakdowns FOR INSERT
TO public
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.imported_orders io
    JOIN public.imports i ON i.id = io.import_id
    WHERE io.id = order_payment_breakdowns.imported_order_id
    AND i.user_id = auth.uid()
  )
);

-- RLS: update
CREATE POLICY "Users can update breakdowns of their orders"
ON public.order_payment_breakdowns FOR UPDATE
TO public
USING (
  EXISTS (
    SELECT 1 FROM public.imported_orders io
    JOIN public.imports i ON i.id = io.import_id
    WHERE io.id = order_payment_breakdowns.imported_order_id
    AND i.user_id = auth.uid()
  )
);

-- RLS: delete
CREATE POLICY "Users can delete breakdowns of their orders"
ON public.order_payment_breakdowns FOR DELETE
TO public
USING (
  EXISTS (
    SELECT 1 FROM public.imported_orders io
    JOIN public.imports i ON i.id = io.import_id
    WHERE io.id = order_payment_breakdowns.imported_order_id
    AND i.user_id = auth.uid()
  )
);
