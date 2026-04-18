-- Add closed_at and closed_by to audit_periods
ALTER TABLE public.audit_periods
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid;

-- Create audit_period_log table
CREATE TABLE IF NOT EXISTS public.audit_period_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('fechado', 'reaberto')),
  user_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_period_log_period ON public.audit_period_log(audit_period_id, created_at DESC);

ALTER TABLE public.audit_period_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage audit_period_log"
  ON public.audit_period_log
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));