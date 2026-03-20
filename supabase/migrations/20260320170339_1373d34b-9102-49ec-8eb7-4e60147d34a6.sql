ALTER TABLE public.daily_closings ADD COLUMN reconciliation_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.salon_closings ADD COLUMN reconciliation_status text NOT NULL DEFAULT 'pending';