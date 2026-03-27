
-- Enable pg_net extension
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create sync_logs table for audit trail
CREATE TABLE public.sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  executed_at timestamp with time zone NOT NULL DEFAULT now(),
  sync_type text NOT NULL DEFAULT 'auto',
  status text NOT NULL DEFAULT 'success',
  details jsonb DEFAULT '{}'::jsonb,
  error_message text
);

-- Enable RLS
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view sync logs
CREATE POLICY "Admins can view sync logs"
  ON public.sync_logs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Service role inserts via edge functions (bypasses RLS)
CREATE POLICY "Service role can insert sync logs"
  ON public.sync_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
