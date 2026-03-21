-- Allow all authenticated users to view all daily_closings (shared per date)
DROP POLICY IF EXISTS "Users can view their own closings" ON public.daily_closings;
CREATE POLICY "All authenticated users can view closings"
ON public.daily_closings FOR SELECT TO authenticated
USING (true);

-- Allow all authenticated users to update daily_closings
DROP POLICY IF EXISTS "Users can update their own closings" ON public.daily_closings;
CREATE POLICY "All authenticated users can update closings"
ON public.daily_closings FOR UPDATE TO authenticated
USING (true);

-- Allow all authenticated users to delete daily_closings  
DROP POLICY IF EXISTS "Users can delete their own daily closings" ON public.daily_closings;
CREATE POLICY "All authenticated users can delete closings"
ON public.daily_closings FOR DELETE TO authenticated
USING (true);

-- Same for salon_closings
DROP POLICY IF EXISTS "Users can view their own salon closings" ON public.salon_closings;
CREATE POLICY "All authenticated users can view salon closings"
ON public.salon_closings FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Users can update their own salon closings" ON public.salon_closings;
CREATE POLICY "All authenticated users can update salon closings"
ON public.salon_closings FOR UPDATE TO authenticated
USING (true);

DROP POLICY IF EXISTS "Users can delete their own salon closings" ON public.salon_closings;
CREATE POLICY "All authenticated users can delete salon closings"
ON public.salon_closings FOR DELETE TO authenticated
USING (true);