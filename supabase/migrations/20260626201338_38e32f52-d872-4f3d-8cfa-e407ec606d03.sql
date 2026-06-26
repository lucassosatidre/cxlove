
CREATE OR REPLACE FUNCTION public.cashflow_monthly_summary()
RETURNS TABLE(
  ano int, mes int, account_id uuid, account_name text, company text,
  entradas numeric, saidas numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    EXTRACT(YEAR FROM t.tx_date)::int AS ano,
    EXTRACT(MONTH FROM t.tx_date)::int AS mes,
    a.id AS account_id,
    a.name AS account_name,
    a.company,
    COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0) AS entradas,
    COALESCE(SUM(t.amount) FILTER (WHERE t.amount < 0), 0) AS saidas
  FROM public.cashflow_transactions t
  JOIN public.cashflow_accounts a ON a.id = t.account_id
  WHERE COALESCE(t.is_internal_transfer, false) = false
  GROUP BY 1,2,3,4,5
  ORDER BY 1,2,5,4;
$$;

GRANT EXECUTE ON FUNCTION public.cashflow_monthly_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cashflow_category_summary(p_start date, p_end date)
RETURNS TABLE(
  company text, category text, total numeric, n bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    s.company,
    COALESCE(NULLIF(TRIM(s.category), ''), 'Sem categoria') AS category,
    COALESCE(SUM(s.amount), 0) AS total,
    COUNT(*) AS n
  FROM public.cashflow_saipos s
  WHERE s.amount < 0
    AND COALESCE(s.is_frente_caixa, false) = false
    AND COALESCE(s.pagamento, s.vencimento) BETWEEN p_start AND p_end
  GROUP BY 1,2
  ORDER BY 3 ASC;
$$;

GRANT EXECUTE ON FUNCTION public.cashflow_category_summary(date, date) TO authenticated, service_role;
