CREATE OR REPLACE FUNCTION classify_ifood_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dep RECORD;
  v_liquido_dia numeric;
  v_match_comp numeric;
  v_match_adj numeric;
  v_dep_individual RECORD;
  v_consumido_comp numeric;
BEGIN
  -- Reset
  UPDATE audit_bank_deposits
  SET match_status = 'pending', 
      match_reason = NULL,
      matched_competencia_amount = 0,
      matched_adjacente_amount = 0
  WHERE audit_period_id = p_period_id 
    AND bank = 'cresol' 
    AND category = 'ifood';

  -- Para cada deposit_date que tem depósitos
  FOR v_dep IN
    SELECT deposit_date
    FROM audit_bank_deposits
    WHERE audit_period_id = p_period_id
      AND bank = 'cresol' 
      AND category = 'ifood'
    GROUP BY deposit_date
    ORDER BY deposit_date
  LOOP
    -- Quanto a competência espera receber neste deposit_date?
    SELECT COALESCE(SUM(net_amount), 0) INTO v_liquido_dia
    FROM audit_card_transactions
    WHERE audit_period_id = p_period_id
      AND deposit_group = 'ifood'
      AND is_competencia = true
      AND expected_deposit_date = v_dep.deposit_date;
    
    v_consumido_comp := 0;
    
    FOR v_dep_individual IN
      SELECT id, amount
      FROM audit_bank_deposits
      WHERE audit_period_id = p_period_id
        AND bank = 'cresol'
        AND category = 'ifood'
        AND deposit_date = v_dep.deposit_date
      ORDER BY id
    LOOP
      IF v_liquido_dia > 0 AND v_consumido_comp < v_liquido_dia THEN
        IF v_consumido_comp + v_dep_individual.amount <= v_liquido_dia THEN
          v_match_comp := v_dep_individual.amount;
          v_match_adj := 0;
        ELSE
          v_match_comp := v_liquido_dia - v_consumido_comp;
          v_match_adj := v_dep_individual.amount - v_match_comp;
        END IF;
        
        UPDATE audit_bank_deposits
        SET match_status = 'matched',
            matched_competencia_amount = v_match_comp,
            matched_adjacente_amount = v_match_adj,
            match_reason = format('Comp: R$%s | Adj: R$%s | Esperado dia %s: R$%s',
                                  round(v_match_comp, 2),
                                  round(v_match_adj, 2),
                                  to_char(v_dep.deposit_date, 'DD/MM'),
                                  round(v_liquido_dia, 2))
        WHERE id = v_dep_individual.id;
        
        v_consumido_comp := v_consumido_comp + v_match_comp;
      ELSE
        UPDATE audit_bank_deposits
        SET match_status = 'fora_periodo',
            matched_competencia_amount = 0,
            matched_adjacente_amount = v_dep_individual.amount,
            match_reason = format('Adjacente (sem competência em %s ou já cobriu R$%s)',
                                  to_char(v_dep.deposit_date, 'DD/MM'),
                                  round(v_liquido_dia, 2))
        WHERE id = v_dep_individual.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION get_audit_ifood_daily_detail(p_period_id uuid)
RETURNS TABLE (
  match_date date,
  vendas_count integer,
  bruto numeric,
  liquido numeric,
  deposito numeric,
  diferenca numeric,
  status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH vendas_dia AS (
    SELECT 
      expected_deposit_date AS match_date,
      COUNT(*) AS vendas_count,
      SUM(gross_amount) AS bruto,
      SUM(net_amount) AS liquido
    FROM audit_card_transactions
    WHERE audit_period_id = p_period_id
      AND deposit_group = 'ifood'
      AND is_competencia = true
    GROUP BY expected_deposit_date
  ),
  depositos_dia AS (
    SELECT 
      deposit_date AS match_date,
      SUM(matched_competencia_amount) AS deposito
    FROM audit_bank_deposits
    WHERE audit_period_id = p_period_id
      AND bank = 'cresol'
      AND category = 'ifood'
      AND match_status = 'matched'
      AND matched_competencia_amount > 0
    GROUP BY deposit_date
  )
  SELECT 
    v.match_date,
    v.vendas_count::integer,
    v.bruto,
    v.liquido,
    COALESCE(d.deposito, 0) AS deposito,
    COALESCE(d.deposito, 0) - v.liquido AS diferenca,
    CASE
      WHEN d.deposito IS NULL THEN 'SEM_DEPOSITO'
      WHEN ABS(d.deposito - v.liquido) <= GREATEST(v.liquido * 0.02, 50) THEN 'OK'
      ELSE 'PARCIAL'
    END AS status
  FROM vendas_dia v
  LEFT JOIN depositos_dia d ON v.match_date = d.match_date
  ORDER BY v.match_date;
$$;