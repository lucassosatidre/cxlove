
ALTER TABLE public.daily_closings ADD COLUMN IF NOT EXISTS operator_id uuid;
ALTER TABLE public.salon_closings ADD COLUMN IF NOT EXISTS operator_id uuid;
