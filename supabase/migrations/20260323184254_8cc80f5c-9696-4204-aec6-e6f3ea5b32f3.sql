
-- Add salon_closing_id to machine_readings for salon usage
ALTER TABLE public.machine_readings 
ADD COLUMN salon_closing_id uuid REFERENCES public.salon_closings(id) ON DELETE CASCADE;

-- Make daily_closing_id nullable (it was NOT NULL before, but now salon readings won't have it)
ALTER TABLE public.machine_readings 
ALTER COLUMN daily_closing_id DROP NOT NULL;
