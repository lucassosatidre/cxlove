-- audit_bank_deposits: permite 'inter' além de 'bb' e 'cresol'
ALTER TABLE public.audit_bank_deposits
  DROP CONSTRAINT IF EXISTS audit_bank_deposits_bank_check;
ALTER TABLE public.audit_bank_deposits
  ADD CONSTRAINT audit_bank_deposits_bank_check
  CHECK (bank IN ('bb', 'cresol', 'inter'));

-- audit_imports: adiciona 'inter' à lista de file_type permitidos
ALTER TABLE public.audit_imports
  DROP CONSTRAINT IF EXISTS audit_imports_file_type_check;
ALTER TABLE public.audit_imports
  ADD CONSTRAINT audit_imports_file_type_check
  CHECK (file_type = ANY (ARRAY[
    'maquinona'::text, 'cresol'::text, 'bb'::text, 'inter'::text,
    'ticket'::text, 'alelo'::text, 'pluxee'::text, 'vr'::text,
    'pluxee_vendas'::text, 'pluxee_pagamentos'::text,
    'saipos'::text, 'brendi'::text,
    'ifood_orders'::text, 'ifood_extrato_detalhado'::text, 'ifood_conta_csv'::text
  ]));