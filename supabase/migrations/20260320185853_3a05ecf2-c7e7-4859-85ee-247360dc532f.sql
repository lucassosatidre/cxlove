
CREATE TABLE public.cash_expectations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_date date NOT NULL,
  created_by uuid NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (closing_date)
);

ALTER TABLE public.cash_expectations ENABLE ROW LEVEL SECURITY;

-- Only admins can insert/update/delete
CREATE POLICY "Admins can manage cash expectations"
ON public.cash_expectations
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- All authenticated users can view (operators need to see expected values)
CREATE POLICY "Authenticated users can view cash expectations"
ON public.cash_expectations
FOR SELECT
TO authenticated
USING (true);
