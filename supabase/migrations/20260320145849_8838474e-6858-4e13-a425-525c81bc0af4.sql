DELETE FROM salon_orders 
WHERE id = 'ef12fbd3-b10e-414b-86d4-c22fa99bdc1b';

CREATE POLICY "Users can delete their salon orders"
ON salon_orders FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM salon_imports si
    WHERE si.id = salon_orders.salon_import_id
    AND si.user_id = auth.uid()
  )
);