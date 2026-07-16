
-- ============ 1) saipos_fin_overrides ============
CREATE TABLE public.saipos_fin_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_store_fin_transaction bigint NOT NULL UNIQUE,
  emissao date,
  vencimento date,
  pagamento date,
  paid boolean,
  amount numeric,
  category text,
  payment_method text,
  conta text,
  fornecedor text,
  descricao text,
  hidden boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saipos_fin_overrides TO authenticated;
GRANT ALL ON public.saipos_fin_overrides TO service_role;
ALTER TABLE public.saipos_fin_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated full access saipos_fin_overrides"
  ON public.saipos_fin_overrides FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ============ 2) cashflow_launches ============
CREATE TABLE public.cashflow_launches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emissao date NOT NULL,
  vencimento date,
  pagamento date,
  paid boolean NOT NULL DEFAULT false,
  amount numeric NOT NULL,
  category text,
  payment_method text,
  conta text,
  fornecedor text,
  cnpj text,
  numero_nota text,
  descricao text,
  source text NOT NULL DEFAULT 'manual',
  nfe_access_key text,
  nfe_dup text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX cashflow_launches_nfe_unique
  ON public.cashflow_launches (nfe_access_key, nfe_dup)
  WHERE source = 'nfe';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashflow_launches TO authenticated;
GRANT ALL ON public.cashflow_launches TO service_role;
ALTER TABLE public.cashflow_launches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated full access cashflow_launches"
  ON public.cashflow_launches FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_cashflow_launches_updated_at
  BEFORE UPDATE ON public.cashflow_launches
  FOR EACH ROW EXECUTE FUNCTION public.update_audit_periods_updated_at();

CREATE TRIGGER trg_saipos_fin_overrides_updated_at
  BEFORE UPDATE ON public.saipos_fin_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_audit_periods_updated_at();

