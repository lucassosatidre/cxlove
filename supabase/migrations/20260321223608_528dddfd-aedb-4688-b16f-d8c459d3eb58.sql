
DROP POLICY IF EXISTS "Users can insert cash snapshots for their closings" ON public.cash_snapshots;

CREATE POLICY "Users can insert tele cash snapshots"
ON public.cash_snapshots
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND daily_closing_id IS NOT NULL
);
