ALTER TABLE public.audit_imports DROP CONSTRAINT IF EXISTS audit_imports_file_type_check;

ALTER TABLE public.audit_imports
  ADD CONSTRAINT audit_imports_file_type_check
  CHECK (file_type = ANY (ARRAY[
    'maquinona'::text, 'cresol'::text, 'bb'::text,
    'ticket'::text, 'alelo'::text, 'pluxee'::text, 'vr'::text,
    'pluxee_vendas'::text, 'pluxee_pagamentos'::text,
    'saipos'::text, 'brendi'::text,
    'ifood_orders'::text, 'ifood_extrato_detalhado'::text, 'ifood_conta_csv'::text
  ]));