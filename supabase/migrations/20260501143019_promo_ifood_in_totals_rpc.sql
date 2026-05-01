-- Adiciona breakdown de promoção/incentivo na RPC get_audit_period_totals.
-- Promoção (custo da pizzaria — cashback) e incentivo iFood (subsídio do iFood
-- — não é custo) precisam ser visíveis no painel iFood do AuditDashboard.

DROP FUNCTION IF EXISTS public.get_audit_period_totals(uuid);

CREATE OR REPLACE FUNCTION public.get_audit_period_totals(p_period_id uuid)
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
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH p AS (
    SELECT make_date(year, month, 1) AS d_ini,
           (make_date(year, month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date AS d_fim
    FROM public.audit_periods WHERE id = p_period_id
  )
  SELECT
    COALESCE(SUM(ct.gross_amount), 0)                                                         AS total_bruto,
    COALESCE(SUM(ct.net_amount), 0)                                                           AS total_liquido_declarado,
    COALESCE(SUM(ct.net_amount)        FILTER (WHERE ct.deposit_group = 'ifood'), 0)          AS total_liquido_ifood,
    COALESCE(SUM(ct.gross_amount)      FILTER (WHERE ct.deposit_group = 'ifood'), 0)          AS total_bruto_ifood,
    COALESCE(SUM(ct.tax_amount), 0)                                                           AS total_taxa_declarada,
    COALESCE(SUM(ct.promotion_amount), 0)                                                     AS total_promocao,
    COALESCE(SUM(ct.promotion_amount)  FILTER (WHERE ct.deposit_group = 'ifood'), 0)          AS total_promocao_ifood,
    COALESCE(SUM(ct.incentivo_ifood)   FILTER (WHERE ct.deposit_group = 'ifood'), 0)          AS total_incentivo_ifood,
    COUNT(*)                                                                                  AS total_count
  FROM public.audit_card_transactions ct, p
  WHERE ct.sale_date BETWEEN p.d_ini AND p.d_fim;
$function$;
