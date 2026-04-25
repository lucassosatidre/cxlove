CREATE OR REPLACE FUNCTION classify_voucher_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_brand text;
  v_total_liquido_esperado numeric;
  v_total_bruto_esperado numeric;
  v_total_matched_comp numeric;
  v_dep RECORD;
  v_match_comp numeric;
  v_match_adj numeric;
  v_sold_count integer;
  v_dep_count integer;
  v_diff numeric;
  v_rate numeric;
  v_status text;
BEGIN
  UPDATE audit_bank_deposits
  SET match_status = 'pending', match_reason = NULL,
      matched_competencia_amount = 0, matched_adjacente_amount = 0
  WHERE audit_period_id = p_period_id AND bank = 'bb'
    AND category IN ('alelo', 'ticket', 'pluxee', 'vr');

  FOR v_brand IN SELECT unnest(ARRAY['alelo', 'ticket', 'pluxee', 'vr']) LOOP
    -- Usa deposit_group (normalizado) ao invés de brand bruto (que vem 'SODEXO' pra pluxee)
    SELECT COALESCE(SUM(net_amount), 0), COALESCE(SUM(gross_amount), 0), COUNT(*)
      INTO v_total_liquido_esperado, v_total_bruto_esperado, v_sold_count
    FROM audit_card_transactions
    WHERE audit_period_id = p_period_id
      AND deposit_group = v_brand
      AND is_competencia = true;
    
    v_total_matched_comp := 0;
    
    FOR v_dep IN
      SELECT id, amount, deposit_date FROM audit_bank_deposits
      WHERE audit_period_id = p_period_id AND bank = 'bb' AND category = v_brand
      ORDER BY deposit_date ASC, id ASC
    LOOP
      IF v_total_matched_comp >= v_total_liquido_esperado THEN
        UPDATE audit_bank_deposits
        SET match_status = 'fora_periodo', matched_competencia_amount = 0,
            matched_adjacente_amount = v_dep.amount,
            match_reason = format('Excedente após cobrir competência (acumulado R$%s)', round(v_total_matched_comp, 2))
        WHERE id = v_dep.id;
      ELSIF v_total_matched_comp + v_dep.amount <= v_total_liquido_esperado THEN
        v_match_comp := v_dep.amount;
        UPDATE audit_bank_deposits
        SET match_status = 'matched', matched_competencia_amount = v_match_comp,
            matched_adjacente_amount = 0,
            match_reason = format('Comp %s: R$%s | Acum: R$%s/%s', UPPER(v_brand), round(v_match_comp, 2), round(v_total_matched_comp + v_match_comp, 2), round(v_total_liquido_esperado, 2))
        WHERE id = v_dep.id;
        v_total_matched_comp := v_total_matched_comp + v_match_comp;
      ELSE
        v_match_comp := v_total_liquido_esperado - v_total_matched_comp;
        v_match_adj := v_dep.amount - v_match_comp;
        UPDATE audit_bank_deposits
        SET match_status = 'matched', matched_competencia_amount = v_match_comp,
            matched_adjacente_amount = v_match_adj,
            match_reason = format('Comp %s: R$%s | Adj: R$%s | Cobriu competência total R$%s', UPPER(v_brand), round(v_match_comp, 2), round(v_match_adj, 2), round(v_total_liquido_esperado, 2))
        WHERE id = v_dep.id;
        v_total_matched_comp := v_total_matched_comp + v_match_comp;
      END IF;
    END LOOP;

    SELECT COUNT(*) INTO v_dep_count FROM audit_bank_deposits
    WHERE audit_period_id = p_period_id AND bank = 'bb' AND category = v_brand AND match_status = 'matched';
    
    v_diff := v_total_bruto_esperado - v_total_matched_comp;
    v_rate := CASE WHEN v_total_bruto_esperado > 0 THEN v_diff / v_total_bruto_esperado * 100 ELSE 0 END;
    
    IF v_total_bruto_esperado = 0 AND v_total_matched_comp = 0 THEN v_status := 'no_sales';
    ELSIF v_total_bruto_esperado = 0 THEN v_status := 'no_sales';
    ELSIF v_rate > 10 THEN v_status := 'critico';
    ELSIF v_rate > 5 THEN v_status := 'alerta';
    ELSIF v_rate < -5 THEN v_status := 'divergente';
    ELSE v_status := 'ok';
    END IF;

    INSERT INTO audit_voucher_matches (audit_period_id, company, sold_amount, sold_count, deposited_amount, deposit_count, difference, effective_tax_rate, status)
    VALUES (p_period_id, v_brand, v_total_bruto_esperado, v_sold_count, v_total_matched_comp, v_dep_count, v_diff, v_rate, v_status)
    ON CONFLICT (audit_period_id, company) DO UPDATE
    SET sold_amount = EXCLUDED.sold_amount, sold_count = EXCLUDED.sold_count,
        deposited_amount = EXCLUDED.deposited_amount, deposit_count = EXCLUDED.deposit_count,
        difference = EXCLUDED.difference, effective_tax_rate = EXCLUDED.effective_tax_rate,
        status = EXCLUDED.status;
  END LOOP;
END;
$$;