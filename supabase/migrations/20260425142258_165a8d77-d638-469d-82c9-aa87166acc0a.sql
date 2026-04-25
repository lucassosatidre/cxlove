CREATE OR REPLACE FUNCTION public.get_audit_ifood_daily_detail(p_period_id uuid)
RETURNS TABLE(match_date date, vendas_count integer, bruto numeric, liquido numeric, deposito numeric, diferenca numeric, status text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH vendas_dia AS (
    SELECT
      expected_deposit_date AS d,
      COUNT(*)::integer AS vendas_count,
      SUM(gross_amount) AS bruto,
      SUM(net_amount) AS liquido
    FROM public.audit_card_transactions
    WHERE audit_period_id = p_period_id
      AND deposit_group = 'ifood'
      AND is_competencia = true
      AND expected_deposit_date IS NOT NULL
    GROUP BY expected_deposit_date
  ),
  depositos_dia AS (
    SELECT
      deposit_date AS d,
      SUM(amount) AS deposito
    FROM public.audit_bank_deposits
    WHERE audit_period_id = p_period_id
      AND bank = 'cresol'
      AND category = 'ifood'
      AND match_status = 'matched'
    GROUP BY deposit_date
  )
  SELECT
    v.d AS match_date,
    v.vendas_count,
    v.bruto,
    v.liquido,
    COALESCE(d.deposito, 0) AS deposito,
    COALESCE(d.deposito, 0) - v.liquido AS diferenca,
    CASE
      WHEN d.d IS NULL THEN 'missing_deposit'
      WHEN ABS(COALESCE(d.deposito, 0) - v.liquido) < 1 THEN 'matched'
      WHEN ABS(COALESCE(d.deposito, 0) - v.liquido) <= v.liquido * 0.02 THEN 'matched'
      ELSE 'partial'
    END AS status
  FROM vendas_dia v
  LEFT JOIN depositos_dia d ON v.d = d.d
  ORDER BY 1;
$function$;