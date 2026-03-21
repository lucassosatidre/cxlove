
-- Table for daily vault closings
CREATE TABLE public.vault_daily_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_date date NOT NULL UNIQUE,
  change_salon numeric NOT NULL DEFAULT 0,
  change_tele numeric NOT NULL DEFAULT 0,
  vault_entry numeric NOT NULL DEFAULT 0,
  vault_entry_description text,
  vault_exit numeric NOT NULL DEFAULT 0,
  vault_exit_description text,
  balance numeric NOT NULL DEFAULT 0,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vault_daily_closings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage vault closings" ON public.vault_daily_closings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Table for misc expenses throughout the day
CREATE TABLE public.vault_misc_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date date NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  description text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('salao', 'tele', 'cofre')),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vault_misc_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage vault expenses" ON public.vault_misc_expenses
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
