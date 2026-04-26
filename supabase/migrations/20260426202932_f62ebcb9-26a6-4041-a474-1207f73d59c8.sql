-- ============================================================================
-- VOUCHER SETTLEMENTS: Importação de extratos das operadoras
-- ============================================================================

-- Lotes/guias/reembolsos das operadoras (1 linha por lote)
CREATE TABLE public.voucher_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  operadora text NOT NULL CHECK (operadora IN ('alelo','ticket','pluxee','vr')),
  external_id text NOT NULL,
  data_corte date,
  data_pagamento date NOT NULL,
  gross_amount numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  fee_total numeric GENERATED ALWAYS AS (gross_amount - net_amount) STORED,
  fee_admin numeric DEFAULT 0,
  fee_anticipation numeric DEFAULT 0,
  fee_management numeric DEFAULT 0,
  fee_other numeric DEFAULT 0,
  modalidade text,
  status text NOT NULL DEFAULT 'imported',
  bb_deposit_id uuid REFERENCES public.audit_bank_deposits(id) ON DELETE SET NULL,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_period_id, operadora, external_id)
);

-- Transações dentro de cada lote
CREATE TABLE public.voucher_lot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.voucher_lots(id) ON DELETE CASCADE,
  data_transacao date NOT NULL,
  gross_amount numeric NOT NULL,
  net_amount numeric,
  authorization_code text,
  card_number text,
  modalidade text,
  maquinona_match_id uuid REFERENCES public.audit_card_transactions(id) ON DELETE SET NULL,
  match_status text NOT NULL DEFAULT 'pending'
);

-- Tarifas avulsas
CREATE TABLE public.voucher_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  operadora text NOT NULL CHECK (operadora IN ('alelo','ticket','pluxee','vr')),
  data date NOT NULL,
  descricao text NOT NULL,
  valor numeric NOT NULL,
  tipo text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Controle de importações
CREATE TABLE public.voucher_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  operadora text NOT NULL,
  file_name text NOT NULL,
  imported_lots integer NOT NULL DEFAULT 0,
  imported_items integer NOT NULL DEFAULT 0,
  imported_adjustments integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed',
  imported_by uuid,
  imported_at timestamptz NOT NULL DEFAULT now()
);

-- Índices
CREATE INDEX idx_voucher_lots_period ON public.voucher_lots(audit_period_id, operadora);
CREATE INDEX idx_voucher_lots_payment_date ON public.voucher_lots(data_pagamento);
CREATE INDEX idx_voucher_lot_items_lot ON public.voucher_lot_items(lot_id);
CREATE INDEX idx_voucher_lot_items_match ON public.voucher_lot_items(match_status);
CREATE INDEX idx_voucher_adjustments_period ON public.voucher_adjustments(audit_period_id, operadora);
CREATE INDEX idx_voucher_imports_period ON public.voucher_imports(audit_period_id, operadora);

-- RLS admin-only
ALTER TABLE public.voucher_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_lot_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage voucher_lots" ON public.voucher_lots
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage voucher_lot_items" ON public.voucher_lot_items
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage voucher_adjustments" ON public.voucher_adjustments
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins manage voucher_imports" ON public.voucher_imports
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================================
-- RPC: match_voucher_lots
-- ============================================================================
CREATE OR REPLACE FUNCTION public.match_voucher_lots(p_period_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_matched_items integer := 0;
  v_unmatched_items integer := 0;
  v_matched_lots integer := 0;
  v_unmatched_lots integer := 0;
BEGIN
  -- Reset
  UPDATE voucher_lot_items i
    SET maquinona_match_id = NULL, match_status = 'pending'
    FROM voucher_lots l
    WHERE i.lot_id = l.id AND l.audit_period_id = p_period_id;

  UPDATE voucher_lots
    SET status = 'imported', bb_deposit_id = NULL
    WHERE audit_period_id = p_period_id;

  -- Match items (operadora + data + valor) com tolerância R$ 0,01
  WITH candidates AS (
    SELECT i.id AS item_id, ct.id AS ct_id,
           row_number() OVER (PARTITION BY i.id ORDER BY ct.created_at) AS rn,
           count(*) OVER (PARTITION BY i.id) AS cnt
    FROM voucher_lot_items i
    JOIN voucher_lots l ON l.id = i.lot_id
    JOIN audit_card_transactions ct
      ON ct.audit_period_id = p_period_id
     AND ct.deposit_group = l.operadora
     AND ct.sale_date = i.data_transacao
     AND abs(ct.gross_amount - i.gross_amount) <= 0.01
    WHERE l.audit_period_id = p_period_id
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
     AND l.audit_period_id = p_period_id
     AND i.match_status = 'pending';

  -- Match lotes com depósitos BB
  WITH bb_candidates AS (
    SELECT l.id AS lot_id, d.id AS dep_id,
           row_number() OVER (PARTITION BY l.id ORDER BY abs(d.amount - l.net_amount), d.created_at) AS rn
    FROM voucher_lots l
    JOIN audit_bank_deposits d
      ON d.audit_period_id = p_period_id
     AND d.bank = 'bb'
     AND d.category = l.operadora
     AND d.deposit_date = l.data_pagamento
     AND abs(d.amount - l.net_amount) <= 0.50
    WHERE l.audit_period_id = p_period_id
  )
  UPDATE voucher_lots l
     SET bb_deposit_id = c.dep_id, status = 'bb_matched'
    FROM bb_candidates c
   WHERE c.lot_id = l.id AND c.rn = 1;

  UPDATE voucher_lots
     SET status = 'bb_unmatched'
   WHERE audit_period_id = p_period_id AND bb_deposit_id IS NULL;

  SELECT
    count(*) FILTER (WHERE i.match_status = 'matched'),
    count(*) FILTER (WHERE i.match_status IN ('unmatched','ambiguous'))
  INTO v_matched_items, v_unmatched_items
  FROM voucher_lot_items i
  JOIN voucher_lots l ON l.id = i.lot_id
  WHERE l.audit_period_id = p_period_id;

  SELECT
    count(*) FILTER (WHERE status = 'bb_matched'),
    count(*) FILTER (WHERE status = 'bb_unmatched')
  INTO v_matched_lots, v_unmatched_lots
  FROM voucher_lots
  WHERE audit_period_id = p_period_id;

  RETURN jsonb_build_object(
    'matched_items', v_matched_items,
    'unmatched_items', v_unmatched_items,
    'matched_lots', v_matched_lots,
    'unmatched_lots', v_unmatched_lots
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_voucher_lots(uuid) TO authenticated;