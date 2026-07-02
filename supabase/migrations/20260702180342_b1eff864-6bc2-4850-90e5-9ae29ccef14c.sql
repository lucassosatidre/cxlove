
CREATE TABLE public.pluggy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id text NOT NULL,
  connector_id integer NULL,
  connector_name text NULL,
  status text NULL,
  company text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pluggy_items TO authenticated;
GRANT ALL ON public.pluggy_items TO service_role;

ALTER TABLE public.pluggy_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view pluggy_items"
  ON public.pluggy_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert pluggy_items"
  ON public.pluggy_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update pluggy_items"
  ON public.pluggy_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete pluggy_items"
  ON public.pluggy_items FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_pluggy_items_updated_at
  BEFORE UPDATE ON public.pluggy_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE UNIQUE INDEX pluggy_items_item_id_key ON public.pluggy_items(item_id);
