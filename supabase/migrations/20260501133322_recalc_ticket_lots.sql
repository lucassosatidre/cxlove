-- Lotes Ticket importados antes do fallback computacional do parser PDF
-- ficaram com subtotal_vendas=0 e total_descontos=0 (apenas valor_liquido
-- foi preenchido). Recalcula a partir dos lot_items + valor_liquido.
--
-- Idempotente: só atualiza onde os valores estão zerados.

UPDATE public.audit_voucher_lots
SET subtotal_vendas = COALESCE(t.sum_items, subtotal_vendas)
FROM (
  SELECT lot_id, ROUND(SUM(valor)::numeric, 2) AS sum_items
  FROM public.audit_voucher_lot_items
  GROUP BY lot_id
) t
WHERE audit_voucher_lots.id = t.lot_id
  AND audit_voucher_lots.operadora = 'ticket'
  AND (audit_voucher_lots.subtotal_vendas IS NULL OR audit_voucher_lots.subtotal_vendas = 0)
  AND t.sum_items > 0;

UPDATE public.audit_voucher_lots
SET total_descontos = ROUND((subtotal_vendas - valor_liquido)::numeric, 2)
WHERE operadora = 'ticket'
  AND (total_descontos IS NULL OR total_descontos = 0)
  AND subtotal_vendas > 0
  AND valor_liquido > 0
  AND subtotal_vendas > valor_liquido;
