-- Auditoria de ações da Clau (Nível 3 — Clau pode propor mutações).
-- Cada ação proposta pela Clau (UPDATE/INSERT/DELETE em tabelas audit_* ou
-- chamada de edge function) registra row aqui em status='pending_approval'.
-- O user precisa aprovar via UI antes de executar. Após execução, status
-- vira 'executed' ou 'failed' e output é registrado.

CREATE TABLE public.clau_actions_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid,
  action_type text NOT NULL CHECK (action_type IN ('mutation', 'invoke_function')),
  -- Pra mutation: SQL completo. Pra invoke_function: nome da função.
  payload text NOT NULL,
  -- Argumentos (jsonb body pra invoke; vazio pra mutation)
  args jsonb,
  -- Justificativa que a Clau escreveu pra usuário entender
  explanation text,
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved', 'rejected', 'executed', 'failed')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  output jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_clau_actions_user ON public.clau_actions_log(user_id, created_at DESC);
CREATE INDEX idx_clau_actions_status ON public.clau_actions_log(status);

ALTER TABLE public.clau_actions_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage clau_actions_log"
  ON public.clau_actions_log
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.touch_clau_actions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_clau_actions_updated_at
  BEFORE UPDATE ON public.clau_actions_log
  FOR EACH ROW EXECUTE FUNCTION public.touch_clau_actions_updated_at();

-- ============================================================================
-- RPC: executa mutation SQL aprovada com allowlist de tabelas
-- ============================================================================
-- Validações:
--   - Action existe e está em status='approved' E approved_by é o user atual
--   - SQL contém apenas UPDATE/INSERT/DELETE/WITH (sem DDL)
--   - Tabelas usadas estão na allowlist
--   - Sem múltiplos statements

CREATE OR REPLACE FUNCTION public.clau_exec_mutation(p_action_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_action public.clau_actions_log%ROWTYPE;
  v_sql text;
  v_uppr text;
  v_rows_affected bigint;
BEGIN
  -- Busca ação
  SELECT * INTO v_action FROM public.clau_actions_log WHERE id = p_action_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ação não encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_action.action_type != 'mutation' THEN
    RAISE EXCEPTION 'Ação não é do tipo mutation' USING ERRCODE = 'P0001';
  END IF;
  IF v_action.status != 'approved' THEN
    RAISE EXCEPTION 'Ação não está aprovada (status atual: %)', v_action.status USING ERRCODE = 'P0001';
  END IF;
  IF v_action.approved_by != auth.uid() THEN
    RAISE EXCEPTION 'Apenas quem aprovou pode executar' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Acesso restrito a admin' USING ERRCODE = 'P0001';
  END IF;

  v_sql := v_action.payload;
  v_uppr := UPPER(v_sql);

  -- Bloqueia DDL e operações destrutivas em massa
  IF v_uppr ~ '\b(DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|REINDEX|VACUUM|COPY|EXECUTE)\b' THEN
    RAISE EXCEPTION 'SQL contém operação proibida (DDL/destrutiva)' USING ERRCODE = 'P0001';
  END IF;

  -- Múltiplos statements: bloqueia ; seguido de não-whitespace antes do fim
  IF v_sql ~ ';\s*\S' THEN
    RAISE EXCEPTION 'Apenas 1 statement por chamada' USING ERRCODE = 'P0001';
  END IF;

  -- Deve começar com UPDATE/INSERT/DELETE/WITH (não SELECT — esse é run_query)
  IF v_uppr !~ '^\s*(UPDATE|INSERT|DELETE|WITH)\b' THEN
    RAISE EXCEPTION 'Apenas UPDATE/INSERT/DELETE/WITH permitido em mutation' USING ERRCODE = 'P0001';
  END IF;

  -- Allowlist de tabelas (regex pega FROM/UPDATE/INTO/JOIN tabela)
  -- Bloqueia mutações em user_roles, profiles, auth schema.
  IF v_uppr ~ '\b(USER_ROLES|PROFILES|AUTH\.|APP_SETTINGS)\b' THEN
    RAISE EXCEPTION 'Tabela bloqueada (segurança/config crítica)' USING ERRCODE = 'P0001';
  END IF;

  -- Executa
  BEGIN
    EXECUTE v_sql;
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    UPDATE public.clau_actions_log
       SET status = 'executed',
           output = jsonb_build_object('rows_affected', v_rows_affected),
           updated_at = now()
     WHERE id = p_action_id;
    RETURN jsonb_build_object('success', true, 'rows_affected', v_rows_affected);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.clau_actions_log
       SET status = 'failed',
           error_message = SQLERRM,
           updated_at = now()
     WHERE id = p_action_id;
    RAISE;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clau_exec_mutation(uuid) TO authenticated;

-- ============================================================================
-- RPC: aprova action (marca status='approved', registra approved_by/at)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.clau_approve_action(p_action_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Acesso restrito a admin' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.clau_actions_log
     SET status = 'approved',
         approved_by = auth.uid(),
         approved_at = now(),
         updated_at = now()
   WHERE id = p_action_id AND status = 'pending_approval';
END;
$$;

GRANT EXECUTE ON FUNCTION public.clau_approve_action(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.clau_reject_action(p_action_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Acesso restrito a admin' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.clau_actions_log
     SET status = 'rejected',
         approved_by = auth.uid(),
         approved_at = now(),
         updated_at = now()
   WHERE id = p_action_id AND status = 'pending_approval';
END;
$$;

GRANT EXECUTE ON FUNCTION public.clau_reject_action(uuid) TO authenticated;
