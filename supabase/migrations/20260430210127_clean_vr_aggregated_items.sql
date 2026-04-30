-- VR vai migrar do modelo "1 item agregado por lote" pra "N items reais
-- vindos do extrato_vendas_vr.xls". Antes de o user reimportar, limpa os
-- items agregados pra evitar duplicação.

DELETE FROM public.audit_voucher_lot_items
WHERE numero_cartao_mascarado = 'AGREGADO'
  AND lot_id IN (
    SELECT id FROM public.audit_voucher_lots WHERE operadora = 'vr'
  );
