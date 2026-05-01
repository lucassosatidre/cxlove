-- 20260501133322_recalc_ticket_lots.sql
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

-- 20260501133323_add_incentivo_ifood_column.sql
ALTER TABLE public.audit_card_transactions
  ADD COLUMN IF NOT EXISTS incentivo_ifood numeric(12,2) NOT NULL DEFAULT 0;

UPDATE public.audit_card_transactions
SET incentivo_ifood = COALESCE(promotion_amount, 0),
    promotion_amount = 0
WHERE promotion_amount > 0;