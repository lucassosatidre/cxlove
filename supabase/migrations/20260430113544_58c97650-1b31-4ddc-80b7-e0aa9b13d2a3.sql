-- Estágio 2 da auditoria — schema novo pra match Maquinona × operadora × BB.
DROP FUNCTION IF EXISTS public.match_voucher_lots_v2(uuid);
DROP FUNCTION IF EXISTS public.calculate_voucher_audit(uuid);
DROP FUNCTION IF EXISTS public.classify_voucher_deposits(uuid);
DROP TABLE IF EXISTS public.voucher_expected_rates CASCADE;
DROP TABLE IF EXISTS public.voucher_adjustments CASCADE;
DROP TABLE IF EXISTS public.voucher_ai_audits CASCADE;

CREATE TABLE public.audit_voucher_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  operadora text NOT NULL CHECK (operadora IN ('ticket', 'alelo', 'pluxee', 'vr')),
  numero_reembolso text NOT NULL,
  numero_contrato text,
  produto text,
  data_corte date,
  data_credito date NOT NULL,
  subtotal_vendas numeric(12,2) NOT NULL DEFAULT 0,
  total_descontos numeric(12,2) NOT NULL DEFAULT 0,
  valor_liquido numeric(12,2) NOT NULL,
  descontos jsonb,
  bb_deposit_id uuid REFERENCES public.audit_bank_deposits(id) ON DELETE SET NULL,
  diff numeric(12,2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'partial')),
  manual boolean NOT NULL DEFAULT false,
  import_id uuid REFERENCES public.audit_imports(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audit_period_id, operadora, numero_reembolso)
);

CREATE INDEX idx_voucher_lots_period ON public.audit_voucher_lots(audit_period_id);
CREATE INDEX idx_voucher_lots_operadora ON public.audit_voucher_lots(operadora);
CREATE INDEX idx_voucher_lots_data_credito ON public.audit_voucher_lots(data_credito);
CREATE INDEX idx_voucher_lots_bb_deposit ON public.audit_voucher_lots(bb_deposit_id);

ALTER TABLE public.audit_voucher_lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage audit_voucher_lots" ON public.audit_voucher_lots
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.audit_voucher_lot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.audit_voucher_lots(id) ON DELETE CASCADE,
  data_transacao date NOT NULL,
  data_postagem date,
  numero_documento text,
  numero_cartao_mascarado text,
  valor numeric(12,2) NOT NULL,
  estabelecimento text,
  cnpj text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_voucher_lot_items_lot ON public.audit_voucher_lot_items(lot_id);
CREATE INDEX idx_voucher_lot_items_data ON public.audit_voucher_lot_items(data_transacao);

ALTER TABLE public.audit_voucher_lot_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage audit_voucher_lot_items" ON public.audit_voucher_lot_items
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE public.audit_imports
  DROP CONSTRAINT IF EXISTS audit_imports_file_type_check;

ALTER TABLE public.audit_imports
  ADD CONSTRAINT audit_imports_file_type_check
  CHECK (file_type IN ('maquinona', 'cresol', 'bb', 'ticket', 'alelo', 'pluxee', 'vr'));