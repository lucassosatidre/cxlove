UPDATE audit_voucher_lots
SET total_descontos = ROUND((subtotal_vendas - valor_liquido)::numeric, 2)
WHERE operadora = 'ticket'
  AND ABS(total_descontos - valor_liquido) < 0.01
  AND subtotal_vendas > valor_liquido;