CREATE TABLE public.stark_events (
  id text PRIMARY KEY,
  type text,
  subscription text,
  resource_id text,
  amount_reais numeric,
  event_created timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);
GRANT SELECT ON public.stark_events TO authenticated;
GRANT ALL ON public.stark_events TO service_role;
ALTER TABLE public.stark_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated can read stark events" ON public.stark_events FOR SELECT TO authenticated USING (true);
CREATE INDEX stark_events_received_at_idx ON public.stark_events (received_at DESC);