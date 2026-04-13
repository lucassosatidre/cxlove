
-- Create machine_registry table
CREATE TABLE public.machine_registry (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  serial_number text NOT NULL UNIQUE,
  friendly_name text NOT NULL,
  category text NOT NULL DEFAULT 'tele',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.machine_registry ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view
CREATE POLICY "Authenticated users can view machine registry"
ON public.machine_registry FOR SELECT
TO authenticated
USING (true);

-- Admins can manage
CREATE POLICY "Admins can manage machine registry"
ON public.machine_registry FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Seed data
INSERT INTO public.machine_registry (serial_number, friendly_name, category) VALUES
  ('158242609658', 'Frota 1', 'frota'),
  ('158253964544', 'Frota 2', 'frota'),
  ('158253964411', 'Frota 3', 'frota'),
  ('158242605852', 'Frota 4', 'frota'),
  ('158242609374', 'Tele 1', 'tele'),
  ('158242606488', 'Tele 2', 'tele'),
  ('158243211965', 'Tele 3', 'tele'),
  ('158242608301', 'Tele 4', 'tele'),
  ('158252515630', 'Tele 5', 'tele'),
  ('158253964479', 'Tele 6', 'tele'),
  ('158252515285', 'Tele 7', 'tele'),
  ('158252514394', 'Tele 8', 'tele'),
  ('158252514108', 'Tele 9', 'tele'),
  ('158252515226', 'Tele 10', 'tele'),
  ('158242605965', 'Tele 11', 'tele'),
  ('158242609469', 'Tele 12', 'tele'),
  ('158252514042', 'Tele 13', 'tele');
