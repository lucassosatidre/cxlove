
CREATE TABLE public.stark_pagamentos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tipo text NOT NULL DEFAULT 'boleto',
  linha text NOT NULL,
  description text,
  amount_reais numeric,
  beneficiario text,
  status text NOT NULL DEFAULT 'aguardando_aprovacao',
  erro text,
  stark_id text,
  created_by uuid,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  processed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stark_pagamentos TO authenticated;
GRANT ALL ON public.stark_pagamentos TO service_role;

ALTER TABLE public.stark_pagamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth select stark_pagamentos" ON public.stark_pagamentos FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert stark_pagamentos" ON public.stark_pagamentos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update stark_pagamentos" ON public.stark_pagamentos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX stark_pagamentos_status_idx ON public.stark_pagamentos(status);

ALTER PUBLICATION supabase_realtime ADD TABLE public.stark_pagamentos;
