-- Estágio 3 — Auditoria Brendi
ALTER TABLE public.audit_imports DROP CONSTRAINT IF EXISTS audit_imports_file_type_check;
ALTER TABLE public.audit_imports ADD CONSTRAINT audit_imports_file_type_check
  CHECK (file_type IN ('maquinona', 'cresol', 'bb', 'ticket', 'alelo', 'pluxee', 'vr', 'saipos', 'brendi'));

CREATE TABLE public.audit_saipos_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  import_id uuid REFERENCES public.audit_imports(id) ON DELETE SET NULL,
  order_id_parceiro text NOT NULL,
  saipos_pedido int,
  saipos_pedido_parceiro_num text,
  canal_venda text NOT NULL,
  data_venda timestamptz NOT NULL,
  sale_date date NOT NULL,
  turno text,
  tipo_pedido text,
  pagamento text NOT NULL,
  cancelado boolean NOT NULL DEFAULT false,
  motivo_cancelamento text,
  total numeric NOT NULL,
  acrescimo numeric DEFAULT 0,
  motivo_acrescimo text,
  desconto numeric DEFAULT 0,
  motivo_desconto text,
  total_taxa_servico numeric DEFAULT 0,
  consumidor text,
  bairro text,
  cep text,
  itens text,
  entrega numeric,
  valor_entregador numeric,
  entregador text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_period_id, order_id_parceiro)
);
CREATE INDEX idx_saipos_orders_period_canal ON public.audit_saipos_orders(audit_period_id, canal_venda);
CREATE INDEX idx_saipos_orders_sale_date ON public.audit_saipos_orders(audit_period_id, sale_date);
CREATE INDEX idx_saipos_orders_pagamento ON public.audit_saipos_orders(audit_period_id, pagamento);
ALTER TABLE public.audit_saipos_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_saipos_orders" ON public.audit_saipos_orders FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.audit_brendi_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  import_id uuid REFERENCES public.audit_imports(id) ON DELETE SET NULL,
  order_id text NOT NULL,
  created_at_remote timestamptz NOT NULL,
  sale_date date NOT NULL,
  forma_pagamento text NOT NULL,
  payment_method text,
  total numeric NOT NULL,
  taxa_entrega numeric DEFAULT 0,
  desconto_entrega numeric DEFAULT 0,
  cashback_usado numeric DEFAULT 0,
  cliente_nome text,
  cliente_telefone text,
  endereco text,
  cupom boolean DEFAULT false,
  status_remote text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_period_id, order_id)
);
CREATE INDEX idx_brendi_orders_period_date ON public.audit_brendi_orders(audit_period_id, sale_date);
CREATE INDEX idx_brendi_orders_forma ON public.audit_brendi_orders(audit_period_id, forma_pagamento);
ALTER TABLE public.audit_brendi_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_brendi_orders" ON public.audit_brendi_orders FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.audit_brendi_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  expected_credit_date date NOT NULL,
  sale_dates date[] NOT NULL,
  pedidos_count int NOT NULL DEFAULT 0,
  expected_amount numeric NOT NULL DEFAULT 0,
  received_amount numeric NOT NULL DEFAULT 0,
  bb_deposit_ids uuid[] DEFAULT '{}',
  diff numeric NOT NULL DEFAULT 0,
  diff_pct numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('matched', 'pending_manual', 'mensalidade_descontada', 'sem_deposito', 'pending')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_period_id, expected_credit_date)
);
CREATE INDEX idx_brendi_daily_period_date ON public.audit_brendi_daily(audit_period_id, expected_credit_date);
CREATE INDEX idx_brendi_daily_status ON public.audit_brendi_daily(audit_period_id, status);
ALTER TABLE public.audit_brendi_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_brendi_daily" ON public.audit_brendi_daily FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.audit_brendi_daily_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_id uuid NOT NULL REFERENCES public.audit_brendi_daily(id) ON DELETE CASCADE,
  motivo text NOT NULL CHECK (motivo IN ('mensalidade', 'cancelamento_pos_fato', 'estorno', 'outro')),
  valor_ajuste numeric NOT NULL,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_brendi_daily_overrides_daily ON public.audit_brendi_daily_overrides(daily_id);
ALTER TABLE public.audit_brendi_daily_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_brendi_daily_overrides" ON public.audit_brendi_daily_overrides FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.touch_brendi_daily_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  UPDATE public.audit_brendi_daily SET updated_at = now() WHERE id = COALESCE(NEW.daily_id, OLD.daily_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER trg_brendi_daily_overrides_touch
  AFTER INSERT OR UPDATE OR DELETE ON public.audit_brendi_daily_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_brendi_daily_updated_at();