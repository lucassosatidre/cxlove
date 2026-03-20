
-- Allow users to delete their own salon imports
CREATE POLICY "Users can delete their own salon imports"
ON public.salon_imports
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
