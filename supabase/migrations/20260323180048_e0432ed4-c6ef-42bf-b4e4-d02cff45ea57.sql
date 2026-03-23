
CREATE TABLE public.machine_readings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  daily_closing_id UUID NOT NULL REFERENCES public.daily_closings(id) ON DELETE CASCADE,
  machine_serial TEXT NOT NULL DEFAULT '',
  delivery_person TEXT NOT NULL DEFAULT '',
  debit_amount NUMERIC NOT NULL DEFAULT 0,
  credit_amount NUMERIC NOT NULL DEFAULT 0,
  voucher_amount NUMERIC NOT NULL DEFAULT 0,
  pix_amount NUMERIC NOT NULL DEFAULT 0,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.machine_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage machine readings" ON public.machine_readings FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view machine readings" ON public.machine_readings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert machine readings" ON public.machine_readings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their machine readings" ON public.machine_readings FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their machine readings" ON public.machine_readings FOR DELETE TO authenticated USING (auth.uid() = user_id);
