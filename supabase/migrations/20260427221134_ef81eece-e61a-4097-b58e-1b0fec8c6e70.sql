CREATE OR REPLACE FUNCTION public.clau_safe_query(p_sql text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SET LOCAL statement_timeout = '5s';
  -- Sem check de auth.uid() — a Edge Function valida admin antes de chamar
  -- Acesso é restrito via REVOKE abaixo (só service_role pode invocar)
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', p_sql) INTO v_result;
  RETURN COALESCE(v_result, '[]'::jsonb);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Erro SQL: %', SQLERRM;
END;
$$;

-- Revogar acesso direto de usuários autenticados; só service_role chama
REVOKE EXECUTE ON FUNCTION public.clau_safe_query(text) FROM authenticated, anon, public;
GRANT EXECUTE ON FUNCTION public.clau_safe_query(text) TO service_role;