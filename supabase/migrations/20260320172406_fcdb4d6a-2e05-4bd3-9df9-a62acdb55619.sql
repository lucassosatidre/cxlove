
-- Allow users to delete their own imports
CREATE POLICY "Users can delete their own imports"
ON public.imports
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Allow users to delete orders from their imports
CREATE POLICY "Users can delete orders from their imports"
ON public.imported_orders
FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM imports
  WHERE imports.id = imported_orders.import_id
  AND imports.user_id = auth.uid()
));

-- Allow users to delete their own daily closings
CREATE POLICY "Users can delete their own daily closings"
ON public.daily_closings
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
