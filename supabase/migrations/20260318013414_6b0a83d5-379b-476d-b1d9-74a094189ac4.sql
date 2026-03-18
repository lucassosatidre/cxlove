
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  permission text NOT NULL,
  UNIQUE(user_id, permission)
);

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own permissions"
ON public.user_permissions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Admins can manage permissions"
ON public.user_permissions
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Insert default permissions for existing users
-- Admin gets all permissions
INSERT INTO public.user_permissions (user_id, permission)
SELECT ur.user_id, p.permission
FROM public.user_roles ur
CROSS JOIN (VALUES ('dashboard'), ('import'), ('reconciliation'), ('delivery_reconciliation')) AS p(permission)
WHERE ur.role = 'admin'
ON CONFLICT DO NOTHING;

-- Operador gets all permissions by default too
INSERT INTO public.user_permissions (user_id, permission)
SELECT ur.user_id, p.permission
FROM public.user_roles ur
CROSS JOIN (VALUES ('dashboard'), ('import'), ('reconciliation'), ('delivery_reconciliation')) AS p(permission)
WHERE ur.role = 'operador'
ON CONFLICT DO NOTHING;
