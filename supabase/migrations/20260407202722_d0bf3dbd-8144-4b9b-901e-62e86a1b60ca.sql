
-- 1. Create delivery_checkin_logs table
CREATE TABLE public.delivery_checkin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id uuid REFERENCES public.delivery_checkins(id) ON DELETE CASCADE NOT NULL,
  driver_id uuid NOT NULL,
  action text NOT NULL,
  device_ip text,
  device_user_agent text,
  device_info text,
  performed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.delivery_checkin_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access delivery_checkin_logs" ON public.delivery_checkin_logs
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can insert delivery_checkin_logs" ON public.delivery_checkin_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can view delivery_checkin_logs" ON public.delivery_checkin_logs
  FOR SELECT TO authenticated
  USING (true);

-- 2. Add password_changed field to delivery_drivers
ALTER TABLE public.delivery_drivers ADD COLUMN password_changed boolean NOT NULL DEFAULT false;
