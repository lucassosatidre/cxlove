-- 1.1) Logs de tool calls
CREATE TABLE IF NOT EXISTS public.clau_tool_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES public.clau_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  tool_name text NOT NULL,
  tool_input jsonb NOT NULL,
  tool_output_size int,
  duration_ms int,
  error text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clau_tool_logs_conv ON public.clau_tool_logs(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clau_tool_logs_tool ON public.clau_tool_logs(tool_name, created_at DESC);
ALTER TABLE public.clau_tool_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read tool logs" ON public.clau_tool_logs;
CREATE POLICY "Admins read tool logs" ON public.clau_tool_logs
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Service role writes tool logs" ON public.clau_tool_logs;
CREATE POLICY "Service role writes tool logs" ON public.clau_tool_logs
  FOR INSERT WITH CHECK (true);

-- 1.2) Resumos auto-gerados (search_vector via trigger - to_tsvector with text config is not IMMUTABLE)
CREATE TABLE IF NOT EXISTS public.clau_conversation_summaries (
  conversation_id uuid PRIMARY KEY REFERENCES public.clau_conversations(id) ON DELETE CASCADE,
  summary text NOT NULL,
  topics text[],
  generated_at timestamptz DEFAULT now(),
  message_count_when_generated int,
  search_vector tsvector
);
CREATE INDEX IF NOT EXISTS idx_clau_conv_sum_search ON public.clau_conversation_summaries USING gin(search_vector);

CREATE OR REPLACE FUNCTION public.clau_conv_sum_tsv_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('portuguese', coalesce(NEW.summary, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(array_to_string(NEW.topics, ' '), '')), 'B');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS clau_conv_sum_tsv ON public.clau_conversation_summaries;
CREATE TRIGGER clau_conv_sum_tsv BEFORE INSERT OR UPDATE
  ON public.clau_conversation_summaries
  FOR EACH ROW EXECUTE FUNCTION public.clau_conv_sum_tsv_trigger();

ALTER TABLE public.clau_conversation_summaries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read conv summaries" ON public.clau_conversation_summaries;
CREATE POLICY "Admins read conv summaries" ON public.clau_conversation_summaries
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Service role writes summaries" ON public.clau_conversation_summaries;
CREATE POLICY "Service role writes summaries" ON public.clau_conversation_summaries
  FOR ALL USING (true);

-- 1.3) Fatos auto-extraídos
CREATE TABLE IF NOT EXISTS public.clau_extracted_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fact text NOT NULL,
  category text,
  source_conversation_id uuid REFERENCES public.clau_conversations(id) ON DELETE SET NULL,
  source_message_id uuid REFERENCES public.clau_messages(id) ON DELETE SET NULL,
  confirmed_by_user boolean DEFAULT false,
  archived boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  search_vector tsvector
);
CREATE INDEX IF NOT EXISTS idx_clau_facts_search ON public.clau_extracted_facts USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_clau_facts_cat ON public.clau_extracted_facts(category, created_at DESC) WHERE archived = false;

CREATE OR REPLACE FUNCTION public.clau_facts_tsv_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.search_vector := to_tsvector('portuguese', coalesce(NEW.fact, ''));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS clau_facts_tsv ON public.clau_extracted_facts;
CREATE TRIGGER clau_facts_tsv BEFORE INSERT OR UPDATE
  ON public.clau_extracted_facts
  FOR EACH ROW EXECUTE FUNCTION public.clau_facts_tsv_trigger();

ALTER TABLE public.clau_extracted_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read facts" ON public.clau_extracted_facts;
CREATE POLICY "Admins read facts" ON public.clau_extracted_facts
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins write facts" ON public.clau_extracted_facts;
CREATE POLICY "Admins write facts" ON public.clau_extracted_facts
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- 1.4) FTS em mensagens existentes via trigger
ALTER TABLE public.clau_messages 
  ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_clau_msg_search ON public.clau_messages USING gin(search_vector);

CREATE OR REPLACE FUNCTION public.clau_msg_tsv_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.search_vector := to_tsvector('portuguese', coalesce(NEW.content, ''));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS clau_msg_tsv ON public.clau_messages;
CREATE TRIGGER clau_msg_tsv BEFORE INSERT OR UPDATE
  ON public.clau_messages
  FOR EACH ROW EXECUTE FUNCTION public.clau_msg_tsv_trigger();

-- Backfill mensagens existentes
UPDATE public.clau_messages SET content = content WHERE search_vector IS NULL;

-- 2) RPC executor SQL com guardrails
CREATE OR REPLACE FUNCTION public.clau_safe_query(p_sql text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SET LOCAL statement_timeout = '5s';
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Apenas admins podem executar queries';
  END IF;
  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', p_sql) INTO v_result;
  RETURN COALESCE(v_result, '[]'::jsonb);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Erro SQL: %', SQLERRM;
END;
$$;
GRANT EXECUTE ON FUNCTION public.clau_safe_query(text) TO authenticated;

-- 3) RPCs de busca FTS
CREATE OR REPLACE FUNCTION public.clau_search_messages(
  p_user_id uuid, p_query text, p_limit int DEFAULT 10
) RETURNS TABLE(
  conversation_id uuid, conversation_title text, role text, 
  content text, created_at timestamptz, rank real
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT m.conversation_id, c.title, m.role, m.content, m.created_at,
         ts_rank(m.search_vector, websearch_to_tsquery('portuguese', p_query)) AS rank
  FROM clau_messages m
  JOIN clau_conversations c ON c.id = m.conversation_id
  WHERE c.user_id = p_user_id
    AND m.search_vector @@ websearch_to_tsquery('portuguese', p_query)
  ORDER BY rank DESC, m.created_at DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.clau_search_summaries(
  p_user_id uuid, p_query text, p_limit int DEFAULT 5
) RETURNS TABLE(
  conversation_id uuid, conversation_title text, summary text, 
  topics text[], generated_at timestamptz, rank real
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.conversation_id, c.title, s.summary, s.topics, s.generated_at,
         ts_rank(s.search_vector, websearch_to_tsquery('portuguese', p_query)) AS rank
  FROM clau_conversation_summaries s
  JOIN clau_conversations c ON c.id = s.conversation_id
  WHERE c.user_id = p_user_id
    AND s.search_vector @@ websearch_to_tsquery('portuguese', p_query)
  ORDER BY rank DESC, s.generated_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clau_search_messages(uuid, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clau_search_summaries(uuid, text, int) TO authenticated;