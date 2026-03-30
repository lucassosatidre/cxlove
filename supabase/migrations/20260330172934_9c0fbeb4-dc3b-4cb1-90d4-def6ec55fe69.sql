CREATE POLICY "Operators can update delivery_checkins"
  ON public.delivery_checkins
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'caixa_tele')
    OR public.has_role(auth.uid(), 'caixa_salao')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'caixa_tele')
    OR public.has_role(auth.uid(), 'caixa_salao')
  );