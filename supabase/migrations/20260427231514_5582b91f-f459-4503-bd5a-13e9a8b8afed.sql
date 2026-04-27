CREATE OR REPLACE FUNCTION public.match_voucher_lots_v2(p_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year int;
  v_month int;
  v_inicio date;
  v_fim date;
  v_janela_inicio date;
  v_janela_fim date;
  v_matched_items integer := 0;
  v_unmatched_items integer := 0;
  v_matched_lots integer := 0;
  v_unmatched_lots integer := 0;
BEGIN
  SELECT year, month INTO v_year, v_month FROM audit_periods WHERE id = p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período não encontrado'; END IF;

  v_inicio := make_date(v_year, v_month, 1);
  v_fim := (v_inicio + INTERVAL '1 month')::date;
  v_janela_inicio := (v_inicio - INTERVAL '1 month')::date;
  v_janela_fim := (v_inicio + INTERVAL '2 months')::date;

  UPDATE voucher_lot_items i
    SET maquinona_match_id = NULL, match_status = 'pending'
    FROM voucher_lots l
    WHERE i.lot_id = l.id
      AND l.data_pagamento >= v_janela_inicio
      AND l.data_pagamento < v_janela_fim;

  UPDATE voucher_lots
    SET status = 'imported', bb_deposit_id = NULL
    WHERE data_pagamento >= v_janela_inicio
      AND data_pagamento < v_janela_fim;

  -- Fase 1: item ↔ venda Maquinona com tolerância ampliada (D±1, 10%/R$0,50)
  WITH candidates AS (
    SELECT i.id AS item_id,
           ct.id AS ct_id,
           ABS(ct.gross_amount - i.gross_amount) AS diff_valor,
           i.gross_amount AS item_valor,
           row_number() OVER (
             PARTITION BY i.id
             ORDER BY ABS(ct.gross_amount - i.gross_amount) ASC,
                      ABS(EXTRACT(EPOCH FROM (ct.sale_date - i.data_transacao))) ASC,
                      ct.created_at ASC
           ) AS rn,
           count(*) OVER (PARTITION BY i.id) AS cnt
    FROM voucher_lot_items i
    JOIN voucher_lots l ON l.id = i.lot_id
    JOIN audit_card_transactions ct
      ON ct.deposit_group = l.operadora
     AND i.data_transacao BETWEEN ct.sale_date - INTERVAL '1 day'
                              AND ct.sale_date + INTERVAL '1 day'
     AND ABS(ct.gross_amount - i.gross_amount) <= GREATEST(ct.gross_amount * 0.10, 0.50)
    WHERE l.data_pagamento >= v_janela_inicio
      AND l.data_pagamento < v_janela_fim
      AND i.data_transacao >= v_janela_inicio
      AND i.data_transacao < v_janela_fim
  ),
  ranked AS (
    SELECT item_id, ct_id, rn, cnt, diff_valor, item_valor,
           LEAD(diff_valor) OVER (PARTITION BY item_id ORDER BY diff_valor, ct_id) AS next_diff
    FROM candidates
  )
  UPDATE voucher_lot_items i
     SET maquinona_match_id = CASE
           WHEN r.cnt = 1 THEN r.ct_id
           WHEN r.next_diff IS NOT NULL
                AND ABS(r.next_diff - r.diff_valor) <= GREATEST(r.item_valor * 0.005, 0.01)
                THEN NULL
           ELSE r.ct_id
         END,
         match_status = CASE
           WHEN r.cnt = 1 THEN 'matched'
           WHEN r.next_diff IS NOT NULL
                AND ABS(r.next_diff - r.diff_valor) <= GREATEST(r.item_valor * 0.005, 0.01)
                THEN 'ambiguous'
           ELSE 'matched'
         END
    FROM ranked r
   WHERE r.item_id = i.id AND r.rn = 1;

  UPDATE voucher_lot_items i
     SET match_status = 'unmatched'
    FROM voucher_lots l
   WHERE i.lot_id = l.id
     AND l.data_pagamento >= v_janela_inicio
     AND l.data_pagamento < v_janela_fim
     AND i.match_status = 'pending';

  -- Fase 2 (inalterada): lote ↔ BB com janela ±10 dias e tolerância 5%
  WITH bb_candidates AS (
    SELECT l.id AS lot_id, d.id AS dep_id,
           row_number() OVER (PARTITION BY l.id ORDER BY abs(d.amount - l.net_amount), d.created_at) AS rn
    FROM voucher_lots l
    JOIN audit_bank_deposits d
      ON d.bank = 'bb'
     AND d.category = l.operadora
     AND d.deposit_date BETWEEN (l.data_pagamento::date - INTERVAL '10 days')
                            AND (l.data_pagamento::date + INTERVAL '10 days')
     AND abs(d.amount - l.net_amount) / NULLIF(l.net_amount, 0) <= 0.05
    WHERE l.data_pagamento >= v_janela_inicio
      AND l.data_pagamento < v_janela_fim
      AND d.deposit_date >= v_janela_inicio
      AND d.deposit_date < v_janela_fim
  )
  UPDATE voucher_lots l
     SET bb_deposit_id = c.dep_id, status = 'bb_matched'
    FROM bb_candidates c
   WHERE c.lot_id = l.id AND c.rn = 1;

  UPDATE voucher_lots
     SET status = 'bb_unmatched'
   WHERE data_pagamento >= v_janela_inicio
     AND data_pagamento < v_janela_fim
     AND bb_deposit_id IS NULL;

  SELECT
    count(*) FILTER (WHERE i.match_status = 'matched'),
    count(*) FILTER (WHERE i.match_status IN ('unmatched','ambiguous'))
  INTO v_matched_items, v_unmatched_items
  FROM voucher_lot_items i
  WHERE i.data_transacao >= v_inicio
    AND i.data_transacao < v_fim;

  SELECT
    count(*) FILTER (WHERE l.status = 'bb_matched'),
    count(*) FILTER (WHERE l.status = 'bb_unmatched')
  INTO v_matched_lots, v_unmatched_lots
  FROM voucher_lots l
  WHERE EXISTS (
    SELECT 1 FROM voucher_lot_items i
    WHERE i.lot_id = l.id
      AND i.data_transacao >= v_inicio
      AND i.data_transacao < v_fim
  );

  RETURN jsonb_build_object(
    'matched_items', v_matched_items,
    'unmatched_items', v_unmatched_items,
    'matched_lots', v_matched_lots,
    'unmatched_lots', v_unmatched_lots
  );
END;
$function$