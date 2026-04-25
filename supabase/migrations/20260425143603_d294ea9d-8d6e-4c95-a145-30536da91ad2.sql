CREATE OR REPLACE FUNCTION public.get_audit_ifood_daily_detail(p_period_id uuid)
RETURNS TABLE(match_date date, vendas_count integer, bruto numeric, liquido numeric, deposito numeric, diferenca numeric, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH vendas_dia AS (
    SELECT
      sale_date AS d,
      expected_deposit_date AS exp_d,
      COUNT(*)::integer AS vendas_count,
      SUM(gross_amount) AS bruto,
      SUM(net_amount) AS liquido
    FROM public.audit_card_transactions
    WHERE audit_period_id = p_period_id
      AND deposit_group = 'ifood'
      AND is_competencia = true
    GROUP BY sale_date, expected_deposit_date
  ),
  -- Depósitos agrupados por data
  depositos_por_data AS (
    SELECT
      deposit_date AS d,
      SUM(amount) AS total
    FROM public.audit_bank_deposits
    WHERE audit_period_id = p_period_id
      AND bank = 'cresol'
      AND category = 'ifood'
      AND match_status = 'matched'
    GROUP BY deposit_date
  ),
  -- Liquido total esperado por data prevista (para ratear)
  liquido_por_exp_date AS (
    SELECT exp_d, SUM(liquido) AS liquido_total
    FROM vendas_dia
    GROUP BY exp_d
  ),
  -- Rateia depósito do dia D entre todas as datas de venda que esperavam receber em D
  vendas_com_deposito AS (
    SELECT
      v.d,
      v.exp_d,
      v.vendas_count,
      v.bruto,
      v.liquido,
      CASE 
        WHEN dp.total IS NULL THEN 0
        WHEN lpe.liquido_total > 0 THEN dp.total * (v.liquido / lpe.liquido_total)
        ELSE 0
      END AS deposito_rateado
    FROM vendas_dia v
    LEFT JOIN depositos_por_data dp ON dp.d = v.exp_d
    LEFT JOIN liquido_por_exp_date lpe ON lpe.exp_d = v.exp_d
  )
  SELECT
    d AS match_date,
    vendas_count,
    bruto,
    liquido,
    deposito_rateado AS deposito,
    deposito_rateado - liquido AS diferenca,
    CASE
      WHEN deposito_rateado = 0 THEN 'missing_deposit'
      WHEN ABS(deposito_rateado - liquido) < 1 THEN 'matched'
      WHEN ABS(deposito_rateado - liquido) <= liquido * 0.02 THEN 'matched'
      ELSE 'partial'
    END AS status
  FROM vendas_com_deposito
  ORDER BY d;
$$;