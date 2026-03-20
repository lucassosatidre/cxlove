
CREATE TABLE public.salon_card_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  salon_closing_id UUID NOT NULL REFERENCES public.salon_closings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  sale_date DATE,
  sale_time TEXT,
  payment_method TEXT NOT NULL,
  brand TEXT,
  gross_amount NUMERIC NOT NULL DEFAULT 0,
  net_amount NUMERIC NOT NULL DEFAULT 0,
  machine_serial TEXT,
  transaction_id TEXT,
  matched_order_id UUID REFERENCES public.salon_orders(id),
  match_type TEXT,
  match_confidence TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.salon_card_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their salon card transactions"
  ON public.salon_card_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their salon card transactions"
  ON public.salon_card_transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their salon card transactions"
  ON public.salon_card_transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their salon card transactions"
  ON public.salon_card_transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
