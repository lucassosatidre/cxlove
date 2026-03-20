
CREATE TABLE public.salon_order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_order_id uuid NOT NULL REFERENCES public.salon_orders(id) ON DELETE CASCADE,
  payment_method text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.salon_order_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their salon order payments"
ON public.salon_order_payments FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM salon_orders so
    JOIN salon_imports si ON si.id = so.salon_import_id
    WHERE so.id = salon_order_payments.salon_order_id AND si.user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert salon order payments"
ON public.salon_order_payments FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM salon_orders so
    JOIN salon_imports si ON si.id = so.salon_import_id
    WHERE so.id = salon_order_payments.salon_order_id AND si.user_id = auth.uid()
  )
);

CREATE POLICY "Users can update salon order payments"
ON public.salon_order_payments FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM salon_orders so
    JOIN salon_imports si ON si.id = so.salon_import_id
    WHERE so.id = salon_order_payments.salon_order_id AND si.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete salon order payments"
ON public.salon_order_payments FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM salon_orders so
    JOIN salon_imports si ON si.id = so.salon_import_id
    WHERE so.id = salon_order_payments.salon_order_id AND si.user_id = auth.uid()
  )
);
