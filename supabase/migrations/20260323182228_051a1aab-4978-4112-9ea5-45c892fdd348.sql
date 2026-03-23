
-- imports: allow all authenticated users to SELECT
DROP POLICY IF EXISTS "Users can view their own imports" ON public.imports;
CREATE POLICY "All authenticated users can view imports"
  ON public.imports FOR SELECT TO authenticated USING (true);

-- imports: allow all authenticated users to UPDATE
DROP POLICY IF EXISTS "Users can update their own imports" ON public.imports;
CREATE POLICY "All authenticated users can update imports"
  ON public.imports FOR UPDATE TO authenticated USING (true);

-- salon_imports: allow all authenticated users to SELECT
DROP POLICY IF EXISTS "Users can view their own salon imports" ON public.salon_imports;
CREATE POLICY "All authenticated users can view salon imports"
  ON public.salon_imports FOR SELECT TO authenticated USING (true);

-- salon_imports: allow all authenticated users to DELETE
DROP POLICY IF EXISTS "Users can delete their own salon imports" ON public.salon_imports;
CREATE POLICY "All authenticated users can delete salon imports"
  ON public.salon_imports FOR DELETE TO authenticated USING (true);

-- salon_imports: allow all authenticated users to UPDATE
DROP POLICY IF EXISTS "Users can update their own salon imports" ON public.salon_imports;
CREATE POLICY "All authenticated users can update salon imports"
  ON public.salon_imports FOR UPDATE TO authenticated USING (true);

-- imported_orders: allow all authenticated users to SELECT
DROP POLICY IF EXISTS "Users can view orders from their imports" ON public.imported_orders;
CREATE POLICY "All authenticated users can view imported orders"
  ON public.imported_orders FOR SELECT TO authenticated USING (true);

-- imported_orders: allow all authenticated users to UPDATE (for confirming)
DROP POLICY IF EXISTS "Users can update orders from their imports" ON public.imported_orders;
CREATE POLICY "All authenticated users can update imported orders"
  ON public.imported_orders FOR UPDATE TO authenticated USING (true);

-- imported_orders: allow all authenticated users to DELETE
DROP POLICY IF EXISTS "Users can delete orders from their imports" ON public.imported_orders;
CREATE POLICY "All authenticated users can delete imported orders"
  ON public.imported_orders FOR DELETE TO authenticated USING (true);

-- imported_orders: allow all authenticated users to INSERT
DROP POLICY IF EXISTS "Users can insert orders into their imports" ON public.imported_orders;
CREATE POLICY "All authenticated users can insert imported orders"
  ON public.imported_orders FOR INSERT TO authenticated WITH CHECK (true);

-- salon_orders: allow all authenticated users to SELECT
DROP POLICY IF EXISTS "Users can view their salon orders" ON public.salon_orders;
CREATE POLICY "All authenticated users can view salon orders"
  ON public.salon_orders FOR SELECT TO authenticated USING (true);

-- salon_orders: allow all authenticated users to UPDATE
DROP POLICY IF EXISTS "Users can update their salon orders" ON public.salon_orders;
CREATE POLICY "All authenticated users can update salon orders"
  ON public.salon_orders FOR UPDATE TO authenticated USING (true);

-- salon_orders: allow all authenticated users to DELETE
DROP POLICY IF EXISTS "Users can delete their salon orders" ON public.salon_orders;
CREATE POLICY "All authenticated users can delete salon orders"
  ON public.salon_orders FOR DELETE TO authenticated USING (true);

-- salon_orders: allow all authenticated users to INSERT
DROP POLICY IF EXISTS "Users can insert their salon orders" ON public.salon_orders;
CREATE POLICY "All authenticated users can insert salon orders"
  ON public.salon_orders FOR INSERT TO authenticated WITH CHECK (true);

-- order_payment_breakdowns: allow all authenticated users to SELECT/INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "Users can view breakdowns of their orders" ON public.order_payment_breakdowns;
CREATE POLICY "All authenticated users can view breakdowns"
  ON public.order_payment_breakdowns FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can insert breakdowns for their orders" ON public.order_payment_breakdowns;
CREATE POLICY "All authenticated users can insert breakdowns"
  ON public.order_payment_breakdowns FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update breakdowns of their orders" ON public.order_payment_breakdowns;
CREATE POLICY "All authenticated users can update breakdowns"
  ON public.order_payment_breakdowns FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can delete breakdowns of their orders" ON public.order_payment_breakdowns;
CREATE POLICY "All authenticated users can delete breakdowns"
  ON public.order_payment_breakdowns FOR DELETE TO authenticated USING (true);

-- salon_order_payments: allow all authenticated users
DROP POLICY IF EXISTS "Users can view their salon order payments" ON public.salon_order_payments;
CREATE POLICY "All authenticated users can view salon order payments"
  ON public.salon_order_payments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can insert salon order payments" ON public.salon_order_payments;
CREATE POLICY "All authenticated users can insert salon order payments"
  ON public.salon_order_payments FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Users can update salon order payments" ON public.salon_order_payments;
CREATE POLICY "All authenticated users can update salon order payments"
  ON public.salon_order_payments FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can delete salon order payments" ON public.salon_order_payments;
CREATE POLICY "All authenticated users can delete salon order payments"
  ON public.salon_order_payments FOR DELETE TO authenticated USING (true);
