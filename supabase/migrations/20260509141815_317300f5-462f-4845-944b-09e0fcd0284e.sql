CREATE OR REPLACE FUNCTION public.delete_audit_import(p_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_import       public.audit_imports%ROWTYPE;
  v_deleted_data integer := 0;
  v_store_ids    text[];
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Acesso negado: apenas admins podem apagar importações.';
  END IF;

  SELECT * INTO v_import FROM public.audit_imports WHERE id = p_import_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Importação % não encontrada.', p_import_id; END IF;

  CASE v_import.file_type
    WHEN 'cresol', 'bb' THEN
      DELETE FROM public.audit_bank_deposits WHERE import_id = p_import_id;
      GET DIAGNOSTICS v_deleted_data = ROW_COUNT;
    WHEN 'ticket', 'alelo', 'pluxee', 'vr' THEN
      DELETE FROM public.audit_voucher_lots WHERE import_id = p_import_id;
      GET DIAGNOSTICS v_deleted_data = ROW_COUNT;
    WHEN 'brendi' THEN
      DELETE FROM public.audit_brendi_orders WHERE import_id = p_import_id;
      GET DIAGNOSTICS v_deleted_data = ROW_COUNT;
    WHEN 'saipos' THEN
      DELETE FROM public.audit_saipos_orders WHERE import_id = p_import_id;
      GET DIAGNOSTICS v_deleted_data = ROW_COUNT;
    WHEN 'ifood_orders' THEN
      DELETE FROM public.audit_ifood_orders WHERE import_id = p_import_id;
      GET DIAGNOSTICS v_deleted_data = ROW_COUNT;
    WHEN 'ifood_conta_csv' THEN
      DELETE FROM public.audit_ifood_conta_movimentos WHERE import_id = p_import_id;
      GET DIAGNOSTICS v_deleted_data = ROW_COUNT;
    WHEN 'ifood_extrato_detalhado' THEN
      SELECT ARRAY_AGG(DISTINCT store_id_curto) INTO v_store_ids
        FROM public.audit_ifood_lancamentos WHERE import_id = p_import_id;
      DELETE FROM public.audit_ifood_lancamentos WHERE import_id = p_import_id;
      GET DIAGNOSTICS v_deleted_data = ROW_COUNT;
      IF v_store_ids IS NOT NULL AND array_length(v_store_ids, 1) > 0 THEN
        DELETE FROM public.audit_ifood_repasses
         WHERE audit_period_id = v_import.audit_period_id
           AND store_id_curto = ANY(v_store_ids);
      END IF;
    ELSE v_deleted_data := 0;
  END CASE;

  DELETE FROM public.audit_imports WHERE id = p_import_id;

  RETURN jsonb_build_object(
    'file_type', v_import.file_type,
    'file_name', v_import.file_name,
    'deleted_data_rows', v_deleted_data
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_audit_import(uuid) TO authenticated;