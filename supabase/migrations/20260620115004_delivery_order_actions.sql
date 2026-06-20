-- Ajustes da Conciliação Delivery (Vigia):
--  - Cancelamento manual de pedido (item 4)
--  - Agrupamento de cartões + parte em dinheiro declarada (item 2)
--  - Migração de pedido do caixa tele para o caixa salão (item 3)

ALTER TABLE public.imported_orders
  ADD COLUMN IF NOT EXISTS is_cancelled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_cash_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS migrated_to_salon boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS migrated_at timestamptz;

-- Index para filtrar rapidamente os pedidos ativos de um fechamento
CREATE INDEX IF NOT EXISTS idx_imported_orders_active
  ON public.imported_orders (daily_closing_id)
  WHERE is_cancelled = false AND migrated_to_salon = false;
