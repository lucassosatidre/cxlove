-- =============================================================================
-- Sofia knowledge bases — espelho local de bases e documentos
-- =============================================================================

CREATE TABLE public.sofia_knowledgebases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sofia_kb_id       bigint NOT NULL UNIQUE,
  name              text NOT NULL,
  description       text,
  status            text,
  status_label      text,
  documents_count   int DEFAULT 0,
  assistants_count  int DEFAULT 0,
  raw               jsonb,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sofia_kb_status_idx ON public.sofia_knowledgebases (status);

ALTER TABLE public.sofia_knowledgebases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sofia_knowledgebases"
  ON public.sofia_knowledgebases
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Documentos por base
CREATE TABLE public.sofia_kb_documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sofia_doc_id      bigint NOT NULL UNIQUE,
  sofia_kb_id       bigint NOT NULL REFERENCES public.sofia_knowledgebases(sofia_kb_id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text,
  type              text,
  type_label        text,
  status            text,
  status_label      text,
  raw               jsonb,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sofia_kb_docs_kb_idx ON public.sofia_kb_documents (sofia_kb_id);
CREATE INDEX sofia_kb_docs_type_idx ON public.sofia_kb_documents (type);

ALTER TABLE public.sofia_kb_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sofia_kb_documents"
  ON public.sofia_kb_documents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER sofia_knowledgebases_updated_at
  BEFORE UPDATE ON public.sofia_knowledgebases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER sofia_kb_documents_updated_at
  BEFORE UPDATE ON public.sofia_kb_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
