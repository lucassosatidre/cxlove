-- =============================================================================
-- Sofia — recebimento estruturado de pedidos por telefone + impressão cozinha
-- =============================================================================
-- Pedido da Sofia deixa de ser texto solto (sofia_calls.extracted_data) e passa
-- a ser um pedido estruturado (itens com sabores/fração/borda) controlado pelo
-- Caixa Love. Origem: tool finalizar_pedido OU extrator LLM pós-chamada.
-- Fluxo: pendente_conferencia -> (auto OU clique) -> pendente_impressao ->
--        helper da cozinha imprime comanda + etiquetas -> impresso.

-- -----------------------------------------------------------------------------
-- 1. Numeração diária (sequência por dia, atômica)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sofia_order_counter (
  dia    date PRIMARY KEY DEFAULT current_date,
  ultimo integer NOT NULL DEFAULT 0
);
ALTER TABLE public.sofia_order_counter ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.sofia_next_numero()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  novo integer;
BEGIN
  INSERT INTO public.sofia_order_counter (dia, ultimo)
  VALUES (current_date, 1)
  ON CONFLICT (dia) DO UPDATE
    SET ultimo = sofia_order_counter.ultimo + 1
  RETURNING ultimo INTO novo;
  RETURN novo;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Pedidos da Sofia
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sofia_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  sofia_call_id   text,                       -- liga em sofia_calls.sofia_call_id (pode ser nulo)
  numero          integer NOT NULL,           -- sequencial do dia (#0001 na etiqueta)
  dia             date NOT NULL DEFAULT current_date,
  origem          text NOT NULL DEFAULT 'sofia',  -- 'sofia' | 'manual'

  -- Cliente / entrega
  nome_cliente    text,
  telefone        text,
  tipo            text NOT NULL DEFAULT 'entrega'
                    CHECK (tipo IN ('entrega', 'retirada')),
  endereco        text,
  bairro          text,
  complemento     text,
  referencia      text,

  -- Valores
  taxa_entrega    numeric(10,2) NOT NULL DEFAULT 0,
  subtotal        numeric(10,2) NOT NULL DEFAULT 0,
  total           numeric(10,2) NOT NULL DEFAULT 0,

  -- Pagamento
  forma_pagamento text,                       -- 'dinheiro' | 'maquininha' | 'pix' | 'pago' | null
  troco_para      numeric(10,2),              -- quanto o cliente vai pagar em dinheiro (calcula troco)

  observacoes     text,

  -- Itens estruturados. Cada item:
  -- { tipo:'pizza'|'bebida'|'outro', nome, qtd, tamanho?, categoria:'salgada'|'doce'?,
  --   sabores:[{fracao,nome}], borda?, valor, obs? }  (combos já vêm expandidos em pizzas)
  itens           jsonb NOT NULL DEFAULT '[]'::jsonb,

  status          text NOT NULL DEFAULT 'pendente_conferencia'
                    CHECK (status IN ('pendente_conferencia','pendente_impressao','impresso','cancelado')),
  impresso_em     timestamptz,
  conferido_por   uuid,                        -- auth.uid de quem mandou imprimir
  raw             jsonb                        -- payload bruto da captura (debug)
);

ALTER TABLE public.sofia_orders ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS sofia_orders_status_idx  ON public.sofia_orders (status);
CREATE INDEX IF NOT EXISTS sofia_orders_dia_idx     ON public.sofia_orders (dia DESC, numero DESC);
CREATE INDEX IF NOT EXISTS sofia_orders_call_idx    ON public.sofia_orders (sofia_call_id);

-- -----------------------------------------------------------------------------
-- 3. Configurações da Sofia (toggle modo automático etc) — single-row por slug
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sofia_settings (
  slug        text PRIMARY KEY,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sofia_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.sofia_settings (slug, data)
VALUES ('caixa', '{"auto_print": false}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. RLS — admins gerenciam tudo (edges usam service role e ignoram RLS)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins manage sofia_orders" ON public.sofia_orders;
CREATE POLICY "Admins manage sofia_orders"
  ON public.sofia_orders FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage sofia_settings" ON public.sofia_settings;
CREATE POLICY "Admins manage sofia_settings"
  ON public.sofia_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins read sofia_order_counter" ON public.sofia_order_counter;
CREATE POLICY "Admins read sofia_order_counter"
  ON public.sofia_order_counter FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- -----------------------------------------------------------------------------
-- 5. Triggers de updated_at
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS sofia_orders_updated_at ON public.sofia_orders;
CREATE TRIGGER sofia_orders_updated_at
  BEFORE UPDATE ON public.sofia_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS sofia_settings_updated_at ON public.sofia_settings;
CREATE TRIGGER sofia_settings_updated_at
  BEFORE UPDATE ON public.sofia_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. Realtime (a tela Caixa atualiza sozinha quando chega pedido novo)
-- -----------------------------------------------------------------------------
ALTER TABLE public.sofia_orders REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sofia_orders;
