
ALTER TABLE public.cash_snapshots ADD COLUMN snapshot_type text NOT NULL DEFAULT 'abertura';

-- Drop the existing unique constraint on (daily_closing_id, user_id) if it exists
-- and create a new one that includes snapshot_type
DO $$ BEGIN
  -- Try to drop existing unique index/constraint
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'cash_snapshots' AND indexdef LIKE '%daily_closing_id%user_id%' AND indexdef NOT LIKE '%snapshot_type%') THEN
    EXECUTE (SELECT 'DROP INDEX IF EXISTS ' || indexname FROM pg_indexes WHERE tablename = 'cash_snapshots' AND indexdef LIKE '%daily_closing_id%user_id%' AND indexdef NOT LIKE '%snapshot_type%' LIMIT 1);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cash_snapshots_closing_user_type_unique ON public.cash_snapshots (daily_closing_id, user_id, snapshot_type);
