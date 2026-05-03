-- Estágio 4 — Auditoria iFood Marketplace (vendas online via iFood).
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

CREATE TABLE public.audit_ifood_marketplace_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  import_id uuid REFERENCES public.audit_imports(id) ON DELETE SET NULL,
  order_id text NOT NULL,
  short_order_id text,
  data_pedido timestamptz NOT NULL,
  sale_date date NOT NULL,
  turno text,
  status_pedido text NOT NULL,
  valor_itens numeric DEFAULT 0,
  total_pago_cliente numeric NOT NULL,
  taxa_entrega_cliente numeric DEFAULT 0,
  incentivo_ifood numeric DEFAULT 0,
  incentivo_loja numeric DEFAULT 0,
  incentivo_rede numeric DEFAULT 0,
  taxa_servico numeric DEFAULT 0,
  taxas_comissoes numeric DEFAULT 0,
  valor_liquido numeric NOT NULL,
  forma_pagamento text,
  tipo_entrega text,
  produto_logistico text,
  canal_venda text,
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

CREATE TABLE public.audit_ifood_marketplace_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  sale_date date NOT NULL,
  expected_credit_date date,
  pedidos_count int DEFAULT 0,
  bruto_calc numeric DEFAULT 0,
  liquido_calc numeric DEFAULT 0,
  ifood_declarado_vendas int,
  ifood_declarado_bruto numeric,
  ifood_declarado_taxa numeric,
  ifood_declarado_liq_esperado numeric,
  ifood_declarado_depositado numeric,
  ifood_declarado_diferenca numeric,
  ifood_declarado_status text,
  cresol_received numeric DEFAULT 0,
  cresol_deposit_ids uuid[] DEFAULT '{}',
  diff numeric DEFAULT 0,
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
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.audit_ifood_marketplace_daily
    SET updated_at = now() WHERE id = NEW.daily_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ifood_mkt_daily_overrides_touch
  AFTER INSERT OR UPDATE OR DELETE ON public.audit_ifood_marketplace_daily_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_ifood_mkt_daily_updated_at();