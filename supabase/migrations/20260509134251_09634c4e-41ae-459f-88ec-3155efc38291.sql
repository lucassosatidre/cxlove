CREATE TABLE IF NOT EXISTS public.pickngo_webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL,
  event_type text,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pickngo_webhook_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read pickngo_webhook_logs" ON public.pickngo_webhook_logs;
CREATE POLICY "Admins read pickngo_webhook_logs"
ON public.pickngo_webhook_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_pickngo_webhook_logs_received_at
  ON public.pickngo_webhook_logs (received_at DESC);