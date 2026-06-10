-- ─── 1. audit_ifood_daily_sales ─────────────────────────────────────────────
-- Bruto VENDIDO no iFood por DATA DA VENDA (data_criacao_pedido_associado) e
-- por loja, agregado pelo import-ifood-extrato-detalhado a partir dos
-- lançamentos de venda (fato_gerador='venda', tipo 'entrada financeira',
-- impacto no repasse = SIM). REGRA DURA da auditoria: competência da venda
-- (sale_date), nunca data do crédito. Reimport é idempotente: a edge deleta
-- os registros do period+loja antes de inserir.
CREATE TABLE public.audit_ifood_daily_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  loja_id_curto text NOT NULL,
  sale_date date NOT NULL,
  bruto_venda numeric(12,2) NOT NULL DEFAULT 0,
  pedidos_count int NOT NULL DEFAULT 0,
  UNIQUE (audit_period_id, loja_id_curto, sale_date)
);

CREATE INDEX idx_ifood_daily_sales_date ON public.audit_ifood_daily_sales (audit_period_id, sale_date);

ALTER TABLE public.audit_ifood_daily_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY ifood_daily_sales_admin_all ON public.audit_ifood_daily_sales
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ─── 2. categoria 'nao_reconhecido' em audit_ifood_conta_movimentos ─────────
-- O import-ifood-conta-csv passou a importar CRÉDITOS (valor>0) de categorias
-- fora do escopo repasse/antecipação (ex: 'Transferência recebida') como
-- categoria='nao_reconhecido' — campo informativo: dinheiro que entrou na
-- conta iFood Pago sem identificação.
ALTER TABLE public.audit_ifood_conta_movimentos
  DROP CONSTRAINT IF EXISTS audit_ifood_conta_movimentos_categoria_check;
ALTER TABLE public.audit_ifood_conta_movimentos
  ADD CONSTRAINT audit_ifood_conta_movimentos_categoria_check
  CHECK (categoria IN ('repasse', 'taxa_antecip', 'nao_reconhecido'));

-- ─── 3. delete_audit_import + caso 'maquinona' ──────────────────────────────
-- Recria a RPC adicionando o branch WHEN 'maquinona'. A tabela
-- audit_card_transactions NÃO tem import_id; deletar pelo audit_period_id do
-- import é correto porque existe exatamente 1 arquivo Maquinona por mês
-- (o checklist mensal de imports só prevê 1 upload Maquinona por período).
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
    WHEN 'maquinona' THEN
      -- Sem import_id na tabela: deleta por período (1 arquivo maquinona/mês).
      DELETE FROM public.audit_card_transactions WHERE audit_period_id = v_import.audit_period_id;
      GET DIAGNOSTICS v_deleted_data = ROW_COUNT;
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
        DELETE FROM public.audit_ifood_daily_sales
         WHERE audit_period_id = v_import.audit_period_id
           AND loja_id_curto = ANY(v_store_ids);
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
