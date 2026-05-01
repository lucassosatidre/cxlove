-- Maquinona tem 2 colunas distintas que estavam sendo confundidas:
-- - "Valor da promocao" (col F resumo, col I detalhe): desconto concedido
--   pelo estabelecimento (cashback pra cliente). É CUSTO da pizzaria.
-- - "Incentivo iFood" (col seguinte): subsidio pago pelo iFood. NÃO é custo
--   da pizzaria.
--
-- Antes: import-maquinona populava promotion_amount com "Incentivo iFood".
-- Agora: promotion_amount = "Valor da promocao", incentivo_ifood = "Incentivo iFood".
--
-- Migra dados existentes assumindo que o que estava em promotion_amount era
-- na verdade incentivo_ifood. Pra obter Valor da promoção corretamente, user
-- precisa reimportar Maquinona.

ALTER TABLE public.audit_card_transactions
  ADD COLUMN IF NOT EXISTS incentivo_ifood numeric(12,2) NOT NULL DEFAULT 0;

-- Move dados existentes pro novo campo (eles eram Incentivo iFood)
UPDATE public.audit_card_transactions
SET incentivo_ifood = COALESCE(promotion_amount, 0),
    promotion_amount = 0
WHERE promotion_amount > 0;
