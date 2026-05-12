DELETE FROM public.audit_voucher_lots
WHERE operadora = 'pluxee'
  AND numero_reembolso ~ '^PLUXEE-[0-9]{8}-[0-9]+$'
  AND numero_reembolso NOT LIKE 'PLUXEE-VENDAS-%'
  AND numero_reembolso NOT LIKE 'PLUXEE-PAG-%';