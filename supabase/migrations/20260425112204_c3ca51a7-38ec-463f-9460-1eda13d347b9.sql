-- RPC: agregado por (dia, categoria) para Auditoria do Match
CREATE OR REPLACE FUNCTION public.get_audit_match_breakdown(p_period_id uuid)
RETURNS TABLE (
  sale_date date,
  categoria text,
  total_vendas integer,
  bruto_vendido numeric,
  liquido_vendido numeric,
  taxa_declarada numeric,
  total_depositos integer,
  total_recebido numeric,
  primeira_data_dep date,
  ultima_data_dep date,
  lag_medio_dias numeric,
  taxa_efetiva numeric,
  status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH vendas_por_dia AS (
    SELECT 
      t.sale_date AS v_sale_date,
      CASE 
        WHEN t.payment_method IN ('Credito', 'Debito') THEN 'credito_debito'
        WHEN t.payment_method = 'Pix' THEN 'pix'
        WHEN t.payment_method = 'Voucher' AND UPPER(COALESCE(t.brand,'')) = 'ALELO' THEN 'alelo'
        WHEN t.payment_method = 'Voucher' AND UPPER(COALESCE(t.brand,'')) = 'TICKET' THEN 'ticket'
        WHEN t.payment_method = 'Voucher' AND UPPER(COALESCE(t.brand,'')) IN ('SODEXO','PLUXEE') THEN 'pluxee'
        WHEN t.payment_method = 'Voucher' AND UPPER(COALESCE(t.brand,'')) = 'VR' THEN 'vr'
        ELSE NULL
      END AS cat,
      COUNT(*) AS qtd,
      SUM(t.gross_amount) AS bruto,
      SUM(t.net_amount) AS liq,
      SUM(t.tax_amount) AS taxa,
      MIN(t.expected_deposit_date) AS prev_min,
      MAX(t.expected_deposit_date) AS prev_max
    FROM audit_card_transactions t
    WHERE t.audit_period_id = p_period_id
      AND t.is_competencia = true
    GROUP BY t.sale_date, 2
  ),
  depositos_por_venda AS (
    SELECT 
      v.v_sale_date,
      v.cat,
      COUNT(d.id) AS dep_count,
      COALESCE(SUM(d.amount), 0) AS dep_total,
      MIN(d.deposit_date) AS dep_first,
      MAX(d.deposit_date) AS dep_last,
      AVG(d.deposit_date - v.v_sale_date) AS lag_avg
    FROM vendas_por_dia v
    LEFT JOIN audit_bank_deposits d 
      ON d.audit_period_id = p_period_id
      AND d.match_status = 'matched'
      AND (
        (v.cat IN ('credito_debito', 'pix') 
         AND d.bank = 'cresol' 
         AND d.category = 'ifood'
         AND v.prev_min IS NOT NULL
         AND d.deposit_date BETWEEN v.prev_min AND v.prev_max)
        OR
        (v.cat IN ('alelo', 'ticket', 'pluxee', 'vr')
         AND d.bank = 'bb'
         AND d.category = v.cat)
      )
    GROUP BY v.v_sale_date, v.cat
  )
  SELECT 
    v.v_sale_date,
    v.cat,
    v.qtd::integer,
    v.bruto,
    v.liq,
    v.taxa,
    COALESCE(d.dep_count, 0)::integer,
    COALESCE(d.dep_total, 0),
    d.dep_first,
    d.dep_last,
    d.lag_avg,
    CASE 
      WHEN v.bruto > 0 THEN (v.bruto - COALESCE(d.dep_total, 0)) / v.bruto * 100
      ELSE 0
    END,
    CASE
      WHEN d.dep_count IS NULL OR d.dep_count = 0 THEN 'nao_identificado'
      WHEN ABS(v.bruto - d.dep_total) < 1 THEN 'matched'
      WHEN d.dep_total > v.bruto * 0.5 THEN 'parcial'
      ELSE 'fora_periodo'
    END
  FROM vendas_por_dia v
  LEFT JOIN depositos_por_venda d ON d.v_sale_date = v.v_sale_date AND d.cat = v.cat
  WHERE v.cat IS NOT NULL
  ORDER BY v.v_sale_date, v.cat;
END;
$$;

-- RPC: detalhamento de transações + depósitos por (dia, categoria)
CREATE OR REPLACE FUNCTION public.get_audit_match_detail(
  p_period_id uuid,
  p_sale_date date,
  p_categoria text
)
RETURNS TABLE (
  source text,
  data date,
  hora text,
  valor numeric,
  descricao text,
  doc text,
  match_status text,
  match_reason text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 
    'venda'::text AS source,
    t.sale_date AS data,
    t.sale_time::text AS hora,
    t.gross_amount AS valor,
    (t.payment_method || ' ' || COALESCE(t.brand, ''))::text AS descricao,
    t.transaction_id::text AS doc,
    NULL::text AS match_status,
    NULL::text AS match_reason
  FROM audit_card_transactions t
  WHERE t.audit_period_id = p_period_id
    AND t.sale_date = p_sale_date
    AND t.is_competencia = true
    AND (
      (p_categoria = 'credito_debito' AND t.payment_method IN ('Credito', 'Debito'))
      OR (p_categoria = 'pix' AND t.payment_method = 'Pix')
      OR (p_categoria = 'alelo' AND t.payment_method = 'Voucher' AND UPPER(COALESCE(t.brand,'')) = 'ALELO')
      OR (p_categoria = 'ticket' AND t.payment_method = 'Voucher' AND UPPER(COALESCE(t.brand,'')) = 'TICKET')
      OR (p_categoria = 'pluxee' AND t.payment_method = 'Voucher' AND UPPER(COALESCE(t.brand,'')) IN ('SODEXO','PLUXEE'))
      OR (p_categoria = 'vr' AND t.payment_method = 'Voucher' AND UPPER(COALESCE(t.brand,'')) = 'VR')
    )

  UNION ALL

  SELECT 
    'deposito'::text AS source,
    d.deposit_date AS data,
    NULL::text AS hora,
    d.amount AS valor,
    d.description::text AS descricao,
    d.doc_number::text AS doc,
    d.match_status,
    d.match_reason
  FROM audit_bank_deposits d
  WHERE d.audit_period_id = p_period_id
    AND d.match_status = 'matched'
    AND (
      (p_categoria IN ('credito_debito', 'pix') 
       AND d.bank = 'cresol' 
       AND d.category = 'ifood'
       AND d.deposit_date BETWEEN p_sale_date AND p_sale_date + INTERVAL '5 days')
      OR (p_categoria IN ('alelo', 'ticket', 'pluxee', 'vr')
          AND d.bank = 'bb'
          AND d.category = p_categoria
          AND d.deposit_date BETWEEN p_sale_date AND p_sale_date + INTERVAL '45 days')
    )
  ORDER BY data NULLS LAST, hora NULLS LAST;
$$;