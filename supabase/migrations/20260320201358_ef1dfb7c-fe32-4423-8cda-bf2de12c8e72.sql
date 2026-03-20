
-- Admin can SELECT all daily_closings
CREATE POLICY "Admins can view all closings"
ON public.daily_closings FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can UPDATE all daily_closings
CREATE POLICY "Admins can update all closings"
ON public.daily_closings FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can DELETE all daily_closings
CREATE POLICY "Admins can delete all closings"
ON public.daily_closings FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can SELECT all imports
CREATE POLICY "Admins can view all imports"
ON public.imports FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can UPDATE all imports
CREATE POLICY "Admins can update all imports"
ON public.imports FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can DELETE all imports
CREATE POLICY "Admins can delete all imports"
ON public.imports FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can SELECT all imported_orders
CREATE POLICY "Admins can view all imported orders"
ON public.imported_orders FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can INSERT imported_orders
CREATE POLICY "Admins can insert imported orders"
ON public.imported_orders FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can UPDATE all imported_orders
CREATE POLICY "Admins can update all imported orders"
ON public.imported_orders FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can DELETE all imported_orders
CREATE POLICY "Admins can delete all imported orders"
ON public.imported_orders FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can SELECT all order_payment_breakdowns
CREATE POLICY "Admins can view all breakdowns"
ON public.order_payment_breakdowns FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can INSERT order_payment_breakdowns
CREATE POLICY "Admins can insert breakdowns"
ON public.order_payment_breakdowns FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can UPDATE all order_payment_breakdowns
CREATE POLICY "Admins can update all breakdowns"
ON public.order_payment_breakdowns FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can DELETE all order_payment_breakdowns
CREATE POLICY "Admins can delete all breakdowns"
ON public.order_payment_breakdowns FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can SELECT all card_transactions
CREATE POLICY "Admins can view all card transactions"
ON public.card_transactions FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can UPDATE all card_transactions
CREATE POLICY "Admins can update all card transactions"
ON public.card_transactions FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can DELETE all card_transactions
CREATE POLICY "Admins can delete all card transactions"
ON public.card_transactions FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can INSERT card_transactions
CREATE POLICY "Admins can insert card transactions"
ON public.card_transactions FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can SELECT all cash_snapshots
CREATE POLICY "Admins can view all cash snapshots"
ON public.cash_snapshots FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can INSERT cash_snapshots
CREATE POLICY "Admins can insert cash snapshots"
ON public.cash_snapshots FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can UPDATE all cash_snapshots
CREATE POLICY "Admins can update all cash snapshots"
ON public.cash_snapshots FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can DELETE all cash_snapshots
CREATE POLICY "Admins can delete all cash snapshots"
ON public.cash_snapshots FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can SELECT all salon_closings
CREATE POLICY "Admins can view all salon closings"
ON public.salon_closings FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can UPDATE all salon_closings
CREATE POLICY "Admins can update all salon closings"
ON public.salon_closings FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can DELETE all salon_closings
CREATE POLICY "Admins can delete all salon closings"
ON public.salon_closings FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can INSERT salon_closings
CREATE POLICY "Admins can insert salon closings"
ON public.salon_closings FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can SELECT all salon_imports
CREATE POLICY "Admins can view all salon imports"
ON public.salon_imports FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can UPDATE all salon_imports
CREATE POLICY "Admins can update all salon imports"
ON public.salon_imports FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can DELETE all salon_imports
CREATE POLICY "Admins can delete all salon imports"
ON public.salon_imports FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can SELECT all salon_orders
CREATE POLICY "Admins can view all salon orders"
ON public.salon_orders FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can INSERT salon_orders
CREATE POLICY "Admins can insert salon orders"
ON public.salon_orders FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can UPDATE all salon_orders
CREATE POLICY "Admins can update all salon orders"
ON public.salon_orders FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can DELETE all salon_orders
CREATE POLICY "Admins can delete all salon orders"
ON public.salon_orders FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can SELECT all salon_order_payments
CREATE POLICY "Admins can view all salon order payments"
ON public.salon_order_payments FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can INSERT salon_order_payments
CREATE POLICY "Admins can insert salon order payments"
ON public.salon_order_payments FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can UPDATE all salon_order_payments
CREATE POLICY "Admins can update all salon order payments"
ON public.salon_order_payments FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can DELETE all salon_order_payments
CREATE POLICY "Admins can delete all salon order payments"
ON public.salon_order_payments FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can SELECT all salon_card_transactions
CREATE POLICY "Admins can view all salon card transactions"
ON public.salon_card_transactions FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can INSERT salon_card_transactions
CREATE POLICY "Admins can insert salon card transactions"
ON public.salon_card_transactions FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can UPDATE all salon_card_transactions
CREATE POLICY "Admins can update all salon card transactions"
ON public.salon_card_transactions FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can DELETE all salon_card_transactions
CREATE POLICY "Admins can delete all salon card transactions"
ON public.salon_card_transactions FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
