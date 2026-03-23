CREATE UNIQUE INDEX IF NOT EXISTS cash_snapshots_salon_closing_user_type_unique 
ON public.cash_snapshots (salon_closing_id, user_id, snapshot_type) 
WHERE salon_closing_id IS NOT NULL;