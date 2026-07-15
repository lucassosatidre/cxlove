ALTER TABLE public.pluggy_items ADD COLUMN IF NOT EXISTS last_updated_at timestamptz;
ALTER TABLE public.pluggy_items ADD COLUMN IF NOT EXISTS last_status_message text;