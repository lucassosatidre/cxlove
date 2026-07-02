CREATE TABLE public.pluggy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text,
  item_id text,
  payload jsonb,
  processed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pluggy_events TO authenticated;
GRANT ALL ON public.pluggy_events TO service_role;

ALTER TABLE public.pluggy_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read pluggy events"
  ON public.pluggy_events FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX pluggy_events_created_at_idx ON public.pluggy_events (created_at DESC);
CREATE INDEX pluggy_events_item_id_idx ON public.pluggy_events (item_id);