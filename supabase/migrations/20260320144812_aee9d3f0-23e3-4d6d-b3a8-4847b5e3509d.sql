
-- Salon closings (same structure as daily_closings)
CREATE TABLE public.salon_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_date date NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.salon_closings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own salon closings" ON public.salon_closings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create salon closings" ON public.salon_closings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own salon closings" ON public.salon_closings FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Salon imports (same structure as imports)
CREATE TABLE public.salon_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  new_rows integer NOT NULL DEFAULT 0,
  duplicate_rows integer NOT NULL DEFAULT 0,
  skipped_cancelled integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  salon_closing_id uuid REFERENCES public.salon_closings(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.salon_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own salon imports" ON public.salon_imports FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can create salon imports" ON public.salon_imports FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own salon imports" ON public.salon_imports FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Salon orders
CREATE TABLE public.salon_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_import_id uuid NOT NULL REFERENCES public.salon_imports(id),
  salon_closing_id uuid REFERENCES public.salon_closings(id),
  order_type text NOT NULL,
  sale_time text,
  sale_date date,
  payment_method text NOT NULL DEFAULT '',
  total_amount numeric NOT NULL DEFAULT 0,
  is_confirmed boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,
  confirmed_by uuid
);

ALTER TABLE public.salon_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their salon orders" ON public.salon_orders FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.salon_imports si WHERE si.id = salon_orders.salon_import_id AND si.user_id = auth.uid())
);
CREATE POLICY "Users can insert their salon orders" ON public.salon_orders FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.salon_imports si WHERE si.id = salon_orders.salon_import_id AND si.user_id = auth.uid())
);
CREATE POLICY "Users can update their salon orders" ON public.salon_orders FOR UPDATE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.salon_imports si WHERE si.id = salon_orders.salon_import_id AND si.user_id = auth.uid())
);
