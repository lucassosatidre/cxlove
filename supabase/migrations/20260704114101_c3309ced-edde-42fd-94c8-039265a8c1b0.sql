CREATE TABLE public.nfse_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave_acesso text UNIQUE,
  numero_nfse text,
  data_emissao date,
  valor_servico numeric,
  situacao text,
  descricao text,
  municipio text,
  consulta text,
  prestador_cnpj text,
  prestador_nome text,
  tomador_cnpj text,
  tomador_nome text,
  codigo_verificacao text,
  justificativa text,
  has_xml boolean NOT NULL DEFAULT false,
  has_pdf boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'espiao',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nfse_documents TO authenticated;
GRANT ALL ON public.nfse_documents TO service_role;

ALTER TABLE public.nfse_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view nfse_documents"
  ON public.nfse_documents FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert nfse_documents"
  ON public.nfse_documents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update nfse_documents"
  ON public.nfse_documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete nfse_documents"
  ON public.nfse_documents FOR DELETE TO authenticated USING (true);

CREATE INDEX nfse_documents_data_emissao_idx ON public.nfse_documents (data_emissao DESC);
CREATE INDEX nfse_documents_situacao_idx ON public.nfse_documents (situacao);

CREATE TRIGGER nfse_documents_set_updated_at
  BEFORE UPDATE ON public.nfse_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage policies for private bucket 'nfse' (bucket será criado via tool separado)
CREATE POLICY "Authenticated can read nfse files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'nfse');
CREATE POLICY "Authenticated can upload nfse files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'nfse');
CREATE POLICY "Authenticated can update nfse files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'nfse') WITH CHECK (bucket_id = 'nfse');
CREATE POLICY "Authenticated can delete nfse files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'nfse');