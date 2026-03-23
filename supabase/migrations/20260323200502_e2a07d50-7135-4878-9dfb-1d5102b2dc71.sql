
-- Add sector column to cash_expectations (default 'tele' for backward compatibility)
ALTER TABLE public.cash_expectations ADD COLUMN IF NOT EXISTS sector text NOT NULL DEFAULT 'tele';

-- Drop old unique constraint on closing_date only
ALTER TABLE public.cash_expectations DROP CONSTRAINT IF EXISTS cash_expectations_closing_date_key;

-- Create new unique constraint on (closing_date, sector)
ALTER TABLE public.cash_expectations ADD CONSTRAINT cash_expectations_closing_date_sector_key UNIQUE (closing_date, sector);
