CREATE OR REPLACE FUNCTION public.cashflow_upcoming_bills_daily(
  p_start date DEFAULT CURRENT_DATE,
  p_days  int  DEFAULT 30
)
RETURNS TABLE(date date, total numeric, n bigint, items jsonb)
LANGUAGE sql
STABLE
AS $$
  WITH days AS (
    SELECT generate_series(p_start, p_start + (GREATEST(p_days, 1) - 1), interval '1 day')::date AS dia
  )
  SELECT
    d.dia AS date,
    COALESCE(SUM(ABS(s.amount)), 0) AS total,
    COALESCE(COUNT(s.id), 0) AS n,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'categoria', COALESCE(NULLIF(TRIM(s.category), ''), 'Sem categoria'),
          'fornecedor', s.fornecedor,
          'valor', ABS(s.amount)
        )
        ORDER BY ABS(s.amount) DESC
      ) FILTER (WHERE s.id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM days d
  LEFT JOIN public.cashflow_saipos s
    ON s.vencimento = d.dia
   AND s.paid = false
   AND s.amount < 0
   AND COALESCE(s.is_frente_caixa, false) = false
  GROUP BY d.dia
  ORDER BY d.dia;
$$;
GRANT EXECUTE ON FUNCTION public.cashflow_upcoming_bills_daily(date, int) TO anon, authenticated;