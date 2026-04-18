DROP FUNCTION IF EXISTS public.get_audit_period_totals(uuid);

CREATE OR REPLACE FUNCTION public.get_audit_period_totals(p_period_id uuid)
RETURNS TABLE (
  total_bruto numeric,
  total_liquido_declarado numeric,
  total_taxa_declarada numeric,
  total_promocao numeric,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(gross_amount), 0) AS total_bruto,
    COALESCE(SUM(net_amount), 0) AS total_liquido_declarado,
    COALESCE(SUM(tax_amount), 0) AS total_taxa_declarada,
    COALESCE(SUM(promotion_amount), 0) AS total_promocao,
    COUNT(*) AS total_count
  FROM public.audit_card_transactions
  WHERE audit_period_id = p_period_id
$$;