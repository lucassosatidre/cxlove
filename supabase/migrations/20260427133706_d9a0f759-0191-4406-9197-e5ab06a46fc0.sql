-- ============================================================================
-- 1) row_hash em audit_bank_deposits + trigger + índice unique
-- ============================================================================

ALTER TABLE public.audit_bank_deposits 
  ADD COLUMN IF NOT EXISTS row_hash TEXT;

-- Trigger que calcula o hash (mesma fórmula usada no backfill)
CREATE OR REPLACE FUNCTION public.calc_bank_deposit_row_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.row_hash := md5(
    COALESCE(NEW.deposit_date::text, '') || '|' ||
    COALESCE(NEW.amount::text, '') || '|' ||
    COALESCE(NEW.bank, '') || '|' ||
    COALESCE(NEW.category, '') || '|' ||
    COALESCE(NEW.doc_number, '')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bank_deposit_row_hash ON public.audit_bank_deposits;
CREATE TRIGGER trg_bank_deposit_row_hash
  BEFORE INSERT OR UPDATE ON public.audit_bank_deposits
  FOR EACH ROW EXECUTE FUNCTION public.calc_bank_deposit_row_hash();

-- Backfill com a MESMA fórmula (ordem crítica: ANTES do índice unique)
UPDATE public.audit_bank_deposits
SET row_hash = md5(
  COALESCE(deposit_date::text, '') || '|' ||
  COALESCE(amount::text, '') || '|' ||
  COALESCE(bank, '') || '|' ||
  COALESCE(category, '') || '|' ||
  COALESCE(doc_number, '')
)
WHERE row_hash IS NULL;

-- Índice unique APÓS o backfill (verificamos antes que não há duplicatas)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bank_deposit_hash 
  ON public.audit_bank_deposits(audit_period_id, bank, row_hash);

-- ============================================================================
-- 2) Tabela audit_voucher_competencia
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_voucher_competencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  operadora text NOT NULL,
  vendido_bruto numeric(12,2) NOT NULL DEFAULT 0,
  vendido_count int NOT NULL DEFAULT 0,
  reconhecido_bruto numeric(12,2) NOT NULL DEFAULT 0,
  reconhecido_count int NOT NULL DEFAULT 0,
  pago_bruto numeric(12,2) NOT NULL DEFAULT 0,
  pago_liquido numeric(12,2) NOT NULL DEFAULT 0,
  pago_lotes_count int NOT NULL DEFAULT 0,
  pendente_bruto numeric(12,2) NOT NULL DEFAULT 0,
  pendente_count int NOT NULL DEFAULT 0,
  taxa_real_pct numeric(8,6),
  taxa_estimada_pct numeric(8,6),
  taxa_efetiva_consolidada_pct numeric(8,6),
  status text NOT NULL,
  calculado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE(audit_period_id, operadora)
);

ALTER TABLE public.audit_voucher_competencia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read access for authenticated" ON public.audit_voucher_competencia;
CREATE POLICY "Read access for authenticated"
  ON public.audit_voucher_competencia
  FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- 3) View unificada de importações por período
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_period_imports AS
SELECT 
  audit_period_id,
  file_type AS source,
  status,
  file_name,
  imported_rows,
  created_at
FROM public.audit_imports
UNION ALL
SELECT 
  audit_period_id,
  operadora AS source,
  status,
  file_name,
  (COALESCE(imported_lots, 0) + COALESCE(imported_items, 0)) AS imported_rows,
  imported_at AS created_at
FROM public.voucher_imports;

GRANT SELECT ON public.vw_period_imports TO authenticated;

-- ============================================================================
-- 4) match_voucher_lots_v2 — filtra por DATA, suporta cross-period
-- ============================================================================

