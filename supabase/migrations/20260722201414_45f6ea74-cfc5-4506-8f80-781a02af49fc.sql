DROP POLICY IF EXISTS "auth update stark_pagamentos" ON public.stark_pagamentos;
CREATE POLICY "auth update pendentes" ON public.stark_pagamentos
  FOR UPDATE TO authenticated
  USING (status = 'aguardando_aprovacao')
  WITH CHECK (status = 'aguardando_aprovacao');