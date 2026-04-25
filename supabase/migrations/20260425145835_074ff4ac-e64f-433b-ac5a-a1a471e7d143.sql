ALTER TABLE audit_bank_deposits 
ADD COLUMN IF NOT EXISTS matched_competencia_amount numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS matched_adjacente_amount numeric DEFAULT 0;

CREATE OR REPLACE FUNCTION public.classify_ifood_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total_liquido_esperado numeric;
  v_total_matched_comp numeric := 0;
  v_dep RECORD;
  v_falta_comp numeric;
  v_match_comp numeric;
  v_match_adj numeric;
BEGIN
  UPDATE audit_bank_deposits
  SET match_status = 'pending', 
      match_reason = NULL,
      matched_competencia_amount = 0,
      matched_adjacente_amount = 0
  WHERE audit_period_id = p_period_id 
    AND bank = 'cresol' 
    AND category = 'ifood';

  SELECT COALESCE(SUM(net_amount), 0) INTO v_total_liquido_esperado
  FROM audit_card_transactions
  WHERE audit_period_id = p_period_id
    AND deposit_group = 'ifood'
    AND is_competencia = true;

  FOR v_dep IN
    SELECT id, amount, deposit_date
    FROM audit_bank_deposits
    WHERE audit_period_id = p_period_id
      AND bank = 'cresol' 
      AND category = 'ifood'
    ORDER BY deposit_date ASC, id ASC
  LOOP
    IF EXISTS (
      SELECT 1 FROM audit_card_transactions
      WHERE audit_period_id = p_period_id
        AND deposit_group = 'ifood'
        AND is_competencia = true
        AND expected_deposit_date = v_dep.deposit_date
    ) THEN
      v_falta_comp := v_total_liquido_esperado - v_total_matched_comp;
      
      IF v_falta_comp <= 0 THEN
        v_match_comp := 0;
        v_match_adj := v_dep.amount;
      ELSIF v_dep.amount <= v_falta_comp THEN
        v_match_comp := v_dep.amount;
        v_match_adj := 0;
      ELSE
        v_match_comp := v_falta_comp;
        v_match_adj := v_dep.amount - v_falta_comp;
      END IF;
      
      UPDATE audit_bank_deposits
      SET match_status = 'matched',
          matched_competencia_amount = v_match_comp,
          matched_adjacente_amount = v_match_adj,
          match_reason = format('Comp: R$%s | Adj: R$%s | Acum comp: R$%s/%s',
                                round(v_match_comp, 2),
                                round(v_match_adj, 2),
                                round(v_total_matched_comp + v_match_comp, 2),
                                round(v_total_liquido_esperado, 2))
      WHERE id = v_dep.id;
      
      v_total_matched_comp := v_total_matched_comp + v_match_comp;
    
    ELSE
      UPDATE audit_bank_deposits
      SET match_status = 'fora_periodo',
          matched_competencia_amount = 0,
          matched_adjacente_amount = v_dep.amount,
          match_reason = format('Sem vendas competência com expected=%s',
                                to_char(v_dep.deposit_date, 'DD/MM/YYYY'))
      WHERE id = v_dep.id;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_audit_ifood_daily_detail(p_period_id uuid)
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
      WHEN d.deposito IS NULL OR d.deposito = 0 THEN 'SEM_DEPOSITO'
      WHEN ABS(d.deposito - v.liquido) <= GREATEST(v.liquido * 0.02, 50) THEN 'OK'
      ELSE 'PARCIAL'
    END AS status
  FROM vendas_dia v
  LEFT JOIN depositos_dia d ON v.match_date = d.match_date
  ORDER BY v.match_date;
$$;