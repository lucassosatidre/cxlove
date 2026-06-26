CREATE OR REPLACE FUNCTION public.cashflow_upcoming_bills()
RETURNS TABLE(vencimento date, amount numeric, category text, fornecedor text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT vencimento, amount, category, fornecedor
  FROM public.cashflow_saipos
  WHERE paid = false AND amount < 0 AND COALESCE(is_frente_caixa,false)=false
    AND vencimento >= CURRENT_DATE
  ORDER BY vencimento;
$$;
GRANT EXECUTE ON FUNCTION public.cashflow_upcoming_bills() TO authenticated, service_role;