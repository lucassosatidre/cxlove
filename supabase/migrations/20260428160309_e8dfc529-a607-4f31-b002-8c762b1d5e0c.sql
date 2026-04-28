-- ============================================================
-- RESET COMPLETO DO MÓDULO VOUCHER (voucher_module_reset)
-- Mantém: voucher_lots, voucher_lot_items, voucher_imports (schema novo)
-- Apaga: tudo o resto (funções, tabelas auxiliares, dados)
-- ============================================================

-- 1. DROP funções voucher (CASCADE pra dependências)
DROP FUNCTION IF EXISTS public.match_voucher_lots_v2(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.match_voucher_lots(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.classify_voucher_deposits(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.calculate_voucher_audit(uuid) CASCADE;

-- 2. DROP tabelas auxiliares (audit_voucher_competencia é TABELA, não view)
DROP TABLE IF EXISTS public.audit_voucher_competencia CASCADE;
DROP TABLE IF EXISTS public.voucher_ai_audits CASCADE;
DROP TABLE IF EXISTS public.ifood_ai_audits CASCADE;
DROP TABLE IF EXISTS public.audit_voucher_matches CASCADE;
DROP TABLE IF EXISTS public.voucher_adjustments CASCADE;

-- 3. DROP TABLES principais (recriar com schema novo)
DROP TABLE IF EXISTS public.voucher_lot_items CASCADE;
DROP TABLE IF EXISTS public.voucher_lots CASCADE;
DROP TABLE IF EXISTS public.voucher_imports CASCADE;

-- 4. RECRIAR voucher_imports
CREATE TABLE public.voucher_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  operadora text NOT NULL CHECK (operadora IN ('alelo','ticket','pluxee','vr')),
  filename text,
  uploaded_by uuid REFERENCES auth.users(id),
  rows_imported int DEFAULT 0,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success','partial','failed')),
  error_message text,
  raw_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_voucher_imports_period ON public.voucher_imports(audit_period_id, operadora);

-- 5. RECRIAR voucher_lots
CREATE TABLE public.voucher_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  voucher_import_id uuid REFERENCES public.voucher_imports(id) ON DELETE SET NULL,
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
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_period_id, operadora, external_id)
);
CREATE INDEX idx_voucher_lots_period_op ON public.voucher_lots(audit_period_id, operadora);
CREATE INDEX idx_voucher_lots_data_pagamento ON public.voucher_lots(data_pagamento);

-- 6. RECRIAR voucher_lot_items
CREATE TABLE public.voucher_lot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.voucher_lots(id) ON DELETE CASCADE,
  external_id text,
  data_transacao date NOT NULL,
  gross_amount numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_voucher_lot_items_lot ON public.voucher_lot_items(lot_id);
CREATE INDEX idx_voucher_lot_items_data ON public.voucher_lot_items(data_transacao);

-- 7. RLS
ALTER TABLE public.voucher_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_lot_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read voucher_imports" ON public.voucher_imports
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role writes voucher_imports" ON public.voucher_imports
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read voucher_lots" ON public.voucher_lots
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role writes voucher_lots" ON public.voucher_lots
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read voucher_lot_items" ON public.voucher_lot_items
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Service role writes voucher_lot_items" ON public.voucher_lot_items
  FOR ALL USING (true) WITH CHECK (true);