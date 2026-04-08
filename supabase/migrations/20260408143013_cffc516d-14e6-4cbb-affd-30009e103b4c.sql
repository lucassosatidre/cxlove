CREATE OR REPLACE FUNCTION public.mark_password_changed(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;

  UPDATE public.delivery_drivers
  SET password_changed = true
  WHERE auth_user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Perfil de entregador não encontrado';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_password_changed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_password_changed(uuid) TO authenticated;