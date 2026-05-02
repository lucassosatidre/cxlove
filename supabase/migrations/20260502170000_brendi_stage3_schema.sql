-- Estágio 3 — Auditoria Brendi (vendas online via canal próprio).
-- Cria 3 tabelas: audit_saipos_orders (canal-agnóstica, futura fonte de verdade
-- pra estágio 4 iFood Marketplace e estágio 5 cartão presencial), audit_brendi_orders
-- (subset online entregue do report Brendi), audit_brendi_daily (match D+1 útil
-- vs depósitos BB Brendi). Mais audit_brendi_daily_overrides pra preenchimento
-- manual em divergências (mensalidade Brendi descontada de algum repasse, cancel
-- pós-fato, etc).
--
-- Reuso: audit_bank_deposits já tem category='brendi' via regex no import-bb.

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_imports.file_type aceita 'saipos' e 'brendi'
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_imports
  DROP CONSTRAINT IF EXISTS audit_imports_file_type_check;

ALTER TABLE public.audit_imports
  ADD CONSTRAINT audit_imports_file_type_check
  CHECK (file_type IN ('maquinona', 'cresol', 'bb', 'ticket', 'alelo', 'pluxee', 'vr', 'saipos', 'brendi'));

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_saipos_orders — canal-agnóstica
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.audit_saipos_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  import_id uuid REFERENCES public.audit_imports(id) ON DELETE SET NULL,
  -- col G "Id do pedido no parceiro" — chave que casa com Brendi.order_id, iFood.order_id, etc
  order_id_parceiro text NOT NULL,
  -- col A "Pedido" (sequencial Saipos local)
  saipos_pedido int,
  -- col H "Número do pedido no parceiro" (ex: 7001 sequencial)
  saipos_pedido_parceiro_num text,
  canal_venda text NOT NULL,             -- 'Brendi' | 'iFood' | 'balcao' | etc
  data_venda timestamptz NOT NULL,
  sale_date date NOT NULL,                -- BRT(data_venda)
  turno text,
  tipo_pedido text,                       -- 'D' delivery | 'B' balcão | etc
  pagamento text NOT NULL,                -- 'Pix Online Brendi' | 'Crédito' | etc
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
CREATE POLICY "Admins manage audit_saipos_orders"
  ON public.audit_saipos_orders FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_brendi_orders — só pedidos online entregues do report Brendi
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.audit_brendi_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  import_id uuid REFERENCES public.audit_imports(id) ON DELETE SET NULL,
  -- col B "Order ID" Brendi — casa com saipos.order_id_parceiro
  order_id text NOT NULL,
  created_at_remote timestamptz NOT NULL,
  sale_date date NOT NULL,                -- BRT(created_at_remote)
  forma_pagamento text NOT NULL,          -- 'Pix Online' | 'Crédito Online'
  payment_method text,                    -- 'PIX' | 'ONLINECREDIT'
  total numeric NOT NULL,                 -- col L (já líquido de cashback)
  taxa_entrega numeric DEFAULT 0,
  desconto_entrega numeric DEFAULT 0,
  cashback_usado numeric DEFAULT 0,       -- col O — informativo, não afeta match
  cliente_nome text,
  cliente_telefone text,
  endereco text,
  cupom boolean DEFAULT false,
  status_remote text,                     -- só 'Entregue' importado, mas guarda pra debug
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_period_id, order_id)
);

CREATE INDEX idx_brendi_orders_period_date ON public.audit_brendi_orders(audit_period_id, sale_date);
CREATE INDEX idx_brendi_orders_forma ON public.audit_brendi_orders(audit_period_id, forma_pagamento);

ALTER TABLE public.audit_brendi_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_brendi_orders"
  ON public.audit_brendi_orders FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_brendi_daily — agregação D+1 útil pra match com PIX BB
-- 1 row por (audit_period_id, expected_credit_date). sale_dates é array dos dias
-- de venda agrupados nesse crédito (sex/sáb/dom → seg = 3 dias num só credit_date).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.audit_brendi_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  expected_credit_date date NOT NULL,
  sale_dates date[] NOT NULL,             -- dias-fonte que rolaram pra esse credit_date
  pedidos_count int NOT NULL DEFAULT 0,
  expected_amount numeric NOT NULL DEFAULT 0,
  received_amount numeric NOT NULL DEFAULT 0,
  bb_deposit_ids uuid[] DEFAULT '{}',     -- depósitos BB pareados
  diff numeric NOT NULL DEFAULT 0,        -- received - expected
  diff_pct numeric NOT NULL DEFAULT 0,    -- |diff| / expected (0 se expected=0)
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
CREATE POLICY "Admins manage audit_brendi_daily"
  ON public.audit_brendi_daily FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_brendi_daily_overrides — preenchimento manual quando |diff_pct| > 5%
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.audit_brendi_daily_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_id uuid NOT NULL REFERENCES public.audit_brendi_daily(id) ON DELETE CASCADE,
  motivo text NOT NULL CHECK (motivo IN ('mensalidade', 'cancelamento_pos_fato', 'estorno', 'outro')),
  valor_ajuste numeric NOT NULL,          -- pode ser positivo ou negativo
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_brendi_daily_overrides_daily ON public.audit_brendi_daily_overrides(daily_id);

ALTER TABLE public.audit_brendi_daily_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage audit_brendi_daily_overrides"
  ON public.audit_brendi_daily_overrides FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Trigger pra atualizar updated_at do daily ao mexer em overrides
CREATE OR REPLACE FUNCTION public.touch_brendi_daily_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.audit_brendi_daily SET updated_at = now() WHERE id = NEW.daily_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_brendi_daily_overrides_touch
  AFTER INSERT OR UPDATE OR DELETE ON public.audit_brendi_daily_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_brendi_daily_updated_at();
