CREATE OR REPLACE FUNCTION public.get_audit_period_totals(p_period_id uuid)
RETURNS TABLE (
  total_gross numeric,
  total_tax numeric,
  total_net numeric,
  total_count bigint,
  total_promotion numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(gross_amount), 0) AS total_gross,
    COALESCE(SUM(tax_amount), 0) AS total_tax,
    COALESCE(SUM(net_amount), 0) AS total_net,
    COUNT(*) AS total_count,
    COALESCE(SUM(promotion_amount), 0) AS total_promotion
  FROM public.audit_card_transactions
  WHERE audit_period_id = p_period_id
$$;

CREATE OR REPLACE FUNCTION public.get_audit_period_deposits(p_period_id uuid)
RETURNS TABLE (
  category text,
  bank text,
  total_amount numeric,
  deposit_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    category,
    bank,
    COALESCE(SUM(amount), 0) AS total_amount,
    COUNT(*) AS deposit_count
  FROM public.audit_bank_deposits
  WHERE audit_period_id = p_period_id
  GROUP BY category, bank
$$;