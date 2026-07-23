CREATE TABLE public.inter_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  descricao text,
  valor numeric,
  destino text,
  status text NOT NULL DEFAULT 'enviado',
  retorno jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.inter_pagamentos TO authenticated;
GRANT ALL ON public.inter_pagamentos TO service_role;
ALTER TABLE public.inter_pagamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth select inter_pagamentos" ON public.inter_pagamentos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert inter_pagamentos" ON public.inter_pagamentos
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE INDEX idx_inter_pagamentos_created_at ON public.inter_pagamentos (created_at DESC);