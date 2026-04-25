CREATE OR REPLACE FUNCTION public.classify_ifood_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_liquido_esperado numeric;
  v_total_matched numeric := 0;
  v_dep RECORD;
  v_falta numeric;
  v_first_expected date;
BEGIN
  UPDATE audit_bank_deposits
  SET match_status = 'pending', match_reason = NULL
  WHERE audit_period_id = p_period_id
    AND bank = 'cresol' AND category = 'ifood';

  SELECT 
    COALESCE(SUM(net_amount), 0),
    MIN(expected_deposit_date)
  INTO v_total_liquido_esperado, v_first_expected
  FROM audit_card_transactions
  WHERE audit_period_id = p_period_id
    AND deposit_group = 'ifood'
    AND is_competencia = true;

  -- Marca depósitos anteriores ao primeiro esperado como fora_periodo
  UPDATE audit_bank_deposits
  SET match_status = 'fora_periodo',
      match_reason = format('Depósito anterior à competência (1ª data esperada: %s)', to_char(v_first_expected, 'DD/MM'))
  WHERE audit_period_id = p_period_id
    AND bank = 'cresol' AND category = 'ifood'
    AND deposit_date < v_first_expected;

  FOR v_dep IN
    SELECT id, amount, deposit_date
    FROM audit_bank_deposits
    WHERE audit_period_id = p_period_id
      AND bank = 'cresol' AND category = 'ifood'
      AND deposit_date >= v_first_expected
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