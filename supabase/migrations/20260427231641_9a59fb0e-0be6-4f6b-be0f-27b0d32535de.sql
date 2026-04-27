CREATE OR REPLACE FUNCTION public.classify_voucher_deposits(p_period_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op text;
  v_liquido_esperado numeric;
  v_acumulado numeric;
  v_dep record;
  v_falta numeric;
  v_competencia_part numeric;
  v_adjacente_part numeric;
BEGIN
  FOR v_op IN SELECT unnest(ARRAY['alelo','ticket','pluxee','vr']) LOOP

    SELECT COALESCE(SUM(l.net_amount), 0)
      INTO v_liquido_esperado
      FROM voucher_lots l
     WHERE l.audit_period_id = p_period_id
       AND l.operadora = v_op
       AND EXISTS (
         SELECT 1
           FROM voucher_lot_items i
           JOIN audit_card_transactions ct ON ct.id = i.maquinona_match_id
          WHERE i.lot_id = l.id
            AND ct.is_competencia = true
            AND ct.audit_period_id = p_period_id
       );

    UPDATE audit_bank_deposits
       SET match_status = 'pending',
           matched_competencia_amount = 0,
           matched_adjacente_amount = 0,
           matched = false,
           match_reason = NULL
     WHERE audit_period_id = p_period_id
       AND bank = 'bb'
       AND category = v_op;

    v_acumulado := 0;

    FOR v_dep IN
      SELECT id, amount, deposit_date
        FROM audit_bank_deposits
       WHERE audit_period_id = p_period_id
         AND bank = 'bb'
         AND category = v_op
       ORDER BY deposit_date ASC, id ASC
    LOOP
      IF v_acumulado >= v_liquido_esperado THEN
        UPDATE audit_bank_deposits
           SET matched_competencia_amount = 0,
               matched_adjacente_amount = v_dep.amount,
               match_status = 'fora_periodo',
               matched = true,
               match_reason = format(
                 'fora_periodo: liquido_esperado=%s já consumido (acumulado=%s)',
                 v_liquido_esperado, v_acumulado
               )
         WHERE id = v_dep.id;

      ELSIF (v_acumulado + v_dep.amount) <= v_liquido_esperado THEN
        UPDATE audit_bank_deposits
           SET matched_competencia_amount = v_dep.amount,
               matched_adjacente_amount = 0,
               match_status = 'matched',
               matched = true,
               match_reason = format(
                 'matched: liquido_esperado=%s acumulado_pos=%s (%s%%)',
                 v_liquido_esperado,
                 v_acumulado + v_dep.amount,
                 round(((v_acumulado + v_dep.amount) / NULLIF(v_liquido_esperado,0)) * 100, 1)::text
               )
         WHERE id = v_dep.id;

        v_acumulado := v_acumulado + v_dep.amount;

      ELSE
        v_falta := v_liquido_esperado - v_acumulado;
        v_competencia_part := v_falta;
        v_adjacente_part := v_dep.amount - v_falta;

        UPDATE audit_bank_deposits
           SET matched_competencia_amount = v_competencia_part,
               matched_adjacente_amount = v_adjacente_part,
               match_status = 'matched',
               matched = true,
               match_reason = format(
                 'split: liquido_esperado=%s competencia=%s adjacente=%s',
                 v_liquido_esperado, v_competencia_part, v_adjacente_part
               )
         WHERE id = v_dep.id;

        v_acumulado := v_liquido_esperado;
      END IF;
    END LOOP;
  END LOOP;
END;
$function$