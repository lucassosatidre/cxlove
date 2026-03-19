
CREATE TABLE public.cash_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_closing_id uuid NOT NULL REFERENCES public.daily_closings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_snapshots ENABLE ROW LEVEL SECURITY;

-- Any authenticated user linked to the closing can view snapshots
CREATE POLICY "Users can view cash snapshots for their closings"
  ON public.cash_snapshots FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.daily_closings dc
    WHERE dc.id = cash_snapshots.daily_closing_id AND dc.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert cash snapshots for their closings"
  ON public.cash_snapshots FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.daily_closings dc
      WHERE dc.id = cash_snapshots.daily_closing_id AND dc.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own cash snapshots"
  ON public.cash_snapshots FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own cash snapshots"
  ON public.cash_snapshots FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Unique constraint: one snapshot per closing per user
CREATE UNIQUE INDEX cash_snapshots_closing_user_idx ON public.cash_snapshots (daily_closing_id, user_id);