-- ============ 3) Funções de normalização ============
CREATE OR REPLACE FUNCTION public.fin_metodo_norm(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN txt ILIKE '%tarifa%' THEN 'Tarifas Bancárias'
    WHEN txt ILIKE '%pix%' THEN 'Pix'
    WHEN txt ILIKE '%cartão de crédito%' OR txt ILIKE '%cartao de credito%' THEN 'Cartão de Crédito'
    WHEN txt ILIKE '%boleto%' THEN 'Boleto'
    WHEN txt ILIKE '%dinheiro%' THEN 'Dinheiro'
    WHEN txt ILIKE '%débito automat%' OR txt ILIKE '%debito automat%' THEN 'Débito Automático'
    WHEN txt ILIKE '%transfer%' THEN 'Transferência'
    ELSE COALESCE(NULLIF(TRIM(txt), ''), 'Outros')
  END
$$;

CREATE OR REPLACE FUNCTION public.fin_banco_norm(txt text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN txt ILIKE '%banco do brasil%' THEN 'Banco do Brasil'
    WHEN txt ILIKE '%cresol%' THEN 'Cresol'
    WHEN txt ILIKE '%c6%' THEN 'C6'
    WHEN txt ILIKE '%ifood%' THEN 'iFood'
    WHEN txt ILIKE '%sicredi%' THEN 'Sicredi'
    WHEN txt ILIKE '%inter%' THEN 'Inter'
    WHEN txt ILIKE '%dinheiro%' THEN 'Dinheiro'
    ELSE NULL
  END
$$;

-- ============ 4) View unificada ============
CREATE OR REPLACE VIEW public.cashflow_lancamentos AS
WITH saipos AS (
  SELECT
    'saipos'::text AS fonte,
    s.id_store_fin_transaction::text AS ref_id,
    COALESCE(ov.emissao,    s.issuance_date) AS emissao,
    COALESCE(ov.vencimento, s.date)          AS vencimento,
    COALESCE(ov.pagamento,  s.payment_date)  AS pagamento,
    COALESCE(ov.paid, (s.paid = 'Y'))        AS paid,
    COALESCE(ov.amount, s.amount)            AS amount,
    COALESCE(ov.category, s.desc_store_category_financial) AS categoria,
    public.fin_metodo_norm(COALESCE(ov.payment_method, s.desc_store_payment_method)) AS metodo,
    COALESCE(ov.conta, public.fin_banco_norm(s.desc_store_payment_method))           AS banco,
    COALESCE(ov.fornecedor, s.provider_trade_name) AS fornecedor,
    COALESCE(ov.descricao,  s.desc_store_fin_transaction) AS descricao,
    NULL::text AS numero_nota
  FROM public.saipos_fin_effective s
  LEFT JOIN public.saipos_fin_overrides ov
    ON ov.id_store_fin_transaction = s.id_store_fin_transaction
  WHERE COALESCE(ov.hidden, false) = false
),
launches AS (
  SELECT
    CASE WHEN l.source = 'nfe' THEN 'nfe' ELSE 'manual' END::text AS fonte,
    l.id::text AS ref_id,
    l.emissao,
    l.vencimento,
    l.pagamento,
    l.paid,
    l.amount,
    l.category AS categoria,
    public.fin_metodo_norm(l.payment_method) AS metodo,
    COALESCE(l.conta, public.fin_banco_norm(l.payment_method)) AS banco,
    l.fornecedor,
    l.descricao,
    l.numero_nota
  FROM public.cashflow_launches l
)
SELECT
  fonte, ref_id, emissao, vencimento, pagamento, paid, amount,
  categoria, metodo, banco, fornecedor, descricao, numero_nota,
  CASE WHEN COALESCE(amount, 0) < 0 THEN 'saida' ELSE 'entrada' END::text AS tipo,
  date_trunc('month', emissao)::date AS competencia_mes
FROM saipos
UNION ALL
SELECT
  fonte, ref_id, emissao, vencimento, pagamento, paid, amount,
  categoria, metodo, banco, fornecedor, descricao, numero_nota,
  CASE WHEN COALESCE(amount, 0) < 0 THEN 'saida' ELSE 'entrada' END::text AS tipo,
  date_trunc('month', emissao)::date AS competencia_mes
FROM launches;

GRANT SELECT ON public.cashflow_lancamentos TO authenticated;
GRANT SELECT ON public.cashflow_lancamentos TO service_role;

-- ============ 5) RPC fin_upsert_override ============
CREATE OR REPLACE FUNCTION public.fin_upsert_override(p_id_store bigint, p_patch jsonb)
RETURNS public.saipos_fin_overrides
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.saipos_fin_overrides;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  INSERT INTO public.saipos_fin_overrides (
    id_store_fin_transaction,
    emissao, vencimento, pagamento, paid, amount,
    category, payment_method, conta, fornecedor, descricao, hidden,
    updated_at, updated_by
  )
  VALUES (
    p_id_store,
    NULLIF(p_patch->>'emissao','')::date,
    NULLIF(p_patch->>'vencimento','')::date,
    NULLIF(p_patch->>'pagamento','')::date,
    CASE WHEN p_patch ? 'paid'   THEN (p_patch->>'paid')::boolean   ELSE NULL END,
    CASE WHEN p_patch ? 'amount' THEN (p_patch->>'amount')::numeric ELSE NULL END,
    p_patch->>'category',
    p_patch->>'payment_method',
    p_patch->>'conta',
    p_patch->>'fornecedor',
    p_patch->>'descricao',
    COALESCE((p_patch->>'hidden')::boolean, false),
    now(), auth.uid()
  )
  ON CONFLICT (id_store_fin_transaction) DO UPDATE SET
    emissao        = CASE WHEN p_patch ? 'emissao'        THEN NULLIF(p_patch->>'emissao','')::date        ELSE public.saipos_fin_overrides.emissao END,
    vencimento     = CASE WHEN p_patch ? 'vencimento'     THEN NULLIF(p_patch->>'vencimento','')::date     ELSE public.saipos_fin_overrides.vencimento END,
    pagamento      = CASE WHEN p_patch ? 'pagamento'      THEN NULLIF(p_patch->>'pagamento','')::date      ELSE public.saipos_fin_overrides.pagamento END,
    paid           = CASE WHEN p_patch ? 'paid'           THEN (p_patch->>'paid')::boolean                 ELSE public.saipos_fin_overrides.paid END,
    amount         = CASE WHEN p_patch ? 'amount'         THEN (p_patch->>'amount')::numeric               ELSE public.saipos_fin_overrides.amount END,
    category       = CASE WHEN p_patch ? 'category'       THEN p_patch->>'category'                        ELSE public.saipos_fin_overrides.category END,
    payment_method = CASE WHEN p_patch ? 'payment_method' THEN p_patch->>'payment_method'                  ELSE public.saipos_fin_overrides.payment_method END,
    conta          = CASE WHEN p_patch ? 'conta'          THEN p_patch->>'conta'                           ELSE public.saipos_fin_overrides.conta END,
    fornecedor     = CASE WHEN p_patch ? 'fornecedor'     THEN p_patch->>'fornecedor'                      ELSE public.saipos_fin_overrides.fornecedor END,
    descricao      = CASE WHEN p_patch ? 'descricao'      THEN p_patch->>'descricao'                       ELSE public.saipos_fin_overrides.descricao END,
    hidden         = CASE WHEN p_patch ? 'hidden'         THEN (p_patch->>'hidden')::boolean               ELSE public.saipos_fin_overrides.hidden END,
    updated_at     = now(),
    updated_by     = auth.uid()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fin_upsert_override(bigint, jsonb) TO authenticated;
