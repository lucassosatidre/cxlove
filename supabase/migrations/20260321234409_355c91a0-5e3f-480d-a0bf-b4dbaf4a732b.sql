
ALTER TABLE public.daily_closings ADD COLUMN is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.imports ADD COLUMN is_test boolean NOT NULL DEFAULT false;
