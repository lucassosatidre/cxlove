
CREATE TABLE public.label_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  saipos_sale_id INTEGER NOT NULL,
  sale_number TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  pizza_count INTEGER NOT NULL DEFAULT 0,
  shift_date DATE NOT NULL,
  printed BOOLEAN NOT NULL DEFAULT false,
  printed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  UNIQUE(saipos_sale_id, shift_date)
);

ALTER TABLE public.label_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view label orders"
  ON public.label_orders FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert label orders"
  ON public.label_orders FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authenticated users can update label orders"
  ON public.label_orders FOR UPDATE TO authenticated
  USING (true);

CREATE POLICY "Admins can manage label orders"
  ON public.label_orders FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
