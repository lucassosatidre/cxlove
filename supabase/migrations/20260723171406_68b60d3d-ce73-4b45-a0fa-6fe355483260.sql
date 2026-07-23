
-- Public-safe view of delivery_drivers (no PII: email, pix, cnpj, notas)
CREATE OR REPLACE VIEW public.delivery_drivers_public AS
SELECT id, auth_user_id, nome, telefone, status, password_changed, created_at, updated_at
FROM public.delivery_drivers;

-- Runs with definer rights (bypass base RLS); default is security_invoker=off.
REVOKE ALL ON public.delivery_drivers_public FROM PUBLIC, anon;
GRANT SELECT ON public.delivery_drivers_public TO authenticated;

-- Tighten base table SELECT: only admin/lider/self
DROP POLICY IF EXISTS "Authenticated users can view delivery drivers" ON public.delivery_drivers;

CREATE POLICY "Admin lider or self can view delivery drivers"
ON public.delivery_drivers
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'lider'::public.app_role)
  OR auth_user_id = auth.uid()
);
