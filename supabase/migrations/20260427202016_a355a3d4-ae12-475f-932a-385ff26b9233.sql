CREATE OR REPLACE FUNCTION public.classify_ifood_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dep RECORD;
  v_liquido_dia numeric;
  v_match_comp numeric;
  v_match_adj numeric;
  v_dep_individual RECORD;
  v_consumido_comp numeric;
  v_orfao RECORD;
  v_dep2 RECORD;
  v_falta numeric;
  v_pega numeric;
  v_d_min date;
  v_d_max date;
  v_feriados date[] := ARRAY[
    '2026-01-01','2026-02-16','2026-02-17','2026-04-03','2026-04-21',
    '2026-05-01','2026-06-04','2026-09-07','2026-10-12','2026-11-02',
    '2026-11-15','2026-11-20','2026-12-25'
  ]::date[];
BEGIN
  -- Reset
  UPDATE audit_bank_deposits
  SET match_status = 'pending', match_reason = NULL,
      matched_competencia_amount = 0, matched_adjacente_amount = 0
  WHERE audit_period_id = p_period_id AND bank = 'cresol' AND category = 'ifood';

  -- ===== PASSE 1: match 1:1 por data =====
  FOR v_dep IN
    SELECT deposit_date FROM audit_bank_deposits
    WHERE audit_period_id = p_period_id AND bank = 'cresol' AND category = 'ifood'
    GROUP BY deposit_date ORDER BY deposit_date
  LOOP
    SELECT COALESCE(SUM(net_amount), 0) INTO v_liquido_dia
    FROM audit_card_transactions
    WHERE audit_period_id = p_period_id
      AND deposit_group = 'ifood'
      AND is_competencia = true
      AND expected_deposit_date = v_dep.deposit_date;

    v_consumido_comp := 0;
    FOR v_dep_individual IN
      SELECT id, amount FROM audit_bank_deposits
      WHERE audit_period_id = p_period_id AND bank = 'cresol' AND category = 'ifood'
        AND deposit_date = v_dep.deposit_date
      ORDER BY id
    LOOP
      IF v_liquido_dia > 0 AND v_consumido_comp < v_liquido_dia THEN
        IF v_consumido_comp + v_dep_individual.amount <= v_liquido_dia THEN
          v_match_comp := v_dep_individual.amount; v_match_adj := 0;
        ELSE
          v_match_comp := v_liquido_dia - v_consumido_comp;
          v_match_adj := v_dep_individual.amount - v_match_comp;
        END IF;
        UPDATE audit_bank_deposits
        SET match_status = 'matched',
            matched_competencia_amount = v_match_comp,
            matched_adjacente_amount = v_match_adj,
            match_reason = format('Comp: R$%s | Adj: R$%s | Esperado dia %s: R$%s',
              round(v_match_comp,2), round(v_match_adj,2),
              to_char(v_dep.deposit_date,'DD/MM'), round(v_liquido_dia,2))
        WHERE id = v_dep_individual.id;
        v_consumido_comp := v_consumido_comp + v_match_comp;
      ELSE
        UPDATE audit_bank_deposits
        SET match_status = 'fora_periodo',
            matched_competencia_amount = 0,
            matched_adjacente_amount = v_dep_individual.amount,
            match_reason = format('Adjacente (sem competência em %s ou já cobriu R$%s)',
              to_char(v_dep.deposit_date,'DD/MM'), round(v_liquido_dia,2))
        WHERE id = v_dep_individual.id;
      END IF;
    END LOOP;
  END LOOP;

  -- ===== PASSE 2: carry D+1 a D+3 dias úteis (pula sáb/dom + feriados 2026) =====
  FOR v_orfao IN
    WITH vendas AS (
      SELECT expected_deposit_date AS dia, SUM(net_amount) AS esperado
      FROM audit_card_transactions
      WHERE audit_period_id = p_period_id
        AND deposit_group = 'ifood'
        AND is_competencia = true
        AND expected_deposit_date IS NOT NULL
      GROUP BY 1
    ),
    matched_no_dia AS (
      SELECT deposit_date AS dia, SUM(matched_competencia_amount) AS ja_matched
      FROM audit_bank_deposits
      WHERE audit_period_id = p_period_id AND bank = 'cresol' AND category = 'ifood'
      GROUP BY 1
    )
    SELECT v.dia, (v.esperado - COALESCE(m.ja_matched, 0)) AS falta
    FROM vendas v LEFT JOIN matched_no_dia m ON m.dia = v.dia
    WHERE (v.esperado - COALESCE(m.ja_matched, 0)) > 1
    ORDER BY v.dia ASC
  LOOP
    v_falta := v_orfao.falta;

    SELECT MIN(d), MAX(d) INTO v_d_min, v_d_max FROM (
      SELECT d FROM generate_series(v_orfao.dia + 1, v_orfao.dia + 14, '1 day') AS d
      WHERE EXTRACT(DOW FROM d) NOT IN (0, 6) AND NOT (d = ANY(v_feriados))
      ORDER BY d LIMIT 3
    ) sub;

    IF v_d_min IS NULL THEN CONTINUE; END IF;

    FOR v_dep2 IN
      SELECT id, matched_adjacente_amount AS restante, deposit_date
      FROM audit_bank_deposits
      WHERE audit_period_id = p_period_id AND bank = 'cresol' AND category = 'ifood'
        AND match_status IN ('matched','fora_periodo')
        AND matched_adjacente_amount > 0
        AND deposit_date BETWEEN v_d_min AND v_d_max
      ORDER BY deposit_date ASC, id ASC
    LOOP
      EXIT WHEN v_falta <= 0;
      v_pega := LEAST(v_falta, v_dep2.restante);
      IF v_pega <= 0 THEN CONTINUE; END IF;

      UPDATE audit_bank_deposits
      SET matched_competencia_amount = matched_competencia_amount + v_pega,
          matched_adjacente_amount   = matched_adjacente_amount - v_pega,
          match_status = 'matched',
          match_reason = COALESCE(match_reason,'') ||
            format(' | passe2: R$%s servido p/ expected %s (D+%s útil)',
              round(v_pega,2),
              to_char(v_orfao.dia,'DD/MM'),
              (v_dep2.deposit_date - v_orfao.dia)::text)
      WHERE id = v_dep2.id;

      v_falta := v_falta - v_pega;
    END LOOP;
  END LOOP;
END;
$function$;