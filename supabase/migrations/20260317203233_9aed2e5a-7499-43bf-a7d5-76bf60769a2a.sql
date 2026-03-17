
CREATE TABLE public.card_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_closing_id uuid NOT NULL REFERENCES public.daily_closings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  sale_date date,
  sale_time text,
  payment_method text NOT NULL,
  brand text,
  gross_amount numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  machine_serial text,
  transaction_id text,
  matched_order_id uuid REFERENCES public.imported_orders(id) ON DELETE SET NULL,
  match_type text, -- 'exact', 'approximate', 'manual', null
  match_confidence text, -- 'high', 'medium', 'low', null
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.card_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own card transactions"
  ON public.card_transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own card transactions"
  ON public.card_transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own card transactions"
  ON public.card_transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own card transactions"
  ON public.card_transactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
