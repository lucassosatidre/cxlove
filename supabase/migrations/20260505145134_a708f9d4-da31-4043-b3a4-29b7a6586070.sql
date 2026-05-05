-- ─── 1. DROP modelo v1 ──────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.audit_ifood_marketplace_daily_overrides CASCADE;
DROP TABLE IF EXISTS public.audit_ifood_marketplace_daily CASCADE;

-- ─── 2. RENAME orders e adiciona store_id_curto ────────────────────────────
ALTER TABLE public.audit_ifood_marketplace_orders
  RENAME TO audit_ifood_orders;

ALTER TABLE public.audit_ifood_orders
  ADD COLUMN IF NOT EXISTS store_id_curto text;

CREATE INDEX IF NOT EXISTS idx_ifood_orders_store
  ON public.audit_ifood_orders (audit_period_id, store_id_curto);

-- ─── 3. audit_ifood_lancamentos ─────────────────────────────────────────────
CREATE TABLE public.audit_ifood_lancamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  import_id uuid REFERENCES public.audit_imports(id) ON DELETE SET NULL,
  store_id_curto text NOT NULL,
  idx_arquivo int NOT NULL,
  competencia text,
  fato_gerador text,
  tipo_lancamento text,
  descricao_lancamento text,
  valor numeric(14,2),
  base_calculo numeric(14,2),
  percentual_taxa numeric(8,6),
  pedido_associado_ifood text,
  pedido_associado_ifood_curto text,
  motivo_cancelamento text,
  descricao_ocorrencia text,
  data_criacao_pedido_associado timestamptz,
  data_repasse_esperada date,
  valor_transacao numeric(14,2),
  loja_id text,
  loja_id_curto text,
  cnpj text,
  data_faturamento date,
  data_apuracao_inicio date,
  data_apuracao_fim date,
  valor_cesta_final numeric(14,2),
  responsavel_transacao text,
  canal_vendas text,
  impacto_no_repasse text,
  pedido_detalhes text,
  id_saldo text,
  metodo_pagamento text,
  bandeira_pagamento text,
  categoria_calc text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_period_id, store_id_curto, idx_arquivo)
);

CREATE INDEX idx_ifood_lanc_pedido ON public.audit_ifood_lancamentos (pedido_associado_ifood);
CREATE INDEX idx_ifood_lanc_repasse ON public.audit_ifood_lancamentos (audit_period_id, store_id_curto, data_repasse_esperada);
CREATE INDEX idx_ifood_lanc_categoria ON public.audit_ifood_lancamentos (audit_period_id, categoria_calc);
CREATE INDEX idx_ifood_lanc_impacto ON public.audit_ifood_lancamentos (audit_period_id, impacto_no_repasse);

ALTER TABLE public.audit_ifood_lancamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY ifood_lanc_admin_all ON public.audit_ifood_lancamentos
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ─── 4. audit_ifood_repasses ────────────────────────────────────────────────
CREATE TABLE public.audit_ifood_repasses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  store_id_curto text NOT NULL,
  data_repasse_esperada date NOT NULL,
  periodo_apuracao_inicio date,
  periodo_apuracao_fim date,
  bruto_venda numeric(14,2) DEFAULT 0,
  pgto_direto_loja numeric(14,2) DEFAULT 0,
  comissao numeric(14,2) DEFAULT 0,
  taxa_transacao numeric(14,2) DEFAULT 0,
  taxa_conveniencia numeric(14,2) DEFAULT 0,
  taxa_entrega_ret numeric(14,2) DEFAULT 0,
  taxa_servico_sob_demanda numeric(14,2) DEFAULT 0,
  taxa_servico_cliente numeric(14,2) DEFAULT 0,
  promo_ifood numeric(14,2) DEFAULT 0,
  promo_loja numeric(14,2) DEFAULT 0,
  frete_ifood numeric(14,2) DEFAULT 0,
  cancel_frete numeric(14,2) DEFAULT 0,
  cancel_total numeric(14,2) DEFAULT 0,
  cancel_parcial numeric(14,2) DEFAULT 0,
  ads numeric(14,2) DEFAULT 0,
  ressarc numeric(14,2) DEFAULT 0,
  ocor_venda numeric(14,2) DEFAULT 0,
  reembolsos numeric(14,2) DEFAULT 0,
  mensalidade numeric(14,2) DEFAULT 0,
  outros numeric(14,2) DEFAULT 0,
  liquido_esperado numeric(14,2) DEFAULT 0,
  conta_recebido numeric(14,2),
  conta_data_recebimento date,
  conta_taxa_antecip numeric(14,2),
  liquido_efetivo numeric(14,2),
  conta_movimento_id uuid,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'matched', 'matched_aprox', 'unmatched', 'sem_repasse')),
  diff numeric(14,2),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_period_id, store_id_curto, data_repasse_esperada)
);

CREATE INDEX idx_ifood_repasses_data ON public.audit_ifood_repasses (audit_period_id, data_repasse_esperada);
CREATE INDEX idx_ifood_repasses_status ON public.audit_ifood_repasses (audit_period_id, status);

ALTER TABLE public.audit_ifood_repasses ENABLE ROW LEVEL SECURITY;
CREATE POLICY ifood_rep_admin_all ON public.audit_ifood_repasses
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ─── 5. audit_ifood_conta_movimentos ────────────────────────────────────────
CREATE TABLE public.audit_ifood_conta_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  import_id uuid REFERENCES public.audit_imports(id) ON DELETE SET NULL,
  csv_idx int NOT NULL,
  data date NOT NULL,
  descricao text NOT NULL,
  valor numeric(14,2) NOT NULL,
  categoria_csv text NOT NULL,
  categoria text NOT NULL
    CHECK (categoria IN ('repasse', 'taxa_antecip')),
  match_repasse_ids uuid[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'matched', 'unmatched_outra_comp')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_period_id, csv_idx, descricao)
);

CREATE INDEX idx_ifood_conta_data ON public.audit_ifood_conta_movimentos (audit_period_id, data, categoria);

ALTER TABLE public.audit_ifood_conta_movimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY ifood_conta_admin_all ON public.audit_ifood_conta_movimentos
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ─── 6. ALTER audit_imports.file_type CHECK ─────────────────────────────────
ALTER TABLE public.audit_imports DROP CONSTRAINT IF EXISTS audit_imports_file_type_check;
ALTER TABLE public.audit_imports ADD CONSTRAINT audit_imports_file_type_check
  CHECK (file_type IN (
    'maquinona', 'cresol', 'bb',
    'ticket', 'alelo', 'pluxee', 'vr',
    'saipos', 'brendi',
    'ifood_orders',
    'ifood_extrato_detalhado',
    'ifood_conta_csv'
  ));