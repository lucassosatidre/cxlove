
DROP POLICY IF EXISTS "Users can view cash snapshots for their closings" ON public.cash_snapshots;

CREATE POLICY "Users can view tele cash snapshots"
ON public.cash_snapshots FOR SELECT TO authenticated
USING (daily_closing_id IS NOT NULL);
