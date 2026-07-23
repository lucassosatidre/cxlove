
DROP POLICY IF EXISTS "auth insert menuperm" ON public.menu_permissions;
DROP POLICY IF EXISTS "auth_insert_mp" ON public.menu_permissions;
DROP POLICY IF EXISTS "auth update menuperm" ON public.menu_permissions;
DROP POLICY IF EXISTS "auth_update_mp" ON public.menu_permissions;
DROP POLICY IF EXISTS "auth delete menuperm" ON public.menu_permissions;
DROP POLICY IF EXISTS "auth_delete_mp" ON public.menu_permissions;
DROP POLICY IF EXISTS "auth select menuperm" ON public.menu_permissions;
DROP POLICY IF EXISTS "auth_select_mp" ON public.menu_permissions;
CREATE POLICY "mp_select_own_or_admin" ON public.menu_permissions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY "mp_write_admin" ON public.menu_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::public.app_role));

DROP POLICY IF EXISTS "auth select profiles" ON public.profiles;
DROP POLICY IF EXISTS "auth_select_profiles" ON public.profiles;
DROP POLICY IF EXISTS "auth update profiles" ON public.profiles;
DROP POLICY IF EXISTS "auth_update_profiles" ON public.profiles;
DROP POLICY IF EXISTS "auth insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "auth_insert_profiles" ON public.profiles;
DROP POLICY IF EXISTS "auth delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "auth_delete_profiles" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY "profiles_update_own_or_admin" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'::public.app_role))
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(),'admin'::public.app_role));
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_delete_admin" ON public.profiles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'::public.app_role));
