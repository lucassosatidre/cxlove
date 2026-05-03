-- Estágio 4 — Auditoria iFood Marketplace (vendas online via iFood).
-- Reusa audit_saipos_orders (canal_venda='iFood') como cross-check.
-- Cria 3 tabelas espelhando o estágio 3 Brendi: orders + daily + overrides.
--
-- Diferenças vs Brendi:
-- - Crédito não é D+1 útil simples — iFood credita diariamente em Cresol
--   (não BB), valores múltiplos por dia (PIX em batches: vendas + entregas + ajustes).
-- - iFood já fornece um CSV "Auditoria" pré-conciliado por dia
--   (Vendas/Bruto/Taxa/Liq Esperado/Depositado/Diferença). Mantemos esse
--   campo como `ifood_declarado_*` no daily, separado do cálculo derivado
--   de audit_ifood_marketplace_orders.
-- - Saipos pagamento iFood = "(PAGO) Online Ifood" (substring), não exact match.

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_imports.file_type aceita 'ifood_orders' (Relatório Pedidos) e
-- 'ifood_daily' (Auditoria CSV per-dia)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_imports
  DROP CONSTRAINT IF EXISTS audit_imports_file_type_check;

ALTER TABLE public.audit_imports
  ADD CONSTRAINT audit_imports_file_type_check
  CHECK (file_type IN (
    'maquinona', 'cresol', 'bb',
    'ticket', 'alelo', 'pluxee', 'vr',
    'saipos', 'brendi',
    'ifood_orders', 'ifood_daily'
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_ifood_marketplace_orders — per-pedido do Relatório Pedidos iFood
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.audit_ifood_marketplace_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  import_id uuid REFERENCES public.audit_imports(id) ON DELETE SET NULL,
  -- col A "ID COMPLETO DO PEDIDO" (UUID) = Saipos.order_id_parceiro pra canal iFood
  order_id text NOT NULL,
  -- col F "ID CURTO DO PEDIDO" (sequencial 1001-format)
  short_order_id text,
  data_pedido timestamptz NOT NULL,
  sale_date date NOT NULL,                  -- BRT(data_pedido)
  turno text,                                -- col E
  status_pedido text NOT NULL,               -- col G: 'CONCLUIDO' | 'CANCELADO' | etc
  valor_itens numeric DEFAULT 0,             -- col H
  total_pago_cliente numeric NOT NULL,       -- col I (bruto)
  taxa_entrega_cliente numeric DEFAULT 0,    -- col J
  incentivo_ifood numeric DEFAULT 0,         -- col K
  incentivo_loja numeric DEFAULT 0,          -- col L
  incentivo_rede numeric DEFAULT 0,          -- col M
  taxa_servico numeric DEFAULT 0,            -- col N
  taxas_comissoes numeric DEFAULT 0,         -- col O (negativo = dedução iFood)
  valor_liquido numeric NOT NULL,            -- col P (líquido pra loja)
  forma_pagamento text,                      -- col Q
  tipo_entrega text,                         -- col R
  produto_logistico text,                    -- col S
  canal_venda text,                          -- col T (em geral 'iFood')
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_period_id, order_id)
);

CREATE INDEX idx_ifood_mkt_orders_period_date
  ON public.audit_ifood_marketplace_orders(audit_period_id, sale_date);
CREATE INDEX idx_ifood_mkt_orders_status
  ON public.audit_ifood_marketplace_orders(audit_period_id, status_pedido);

ALTER TABLE public.audit_ifood_marketplace_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_ifood_marketplace_orders"
  ON public.audit_ifood_marketplace_orders FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_ifood_marketplace_daily — agregação por sale_date pra match com
-- depósitos Cresol (bank='cresol', category='ifood'). Pode ser populada pelo
-- match a partir de audit_ifood_marketplace_orders, ou diretamente pelo CSV
-- de Auditoria iFood (campos ifood_declarado_*).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.audit_ifood_marketplace_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  sale_date date NOT NULL,                   -- dia da venda (não credit_date — iFood credita D+0/D+1 variável)
  expected_credit_date date,                  -- estimativa (próximo dia útil)
  -- Lado calculado: agregação dos audit_ifood_marketplace_orders
  pedidos_count int DEFAULT 0,
  bruto_calc numeric DEFAULT 0,               -- sum(total_pago_cliente)
  liquido_calc numeric DEFAULT 0,             -- sum(valor_liquido)
  -- Lado declarado pelo iFood (do CSV Auditoria, opcional)
  ifood_declarado_vendas int,
  ifood_declarado_bruto numeric,
  ifood_declarado_taxa numeric,
  ifood_declarado_liq_esperado numeric,
  ifood_declarado_depositado numeric,
  ifood_declarado_diferenca numeric,
  ifood_declarado_status text,                -- 'matched' | etc, vindo do CSV
  -- Lado bancário (Cresol)
  cresol_received numeric DEFAULT 0,
  cresol_deposit_ids uuid[] DEFAULT '{}',
  -- Status final do match
  diff numeric DEFAULT 0,                     -- cresol_received - liquido_calc (ou - ifood_declarado_liq_esperado)
  diff_pct numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('matched', 'pending_manual', 'sem_deposito', 'pending')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_period_id, sale_date)
);

CREATE INDEX idx_ifood_mkt_daily_period_date
  ON public.audit_ifood_marketplace_daily(audit_period_id, sale_date);
CREATE INDEX idx_ifood_mkt_daily_status
  ON public.audit_ifood_marketplace_daily(audit_period_id, status);

ALTER TABLE public.audit_ifood_marketplace_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_ifood_marketplace_daily"
  ON public.audit_ifood_marketplace_daily FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_ifood_marketplace_daily_overrides — preenchimento manual quando
-- diff_pct excede o threshold ou quando há ajustes específicos do iFood
-- (refunds, repasse adicional, taxa de antecipação variável, etc).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.audit_ifood_marketplace_daily_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_id uuid NOT NULL REFERENCES public.audit_ifood_marketplace_daily(id) ON DELETE CASCADE,
  motivo text NOT NULL CHECK (motivo IN (
    'antecipacao', 'refund', 'cancelamento_pos_fato', 'estorno', 'taxa_extra', 'outro'
  )),
  valor_ajuste numeric NOT NULL,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ifood_mkt_daily_overrides_daily
  ON public.audit_ifood_marketplace_daily_overrides(daily_id);

ALTER TABLE public.audit_ifood_marketplace_daily_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_ifood_marketplace_daily_overrides"
  ON public.audit_ifood_marketplace_daily_overrides FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.touch_ifood_mkt_daily_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.audit_ifood_marketplace_daily
    SET updated_at = now() WHERE id = NEW.daily_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ifood_mkt_daily_overrides_touch
  AFTER INSERT OR UPDATE OR DELETE ON public.audit_ifood_marketplace_daily_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_ifood_mkt_daily_updated_at();
