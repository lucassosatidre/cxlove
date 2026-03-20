
-- Allow users to delete their own salon closings (when all imports are removed)
CREATE POLICY "Users can delete their own salon closings"
ON public.salon_closings
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
