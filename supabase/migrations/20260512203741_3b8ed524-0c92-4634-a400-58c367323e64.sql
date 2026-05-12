-- 1) Adicionar coluna caller em clau_tool_logs (se ainda não existe)
ALTER TABLE public.clau_tool_logs
  ADD COLUMN IF NOT EXISTS caller text NOT NULL DEFAULT 'clau';

CREATE INDEX IF NOT EXISTS idx_clau_tool_logs_caller_created
  ON public.clau_tool_logs (caller, created_at DESC);

-- 2) Role read-only para openclaw
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openclaw_readonly') THEN
    CREATE ROLE openclaw_readonly NOLOGIN;
  END IF;
END
$$;

-- Permissão de uso do schema
GRANT USAGE ON SCHEMA public TO openclaw_readonly;

-- SELECT em todas as tabelas atuais
GRANT SELECT ON ALL TABLES IN SCHEMA public TO openclaw_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO openclaw_readonly;

-- SELECT em tabelas futuras criadas pelo postgres/service_role
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO openclaw_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO openclaw_readonly;

-- Garantir que NÃO tem nenhum DML
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM openclaw_readonly;

-- 3) Função SECURITY DEFINER que roda SELECT como openclaw_readonly
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

  -- Só permite SELECT ou WITH no início
  IF v_upper !~ '^\s*(SELECT|WITH)\b' THEN
    RAISE EXCEPTION 'Apenas SELECT/WITH é permitido' USING ERRCODE = 'P0001';
  END IF;

  -- Bloqueia palavras-chave perigosas (defesa em profundidade — o role já bloqueia)
  IF v_upper ~ '\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|COPY|VACUUM|REINDEX|SECURITY\s+DEFINER)\b' THEN
    RAISE EXCEPTION 'SQL contém operação proibida' USING ERRCODE = 'P0001';
  END IF;

  IF v_upper ~ '\bPG_[A-Z_]+\b' THEN
    RAISE EXCEPTION 'Acesso a catálogo pg_* não permitido' USING ERRCODE = 'P0001';
  END IF;

  -- Bloqueia múltiplos statements
  IF p_sql ~ ';\s*\S' THEN
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

-- Restringe a função: apenas service_role pode chamar (edge function usa service key)
REVOKE ALL ON FUNCTION public.openclaw_run_sql_select(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.openclaw_run_sql_select(text) FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.openclaw_run_sql_select(text) TO service_role;