CREATE OR REPLACE FUNCTION public.match_voucher_lots_v2(p_period_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  -- Reset apenas dos lotes/items DA JANELA (3 meses ao redor da competência)
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

  -- Match items↔Maquinona — filtro por DATA
  WITH candidates AS (
    SELECT i.id AS item_id, ct.id AS ct_id,
           row_number() OVER (PARTITION BY i.id ORDER BY ct.created_at) AS rn,
           count(*) OVER (PARTITION BY i.id) AS cnt
    FROM voucher_lot_items i
    JOIN voucher_lots l ON l.id = i.lot_id
    JOIN audit_card_transactions ct
      ON ct.deposit_group = l.operadora
     AND ct.sale_date = i.data_transacao
     AND abs(ct.gross_amount - i.gross_amount) <= 0.01
    WHERE l.data_pagamento >= v_janela_inicio
      AND l.data_pagamento < v_janela_fim
      AND i.data_transacao >= v_janela_inicio
      AND i.data_transacao < v_janela_fim
  )
  UPDATE voucher_lot_items i
     SET maquinona_match_id = c.ct_id,
         match_status = CASE WHEN c.cnt = 1 THEN 'matched' ELSE 'ambiguous' END
    FROM candidates c
   WHERE c.item_id = i.id AND c.rn = 1;

  UPDATE voucher_lot_items i
     SET match_status = 'unmatched'
    FROM voucher_lots l
   WHERE i.lot_id = l.id
     AND l.data_pagamento >= v_janela_inicio
     AND l.data_pagamento < v_janela_fim
     AND i.match_status = 'pending';

  -- Match lotes↔BB — filtro por DATA
  WITH bb_candidates AS (
    SELECT l.id AS lot_id, d.id AS dep_id,
           row_number() OVER (PARTITION BY l.id ORDER BY abs(d.amount - l.net_amount), d.created_at) AS rn
    FROM voucher_lots l
    JOIN audit_bank_deposits d
      ON d.bank = 'bb'
     AND d.category = l.operadora
     AND d.deposit_date = l.data_pagamento
     AND abs(d.amount - l.net_amount) <= 0.50
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

  -- Stats restritos ao mês de competência
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
$$;

GRANT EXECUTE ON FUNCTION public.match_voucher_lots_v2(uuid) TO authenticated;

-- ============================================================================
-- 5) calculate_voucher_audit — competência por sale_date Maquinona
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_voucher_audit(p_period_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_year int;
  v_month int;
  v_inicio date;
  v_fim date;
  v_op text;
  v_resultado jsonb := '[]'::jsonb;
  v_op_resultado jsonb;
  v_vendido_bruto numeric;
  v_vendido_count int;
  v_reconhecido_bruto numeric;
  v_reconhecido_count int;
  v_pago_bruto numeric;
  v_pago_liquido numeric;
  v_pago_lotes_count int;
  v_pendente_bruto numeric;
  v_pendente_count int;
  v_taxa_real_pct numeric;
  v_taxa_estimada_pct numeric;
  v_taxa_efetiva_pct numeric;
  v_status text;
  v_custo_real numeric;
  v_custo_estimado numeric;
BEGIN
  SELECT year, month INTO v_year, v_month FROM audit_periods WHERE id = p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período não encontrado'; END IF;

  v_inicio := make_date(v_year, v_month, 1);
  v_fim := (v_inicio + INTERVAL '1 month')::date;

  FOR v_op IN SELECT unnest(ARRAY['alelo', 'ticket', 'pluxee', 'vr']) LOOP
    -- A. Vendido (Maquinona) por DATA
    SELECT COALESCE(SUM(gross_amount), 0), COUNT(*)
    INTO v_vendido_bruto, v_vendido_count
    FROM audit_card_transactions
    WHERE deposit_group = v_op
      AND sale_date >= v_inicio
      AND sale_date < v_fim;

    -- B. Reconhecido (items casados com Maquinona da competência)
    SELECT COALESCE(SUM(i.gross_amount), 0), COUNT(*)
    INTO v_reconhecido_bruto, v_reconhecido_count
    FROM voucher_lot_items i
    JOIN voucher_lots l ON l.id = i.lot_id
    JOIN audit_card_transactions ct ON ct.id = i.maquinona_match_id
    WHERE l.operadora = v_op
      AND ct.sale_date >= v_inicio
      AND ct.sale_date < v_fim;

    -- C. Pago no BB — atribuição proporcional bruto-líquido
    WITH items_competencia AS (
      SELECT i.lot_id, SUM(i.gross_amount) AS gross_competencia
      FROM voucher_lot_items i
      JOIN audit_card_transactions ct ON ct.id = i.maquinona_match_id
      WHERE ct.sale_date >= v_inicio AND ct.sale_date < v_fim
      GROUP BY i.lot_id
    )
    SELECT
      COALESCE(SUM(ic.gross_competencia), 0),
      COALESCE(SUM(
        CASE WHEN l.gross_amount > 0 
          THEN l.net_amount * (ic.gross_competencia / l.gross_amount)
          ELSE 0
        END
      ), 0),
      COUNT(*)
    INTO v_pago_bruto, v_pago_liquido, v_pago_lotes_count
    FROM voucher_lots l
    JOIN items_competencia ic ON ic.lot_id = l.id
    WHERE l.operadora = v_op
      AND l.bb_deposit_id IS NOT NULL;

    -- D. Pendente
    SELECT COALESCE(SUM(i.gross_amount), 0), COUNT(*)
    INTO v_pendente_bruto, v_pendente_count
    FROM voucher_lot_items i
    JOIN voucher_lots l ON l.id = i.lot_id
    JOIN audit_card_transactions ct ON ct.id = i.maquinona_match_id
    WHERE l.operadora = v_op
      AND ct.sale_date >= v_inicio
      AND ct.sale_date < v_fim
      AND l.bb_deposit_id IS NULL;

    -- E. Taxa estimada (meses históricos 100% fechados, últimos 3)
    WITH meses_fechados AS (
      SELECT p.id
      FROM audit_periods p
      WHERE make_date(p.year, p.month, 1) >= (v_inicio - INTERVAL '3 months')
        AND make_date(p.year, p.month, 1) < v_inicio
        AND EXISTS (
          SELECT 1 FROM voucher_lots l
          WHERE l.audit_period_id = p.id AND l.operadora = v_op
        )
        AND NOT EXISTS (
          SELECT 1 FROM voucher_lots l
          WHERE l.audit_period_id = p.id 
            AND l.operadora = v_op
            AND l.bb_deposit_id IS NULL
        )
    ),
    historico AS (
      SELECT 
        COALESCE(SUM(l.gross_amount), 0) AS bruto_hist,
        COALESCE(SUM(l.net_amount), 0) AS liq_hist
      FROM voucher_lots l
      WHERE l.operadora = v_op
        AND l.audit_period_id IN (SELECT id FROM meses_fechados)
    )
    SELECT 
      CASE WHEN bruto_hist > 0 THEN (bruto_hist - liq_hist) / bruto_hist ELSE NULL END
    INTO v_taxa_estimada_pct
    FROM historico;

    -- Fallback: voucher_expected_rates (coluna 'company', valores em pct *100)
    IF v_taxa_estimada_pct IS NULL THEN
      SELECT expected_rate_pct / 100.0
      INTO v_taxa_estimada_pct
      FROM voucher_expected_rates
      WHERE company = v_op
      LIMIT 1;
      
      IF v_taxa_estimada_pct IS NULL THEN
        v_taxa_estimada_pct := 0.10;
      END IF;
    END IF;

    -- F. Taxa real e consolidada
    v_custo_real := v_pago_bruto - v_pago_liquido;
    v_custo_estimado := v_pendente_bruto * v_taxa_estimada_pct;

    IF v_pago_bruto > 0 THEN
      v_taxa_real_pct := v_custo_real / v_pago_bruto;
    ELSE
      v_taxa_real_pct := NULL;
    END IF;

    IF (v_pago_bruto + v_pendente_bruto) > 0 THEN
      v_taxa_efetiva_pct := (v_custo_real + v_custo_estimado) / (v_pago_bruto + v_pendente_bruto);
    ELSE
      v_taxa_efetiva_pct := NULL;
    END IF;

    -- G. Status
    v_status := CASE
      WHEN v_vendido_bruto <= 1.00 AND v_reconhecido_bruto <= 1.00 THEN 'sem_movimento'
      WHEN v_vendido_bruto > v_reconhecido_bruto + 1.00 THEN 'divergente'
      WHEN v_pendente_bruto > 1.00 THEN 'em_andamento'
      WHEN ABS(v_vendido_bruto - v_reconhecido_bruto) <= 1.00 AND v_pendente_bruto <= 1.00 THEN 'fechada'
      ELSE 'em_andamento'
    END;

    INSERT INTO audit_voucher_competencia (
      audit_period_id, operadora,
      vendido_bruto, vendido_count,
      reconhecido_bruto, reconhecido_count,
      pago_bruto, pago_liquido, pago_lotes_count,
      pendente_bruto, pendente_count,
      taxa_real_pct, taxa_estimada_pct, taxa_efetiva_consolidada_pct,
      status, calculado_em
    ) VALUES (
      p_period_id, v_op,
      v_vendido_bruto, v_vendido_count,
      v_reconhecido_bruto, v_reconhecido_count,
      v_pago_bruto, v_pago_liquido, v_pago_lotes_count,
      v_pendente_bruto, v_pendente_count,
      v_taxa_real_pct, v_taxa_estimada_pct, v_taxa_efetiva_pct,
      v_status, now()
    )
    ON CONFLICT (audit_period_id, operadora) DO UPDATE SET
      vendido_bruto = EXCLUDED.vendido_bruto,
      vendido_count = EXCLUDED.vendido_count,
      reconhecido_bruto = EXCLUDED.reconhecido_bruto,
      reconhecido_count = EXCLUDED.reconhecido_count,
      pago_bruto = EXCLUDED.pago_bruto,
      pago_liquido = EXCLUDED.pago_liquido,
      pago_lotes_count = EXCLUDED.pago_lotes_count,
      pendente_bruto = EXCLUDED.pendente_bruto,
      pendente_count = EXCLUDED.pendente_count,
      taxa_real_pct = EXCLUDED.taxa_real_pct,
      taxa_estimada_pct = EXCLUDED.taxa_estimada_pct,
      taxa_efetiva_consolidada_pct = EXCLUDED.taxa_efetiva_consolidada_pct,
      status = EXCLUDED.status,
      calculado_em = now();

    v_op_resultado := jsonb_build_object(
      'operadora', v_op,
      'vendido', v_vendido_bruto,
      'reconhecido', v_reconhecido_bruto,
      'pago', v_pago_liquido,
      'pendente', v_pendente_bruto,
      'taxa_consolidada', v_taxa_efetiva_pct,
      'status', v_status
    );
    v_resultado := v_resultado || v_op_resultado;
  END LOOP;

  RETURN jsonb_build_object('operadoras', v_resultado, 'periodo_id', p_period_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_voucher_audit(uuid) TO authenticated;