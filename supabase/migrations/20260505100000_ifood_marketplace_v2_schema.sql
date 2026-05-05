-- =============================================================================
-- iFood Marketplace v2 — refator completo do estágio 4
-- =============================================================================
-- Modelo v1 (audit_ifood_marketplace_daily) descartado: usava CSV Auditoria
-- portal e cruzava direto com Cresol, ignorando ciclo D+24, antecipação,
-- decomposição de custos e duas lojas. Modelo v2 baseia tudo no extrato
-- detalhado (fonte da verdade do iFood) + CSV da conta iFood Pago.
-- =============================================================================

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

-- ─── 3. audit_ifood_lancamentos (raw extrato detalhado, fonte da verdade) ───
CREATE TABLE public.audit_ifood_lancamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  import_id uuid REFERENCES public.audit_imports(id) ON DELETE SET NULL,
  store_id_curto text NOT NULL,
  idx_arquivo int NOT NULL,                -- ordem original no XLSX (0-based após header)
  -- Colunas raw do extrato (mantém nomes Portal Parceiro)
  competencia text,                         -- 'YYYY-MM'
  fato_gerador text,                        -- Venda | Solicitação frete | Cancelamento Total | etc
  tipo_lancamento text,                     -- Cobrança | Subsídio | Entrada Financeira | etc
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
  responsavel_transacao text,               -- LOJA | IFOOD
  canal_vendas text,
  impacto_no_repasse text,                  -- 'SIM' | 'NÃO'
  pedido_detalhes text,
  id_saldo text,
  metodo_pagamento text,
  bandeira_pagamento text,
  -- Coluna derivada (categoria de custo)
  categoria_calc text NOT NULL,             -- bruto_venda|comissao|taxa_transacao|etc
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

-- ─── 4. audit_ifood_repasses (agregado derivado, 5 datas × 2 lojas/mês) ─────
CREATE TABLE public.audit_ifood_repasses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  store_id_curto text NOT NULL,
  data_repasse_esperada date NOT NULL,
  periodo_apuracao_inicio date,
  periodo_apuracao_fim date,
  -- Decomposição (sign preservado: receitas positivas, custos negativos)
  bruto_venda numeric(14,2) DEFAULT 0,            -- Entrada Financeira impacto=SIM (pgto-app)
  pgto_direto_loja numeric(14,2) DEFAULT 0,       -- Entrada Financeira impacto=NÃO (não vai pro repasse)
  comissao numeric(14,2) DEFAULT 0,
  taxa_transacao numeric(14,2) DEFAULT 0,
  taxa_conveniencia numeric(14,2) DEFAULT 0,
  taxa_entrega_ret numeric(14,2) DEFAULT 0,
  taxa_servico_sob_demanda numeric(14,2) DEFAULT 0,
  taxa_servico_cliente numeric(14,2) DEFAULT 0,   -- retido do cliente, neutro pra loja
  promo_ifood numeric(14,2) DEFAULT 0,            -- POSITIVO (receita devolvida)
  promo_loja numeric(14,2) DEFAULT 0,             -- impacto=NÃO, informativo
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
  liquido_esperado numeric(14,2) DEFAULT 0,        -- = SUM lancamentos com impacto=SIM
  -- Lado bancário (CSV iFood Pago)
  conta_recebido numeric(14,2),                    -- valor da Antecipação semanal correspondente
  conta_data_recebimento date,
  conta_taxa_antecip numeric(14,2),
  liquido_efetivo numeric(14,2),                   -- conta_recebido - conta_taxa_antecip
  conta_movimento_id uuid,
  -- Status
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'matched', 'matched_aprox', 'unmatched', 'sem_repasse')),
  diff numeric(14,2),                              -- liquido_esperado - conta_recebido
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

-- ─── 5. audit_ifood_conta_movimentos (CSV conta iFood Pago, só repasses+taxa)─
CREATE TABLE public.audit_ifood_conta_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  import_id uuid REFERENCES public.audit_imports(id) ON DELETE SET NULL,
  csv_idx int NOT NULL,                     -- ordem original no CSV
  data date NOT NULL,
  descricao text NOT NULL,                   -- 'Antecipação semanal' | 'Taxa de antecipação'
  valor numeric(14,2) NOT NULL,
  categoria_csv text NOT NULL,               -- 'Repasse iFood' | 'Antecipação' (raw do CSV)
  categoria text NOT NULL                    -- 'repasse' | 'taxa_antecip' (normalizado)
    CHECK (categoria IN ('repasse', 'taxa_antecip')),
  match_repasse_ids uuid[] DEFAULT '{}',     -- IDs dos audit_ifood_repasses que esta antec/taxa cobre
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
    -- removido: 'ifood_daily'
  ));
