
DROP POLICY "Users can delete their own imports" ON public.imports;

CREATE POLICY "All authenticated users can delete imports"
  ON public.imports
  FOR DELETE
  TO authenticated
  USING (true);
