-- Reescreve classify_ifood_deposits: marca matched todos os depósitos até atingir o líquido esperado total
CREATE OR REPLACE FUNCTION public.classify_ifood_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_liquido_esperado numeric;
  v_total_matched numeric := 0;
  v_dep RECORD;
  v_falta numeric;
BEGIN
  UPDATE audit_bank_deposits
  SET match_status = 'pending', match_reason = NULL
  WHERE audit_period_id = p_period_id
    AND bank = 'cresol' AND category = 'ifood';

  SELECT COALESCE(SUM(net_amount), 0) INTO v_total_liquido_esperado
  FROM audit_card_transactions
  WHERE audit_period_id = p_period_id
    AND deposit_group = 'ifood'
    AND is_competencia = true;

  FOR v_dep IN
    SELECT id, amount, deposit_date
    FROM audit_bank_deposits
    WHERE audit_period_id = p_period_id
      AND bank = 'cresol' AND category = 'ifood'
    ORDER BY deposit_date ASC, id ASC
  LOOP
    v_falta := v_total_liquido_esperado - v_total_matched;

    IF v_falta <= 0 THEN
      UPDATE audit_bank_deposits
      SET match_status = 'fora_periodo',
          match_reason = format('Excedente após cobrir competência (acumulado R$%s)',
                                round(v_total_matched, 2))
      WHERE id = v_dep.id;
    ELSE
      UPDATE audit_bank_deposits
      SET match_status = 'matched',
          match_reason = format('Casa com vendas iFood (data dep: %s, acumulado R$%s de R$%s)',
                                to_char(v_dep.deposit_date, 'DD/MM'),
                                round(v_total_matched + v_dep.amount, 2),
                                round(v_total_liquido_esperado, 2))
      WHERE id = v_dep.id;
      v_total_matched := v_total_matched + v_dep.amount;
    END IF;
  END LOOP;
END;
$$;

-- Reescreve get_audit_ifood_daily_detail: casa por deposit_date (a Cresol deposita D+1 do esperado)
-- Mostra cada dia de venda com depósitos matched cuja deposit_date = expected_deposit_date daquele dia
CREATE OR REPLACE FUNCTION public.get_audit_ifood_daily_detail(p_period_id uuid)
RETURNS TABLE(match_date date, vendas_count integer, bruto numeric, liquido numeric, deposito numeric, diferenca numeric, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH vendas_dia AS (
    SELECT
      sale_date AS d,
      expected_deposit_date AS exp_d,
      COUNT(*)::integer AS vendas_count,
      SUM(gross_amount) AS bruto,
      SUM(net_amount) AS liquido
    FROM public.audit_card_transactions
    WHERE audit_period_id = p_period_id
      AND deposit_group = 'ifood'
      AND is_competencia = true
    GROUP BY sale_date, expected_deposit_date
  ),
  depositos_por_data AS (
    SELECT
      deposit_date AS d,
      SUM(amount) AS deposito
    FROM public.audit_bank_deposits
    WHERE audit_period_id = p_period_id
      AND bank = 'cresol'
      AND category = 'ifood'
      AND match_status = 'matched'
    GROUP BY deposit_date
  )
  SELECT
    v.d AS match_date,
    v.vendas_count,
    v.bruto,
    v.liquido,
    COALESCE(d.deposito, 0) AS deposito,
    COALESCE(d.deposito, 0) - v.liquido AS diferenca,
    CASE
      WHEN d.d IS NULL THEN 'missing_deposit'
      WHEN ABS(COALESCE(d.deposito, 0) - v.liquido) < 1 THEN 'matched'
      WHEN ABS(COALESCE(d.deposito, 0) - v.liquido) <= v.liquido * 0.02 THEN 'matched'
      ELSE 'partial'
    END AS status
  FROM vendas_dia v
  LEFT JOIN depositos_por_data d ON d.d = v.exp_d
  ORDER BY v.d;
$$;