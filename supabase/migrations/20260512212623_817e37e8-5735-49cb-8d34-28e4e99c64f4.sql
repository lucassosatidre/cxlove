CREATE OR REPLACE FUNCTION public.openclaw_run_sql_select(p_sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_upper  text;
BEGIN
  IF p_sql IS NULL OR length(btrim(p_sql)) = 0 THEN
    RAISE EXCEPTION 'SQL vazio' USING ERRCODE = 'P0001';
  END IF;

  v_upper := upper(p_sql);

  -- Só permite SELECT ou WITH no início (POSIX ARE: \s/\b não funcionam via string literal)
  IF v_upper !~ '^[[:space:]]*(SELECT|WITH)([[:space:]]|\()' THEN
    RAISE EXCEPTION 'Apenas SELECT/WITH é permitido' USING ERRCODE = 'P0001';
  END IF;

  -- Bloqueia palavras-chave perigosas (defesa em profundidade — o role já bloqueia escrita)
  IF v_upper ~ '(^|[^[:alnum:]_])(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|COPY|VACUUM|REINDEX)([^[:alnum:]_]|$)' THEN
    RAISE EXCEPTION 'SQL contém operação proibida' USING ERRCODE = 'P0001';
  END IF;

  -- Bloqueia acesso a catálogos pg_*
  IF v_upper ~ '(^|[^[:alnum:]_])PG_[A-Z_]+' THEN
    RAISE EXCEPTION 'Acesso a catálogo pg_* não permitido' USING ERRCODE = 'P0001';
  END IF;

  -- Bloqueia múltiplos statements
  IF p_sql ~ ';[[:space:]]*[^[:space:]]' THEN
    RAISE EXCEPTION 'Apenas 1 statement por chamada' USING ERRCODE = 'P0001';
  END IF;

  SET LOCAL statement_timeout = '10s';
  SET LOCAL idle_in_transaction_session_timeout = '15s';
  SET LOCAL ROLE openclaw_readonly;

  EXECUTE format('SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t', p_sql)
  INTO v_result;

  RESET ROLE;
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  BEGIN RESET ROLE; EXCEPTION WHEN OTHERS THEN NULL; END;
  RAISE EXCEPTION 'Erro SQL: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.openclaw_run_sql_select(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.openclaw_run_sql_select(text) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.openclaw_run_sql_select(text) TO service_role;