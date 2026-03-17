-- Create imports table
CREATE TABLE public.imports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  file_name TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  total_rows INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed'))
);

ALTER TABLE public.imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own imports" ON public.imports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create imports" ON public.imports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own imports" ON public.imports FOR UPDATE USING (auth.uid() = user_id);

-- Create imported_orders table
CREATE TABLE public.imported_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  import_id UUID NOT NULL REFERENCES public.imports(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  delivery_person TEXT,
  is_confirmed BOOLEAN NOT NULL DEFAULT false,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  confirmed_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.imported_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view orders from their imports" ON public.imported_orders 
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.imports WHERE imports.id = imported_orders.import_id AND imports.user_id = auth.uid())
  );

CREATE POLICY "Users can insert orders into their imports" ON public.imported_orders 
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.imports WHERE imports.id = imported_orders.import_id AND imports.user_id = auth.uid())
  );

CREATE POLICY "Users can update orders from their imports" ON public.imported_orders 
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.imports WHERE imports.id = imported_orders.import_id AND imports.user_id = auth.uid())
  );

CREATE INDEX idx_imported_orders_import_id ON public.imported_orders(import_id);
CREATE INDEX idx_imported_orders_confirmed ON public.imported_orders(import_id, is_confirmed);