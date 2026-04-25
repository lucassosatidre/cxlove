CREATE OR REPLACE FUNCTION classify_voucher_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_brand text;
  v_prazo_med integer;
  v_total_bruto_esperado numeric;
  v_total_matched_comp numeric;
  v_dep RECORD;
  v_dep_count integer;
  v_sold_count integer;
  v_diff numeric;
  v_rate numeric;
  v_status text;
  v_period_month integer;
  v_period_year integer;
  v_period_start date;
  v_period_end date;
  v_venda_estimada date;
BEGIN
  SELECT month, year INTO v_period_month, v_period_year
  FROM audit_periods WHERE id = p_period_id;
  
  v_period_start := MAKE_DATE(v_period_year, v_period_month, 1);
  v_period_end := (v_period_start + INTERVAL '1 month')::date;

  UPDATE audit_bank_deposits
  SET match_status = 'pending', match_reason = NULL,
      matched_competencia_amount = 0, matched_adjacente_amount = 0
  WHERE audit_period_id = p_period_id 
    AND bank = 'bb'
    AND category IN ('alelo', 'ticket', 'pluxee', 'vr');

  -- Prazo MEDIANO (ponto central da janela), conforme análise dos extratos reais
  -- Alelo: 2d, Ticket: 2d, Pluxee: 5d, VR: 4d
  FOR v_brand, v_prazo_med IN
    SELECT * FROM (VALUES ('alelo', 2), ('ticket', 2), ('pluxee', 5), ('vr', 4)) AS t(brand, prazo)
  LOOP
    SELECT 
      COALESCE(SUM(gross_amount), 0),
      COUNT(*)
    INTO v_total_bruto_esperado, v_sold_count
    FROM audit_card_transactions
    WHERE audit_period_id = p_period_id
      AND deposit_group = v_brand
      AND is_competencia = true;
    
    v_total_matched_comp := 0;
    
    FOR v_dep IN
      SELECT id, amount, deposit_date
      FROM audit_bank_deposits
      WHERE audit_period_id = p_period_id
        AND bank = 'bb'
        AND category = v_brand
      ORDER BY deposit_date ASC, id ASC
    LOOP
      -- Data de venda estimada = deposit_date - prazo mediano
      v_venda_estimada := v_dep.deposit_date - v_prazo_med;
      
      -- Se a venda estimada cai DENTRO do mês de competência, é matched
      IF v_venda_estimada >= v_period_start 
         AND v_venda_estimada < v_period_end
      THEN
        UPDATE audit_bank_deposits
        SET match_status = 'matched',
            matched_competencia_amount = v_dep.amount,
            matched_adjacente_amount = 0,
            match_reason = format('%s: dep %s = venda estimada %s (D-%s)',
                                  UPPER(v_brand),
                                  to_char(v_dep.deposit_date, 'DD/MM'),
                                  to_char(v_venda_estimada, 'DD/MM'),
                                  v_prazo_med)
        WHERE id = v_dep.id;
        v_total_matched_comp := v_total_matched_comp + v_dep.amount;
      ELSE
        UPDATE audit_bank_deposits
        SET match_status = 'fora_periodo',
            matched_competencia_amount = 0,
            matched_adjacente_amount = v_dep.amount,
            match_reason = format('%s adjacente: dep %s = venda estimada %s (fora competência)',
                                  UPPER(v_brand),
                                  to_char(v_dep.deposit_date, 'DD/MM'),
                                  to_char(v_venda_estimada, 'DD/MM'))
        WHERE id = v_dep.id;
      END IF;
    END LOOP;
    
    SELECT COUNT(*) INTO v_dep_count
    FROM audit_bank_deposits
    WHERE audit_period_id = p_period_id 
      AND bank = 'bb' 
      AND category = v_brand 
      AND match_status = 'matched';
    
    v_diff := v_total_bruto_esperado - v_total_matched_comp;
    v_rate := CASE 
      WHEN v_total_bruto_esperado > 0 
      THEN v_diff / v_total_bruto_esperado * 100 
      ELSE 0 
    END;
    
    IF v_total_bruto_esperado = 0 THEN v_status := 'no_sales';
    ELSIF v_rate > 10 THEN v_status := 'critico';
    ELSIF v_rate > 5 THEN v_status := 'alerta';
    ELSIF v_rate < -5 THEN v_status := 'divergente';
    ELSE v_status := 'ok';
    END IF;

    INSERT INTO audit_voucher_matches 
      (audit_period_id, company, sold_amount, sold_count, deposited_amount, 
       deposit_count, difference, effective_tax_rate, status)
    VALUES 
      (p_period_id, v_brand, v_total_bruto_esperado, v_sold_count, 
       v_total_matched_comp, v_dep_count, v_diff, v_rate, v_status)
    ON CONFLICT (audit_period_id, company) DO UPDATE
    SET sold_amount = EXCLUDED.sold_amount, 
        sold_count = EXCLUDED.sold_count,
        deposited_amount = EXCLUDED.deposited_amount, 
        deposit_count = EXCLUDED.deposit_count,
        difference = EXCLUDED.difference, 
        effective_tax_rate = EXCLUDED.effective_tax_rate,
        status = EXCLUDED.status;
  END LOOP;
END;
$$;