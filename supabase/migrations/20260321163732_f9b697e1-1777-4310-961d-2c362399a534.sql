
-- Add salon_closing_id column to cash_snapshots for salon cash counting
ALTER TABLE public.cash_snapshots ADD COLUMN salon_closing_id uuid REFERENCES public.salon_closings(id) ON DELETE CASCADE;

-- Make daily_closing_id nullable (salon snapshots won't have it)
ALTER TABLE public.cash_snapshots ALTER COLUMN daily_closing_id DROP NOT NULL;

-- Add unique constraint for salon snapshots
CREATE UNIQUE INDEX IF NOT EXISTS cash_snapshots_salon_unique ON public.cash_snapshots (salon_closing_id, user_id, snapshot_type) WHERE salon_closing_id IS NOT NULL;

-- Add RLS policies for salon cash snapshots
CREATE POLICY "Users can insert salon cash snapshots"
ON public.cash_snapshots FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id AND 
  salon_closing_id IS NOT NULL
);

CREATE POLICY "Users can view salon cash snapshots"
ON public.cash_snapshots FOR SELECT TO authenticated
USING (
  salon_closing_id IS NOT NULL AND
  EXISTS (SELECT 1 FROM salon_closings sc WHERE sc.id = cash_snapshots.salon_closing_id)
);

CREATE POLICY "Users can update salon cash snapshots"
ON public.cash_snapshots FOR UPDATE TO authenticated
USING (
  auth.uid() = user_id AND salon_closing_id IS NOT NULL
);

CREATE POLICY "Users can delete salon cash snapshots"
ON public.cash_snapshots FOR DELETE TO authenticated
USING (
  auth.uid() = user_id AND salon_closing_id IS NOT NULL
);
