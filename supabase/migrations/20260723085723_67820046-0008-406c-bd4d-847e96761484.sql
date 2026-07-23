DROP POLICY IF EXISTS "auth insert stark_pagamentos" ON public.stark_pagamentos;
CREATE POLICY "auth insert pendente" ON public.stark_pagamentos
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'aguardando_aprovacao'
    AND approved_at IS NULL
    AND approved_by IS NULL
    AND stark_id IS NULL
  );
DROP POLICY IF EXISTS "auth update pendentes" ON public.stark_pagamentos;