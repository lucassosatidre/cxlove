ALTER TABLE public.audit_ifood_conta_movimentos
  DROP CONSTRAINT IF EXISTS audit_ifood_conta_movimentos_audit_period_id_csv_idx_descricao_key;

DO $$
DECLARE
  cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.audit_ifood_conta_movimentos'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE '%csv_idx%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.audit_ifood_conta_movimentos DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.audit_ifood_conta_movimentos
  ADD CONSTRAINT audit_ifood_conta_movimentos_period_data_desc_valor_key
    UNIQUE (audit_period_id, data, descricao, valor);