CREATE OR REPLACE FUNCTION public.cashflow_monthly_consolidated()
RETURNS TABLE(ym text, entradas numeric, saidas numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH ent AS (
    SELECT to_char(tx_date,'YYYY-MM') ym, COALESCE(SUM(amount),0) v
    FROM public.cashflow_transactions
    WHERE COALESCE(is_internal_transfer,false)=false AND amount>0
    GROUP BY 1
  ),
  sai AS (
    SELECT to_char(COALESCE(pagamento,vencimento),'YYYY-MM') ym, COALESCE(SUM(amount),0) v
    FROM public.cashflow_saipos
    WHERE amount<0 AND COALESCE(is_frente_caixa,false)=false AND paid=true
    GROUP BY 1
  )
  SELECT COALESCE(ent.ym,sai.ym) ym, COALESCE(ent.v,0), COALESCE(sai.v,0)
  FROM ent FULL OUTER JOIN sai ON ent.ym=sai.ym
  ORDER BY 1;
$$;
GRANT EXECUTE ON FUNCTION public.cashflow_monthly_consolidated() TO authenticated, service_role;