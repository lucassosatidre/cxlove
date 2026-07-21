
CREATE TABLE public.ctrl_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('categoria','metodo','conta','fornecedor','descricao')),
  value text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ctrl_options TO authenticated;
GRANT ALL ON public.ctrl_options TO service_role;

ALTER TABLE public.ctrl_options ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ctrl_options read all authenticated"
  ON public.ctrl_options FOR SELECT TO authenticated USING (true);
CREATE POLICY "ctrl_options insert authenticated"
  ON public.ctrl_options FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ctrl_options update authenticated"
  ON public.ctrl_options FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "ctrl_options delete authenticated"
  ON public.ctrl_options FOR DELETE TO authenticated USING (true);

-- Seed: contas / bancos
INSERT INTO public.ctrl_options (kind, value) VALUES
  ('conta','iFood'),
  ('conta','Cresol'),
  ('conta','Inter'),
  ('conta','Sicredi'),
  ('conta','Banco do Brasil')
ON CONFLICT (kind, value) DO NOTHING;

-- Seed: categorias DRE Estrela
INSERT INTO public.ctrl_options (kind, value) VALUES
  ('categoria','Matéria Prima'),
  ('categoria','Frios'),
  ('categoria','Descartáveis'),
  ('categoria','Secos'),
  ('categoria','Bebidas'),
  ('categoria','Vinhos'),
  ('categoria','Horti Fruti'),
  ('categoria','Caixas de Pizzas'),
  ('categoria','Logística Terceirizada'),
  ('categoria','Motoboy'),
  ('categoria','Marketing'),
  ('categoria','Ifood Ads'),
  ('categoria','Meta Ads'),
  ('categoria','Google Ads'),
  ('categoria','Agência de Marketing'),
  ('categoria','Marketplace'),
  ('categoria','Comissão do Ifood'),
  ('categoria','Taxa de Antecipação - Ifood'),
  ('categoria','Taxas Brendi'),
  ('categoria','Taxas de Cartão'),
  ('categoria','Folha de Pagamento'),
  ('categoria','Adiantamento'),
  ('categoria','Extras'),
  ('categoria','FGTS'),
  ('categoria','INSS'),
  ('categoria','Férias'),
  ('categoria','Rescisões'),
  ('categoria','Vale Transporte'),
  ('categoria','Medicina Ocupacional'),
  ('categoria','Uniformes'),
  ('categoria','Treinamento da Equipe'),
  ('categoria','13º Salário'),
  ('categoria','Advogado'),
  ('categoria','Água'),
  ('categoria','Aluguel'),
  ('categoria','Contador'),
  ('categoria','Gás'),
  ('categoria','Internet'),
  ('categoria','IPTU'),
  ('categoria','Luz / Energia'),
  ('categoria','Seguro do Prédio'),
  ('categoria','Sistemas'),
  ('categoria','Taxa de Lixo'),
  ('categoria','Produtos de Limpeza'),
  ('categoria','Fornecedores'),
  ('categoria','Outros'),
  ('categoria','Manutenção Cozinha'),
  ('categoria','Manutenção Salão'),
  ('categoria','Manutenção Área Externa'),
  ('categoria','Manutenção Escritório'),
  ('categoria','Manutenção Geral'),
  ('categoria','Manutenção Tele Entrega'),
  ('categoria','Gasolina'),
  ('categoria','Manutenção Moto'),
  ('categoria','Seguro das Motos'),
  ('categoria','Emplacamento das Motos'),
  ('categoria','Simples Nacional'),
  ('categoria','ICMS'),
  ('categoria','ISS'),
  ('categoria','Pis e Cofins'),
  ('categoria','IRPJ'),
  ('categoria','CSLL'),
  ('categoria','Empréstimos'),
  ('categoria','Pró-Labore'),
  ('categoria','Taxas Bancárias'),
  ('categoria','Despesas Financeiras')
ON CONFLICT (kind, value) DO NOTHING;
