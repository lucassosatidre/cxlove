
DROP FUNCTION IF EXISTS public.get_audit_period_totals(uuid);

CREATE FUNCTION public.get_audit_period_totals(p_period_id uuid)
RETURNS TABLE(
  total_bruto numeric,
  total_liquido_declarado numeric,
  total_liquido_ifood numeric,
  total_bruto_ifood numeric,
  total_taxa_declarada numeric,
  total_promocao numeric,
  total_promocao_ifood numeric,
  total_incentivo_ifood numeric,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH p AS (
    SELECT id, make_date(year, month, 1) AS d_ini,
           (make_date(year, month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date AS d_fim
    FROM public.audit_periods WHERE id = p_period_id
  )
  SELECT
    COALESCE(SUM(ct.gross_amount), 0)                                                AS total_bruto,
    COALESCE(SUM(ct.net_amount), 0)                                                  AS total_liquido_declarado,
    COALESCE(SUM(ct.net_amount)       FILTER (WHERE ct.deposit_group = 'ifood'), 0)  AS total_liquido_ifood,
    COALESCE(SUM(ct.gross_amount)     FILTER (WHERE ct.deposit_group = 'ifood'), 0)  AS total_bruto_ifood,
    COALESCE(SUM(ct.tax_amount), 0)                                                  AS total_taxa_declarada,
    COALESCE(SUM(ct.promotion_amount), 0)                                            AS total_promocao,
    COALESCE(SUM(ct.promotion_amount) FILTER (WHERE ct.deposit_group = 'ifood'), 0)  AS total_promocao_ifood,
    COALESCE(SUM(ct.incentivo_ifood)  FILTER (WHERE ct.deposit_group = 'ifood'), 0)  AS total_incentivo_ifood,
    COUNT(*)                                                                         AS total_count
  FROM public.audit_card_transactions ct, p
  WHERE ct.audit_period_id = p.id
    AND ct.sale_date BETWEEN p.d_ini AND p.d_fim;
$$;

DROP FUNCTION IF EXISTS public.get_audit_contabil_breakdown(uuid);

CREATE OR REPLACE FUNCTION public.get_audit_contabil_breakdown(p_period_id uuid)
RETURNS TABLE(categoria text, dia integer, qtd bigint, bruto numeric, liquido numeric, taxa numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    CASE
      WHEN payment_method ILIKE 'credito' OR payment_method ILIKE 'crédito' THEN 'credito'
      WHEN payment_method ILIKE 'debito' OR payment_method ILIKE 'débito' THEN 'debito'
      WHEN payment_method ILIKE 'pix' THEN 'pix'
      WHEN payment_method ILIKE 'voucher' AND UPPER(COALESCE(brand, '')) = 'ALELO' THEN 'alelo'
      WHEN payment_method ILIKE 'voucher' AND UPPER(COALESCE(brand, '')) = 'TICKET' THEN 'ticket'
      WHEN payment_method ILIKE 'voucher' AND UPPER(COALESCE(brand, '')) = 'VR' THEN 'vr'
      WHEN payment_method ILIKE 'voucher' AND UPPER(COALESCE(brand, '')) IN ('SODEXO', 'PLUXEE') THEN 'pluxee'
      ELSE 'outro'
    END AS categoria,
    EXTRACT(DAY FROM sale_date)::integer AS dia,
    COUNT(*) AS qtd,
    COALESCE(SUM(gross_amount), 0) AS bruto,
    COALESCE(SUM(net_amount), 0) AS liquido,
    COALESCE(SUM(tax_amount), 0) AS taxa
  FROM public.audit_card_transactions
  WHERE audit_period_id = p_period_id
    AND is_competencia = true
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;
