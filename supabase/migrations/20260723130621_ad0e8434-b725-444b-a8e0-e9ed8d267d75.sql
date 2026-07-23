CREATE TABLE IF NOT EXISTS public.finance_viewers (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.finance_viewers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own finance row" ON public.finance_viewers;
CREATE POLICY "own finance row" ON public.finance_viewers
  FOR SELECT TO authenticated
  USING (lower(email) = lower(auth.jwt()->>'email'));
GRANT SELECT ON public.finance_viewers TO authenticated;
GRANT ALL ON public.finance_viewers TO service_role;

INSERT INTO public.finance_viewers (email) VALUES
  ('adm@vigia.com'), ('lucassosatidre@gmail.com'), ('luana@vigia.com')
ON CONFLICT (email) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_finance()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.finance_viewers
    WHERE lower(email) = lower(auth.jwt()->>'email')
  );
$$;

DROP POLICY IF EXISTS "authenticated can read stark events" ON public.stark_events;
DROP POLICY IF EXISTS "finance read stark_events" ON public.stark_events;
CREATE POLICY "finance read stark_events" ON public.stark_events
  FOR SELECT TO authenticated USING (public.is_finance());

DROP POLICY IF EXISTS "auth select stark_pagamentos" ON public.stark_pagamentos;
DROP POLICY IF EXISTS "finance select stark_pagamentos" ON public.stark_pagamentos;
CREATE POLICY "finance select stark_pagamentos" ON public.stark_pagamentos
  FOR SELECT TO authenticated USING (public.is_finance());

DROP POLICY IF EXISTS "auth select inter_pagamentos" ON public.inter_pagamentos;
DROP POLICY IF EXISTS "finance select inter_pagamentos" ON public.inter_pagamentos;
CREATE POLICY "finance select inter_pagamentos" ON public.inter_pagamentos
  FOR SELECT TO authenticated USING (public.is_finance());

DROP POLICY IF EXISTS "auth insert pendente" ON public.stark_pagamentos;
DROP POLICY IF EXISTS "finance insert pendente" ON public.stark_pagamentos;
CREATE POLICY "finance insert pendente" ON public.stark_pagamentos
  FOR INSERT TO authenticated
  WITH CHECK (public.is_finance() AND status='aguardando_aprovacao' AND approved_at IS NULL AND approved_by IS NULL AND stark_id IS NULL);

DROP POLICY IF EXISTS "auth insert inter_pagamentos" ON public.inter_pagamentos;
DROP POLICY IF EXISTS "finance insert inter_pagamentos" ON public.inter_pagamentos;
CREATE POLICY "finance insert inter_pagamentos" ON public.inter_pagamentos
  FOR INSERT TO authenticated WITH CHECK (public.is_finance());