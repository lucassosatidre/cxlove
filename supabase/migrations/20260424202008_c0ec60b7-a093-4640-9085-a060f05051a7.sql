CREATE OR REPLACE FUNCTION public.get_audit_contabil_breakdown(p_period_id uuid)
RETURNS TABLE (
  categoria text,
  dia integer,
  qtd bigint,
  bruto numeric,
  liquido numeric,
  taxa numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;