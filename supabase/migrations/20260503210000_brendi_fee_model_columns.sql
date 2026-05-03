-- Modelo de taxa Brendi declarado: Pix Online = 0,5% + R$0,40/pedido,
-- Crédito Online D+0 = 5,69% (3,99% + 1,7% adiantamento). Antes match-brendi
-- usava 2% flat — gerava diff_pct bizarro (até 162% em dias baixos).
--
-- Adiciona 2 colunas em audit_brendi_daily pra separar bruto vs líquido:
-- - expected_amount continua = bruto (KPI "Vendido")
-- - expected_liquido = bruto - taxa_calculada
-- - taxa_calculada = sum(fee_per_pedido)
-- - diff agora compara received_amount × expected_liquido (próximo de zero
--   exceto pela mensalidade)

ALTER TABLE public.audit_brendi_daily
  ADD COLUMN IF NOT EXISTS expected_liquido numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxa_calculada numeric NOT NULL DEFAULT 0;
