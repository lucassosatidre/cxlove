-- Fix v4: dashboard filtra por DATA (sale_date / deposit_date),
-- não por audit_period_id. Permite cross-period.
-- audit_periods só tem year/month → derivar range a partir desses campos.

CREATE OR REPLACE FUNCTION public.get_audit_period_totals(p_period_id uuid)
RETURNS TABLE (
  total_bruto numeric,
  total_liquido_declarado numeric,
  total_liquido_ifood numeric,
  total_bruto_ifood numeric,
  total_taxa_declarada numeric,
  total_promocao numeric,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH p AS (
    SELECT make_date(year, month, 1) AS d_ini,
           (make_date(year, month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date AS d_fim
    FROM public.audit_periods WHERE id = p_period_id
  )
  SELECT
    COALESCE(SUM(ct.gross_amount), 0)                                            AS total_bruto,
    COALESCE(SUM(ct.net_amount), 0)                                              AS total_liquido_declarado,
    COALESCE(SUM(ct.net_amount)   FILTER (WHERE ct.deposit_group = 'ifood'), 0)  AS total_liquido_ifood,
    COALESCE(SUM(ct.gross_amount) FILTER (WHERE ct.deposit_group = 'ifood'), 0)  AS total_bruto_ifood,
    COALESCE(SUM(ct.tax_amount), 0)                                              AS total_taxa_declarada,
    COALESCE(SUM(ct.promotion_amount), 0)                                        AS total_promocao,
    COUNT(*)                                                                     AS total_count
  FROM public.audit_card_transactions ct, p
  WHERE ct.sale_date BETWEEN p.d_ini AND p.d_fim
    AND ct.is_competencia = true;
$$;

CREATE OR REPLACE FUNCTION public.get_audit_period_deposits(p_period_id uuid)
RETURNS TABLE (
  category text,
  bank text,
  match_status text,
  total_amount numeric,
  deposit_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH p AS (
    SELECT make_date(year, month, 1) AS d_ini,
           (make_date(year, month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date AS d_fim
    FROM public.audit_periods WHERE id = p_period_id
  )
  SELECT
    d.category,
    d.bank,
    d.match_status,
    COALESCE(SUM(d.amount), 0) AS total_amount,
    COUNT(*) AS deposit_count
  FROM public.audit_bank_deposits d, p
  WHERE d.deposit_date BETWEEN p.d_ini AND (p.d_fim + INTERVAL '5 days')::date
  GROUP BY d.category, d.bank, d.match_status;
$$;