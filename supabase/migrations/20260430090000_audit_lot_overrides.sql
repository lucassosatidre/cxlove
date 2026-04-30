-- Overrides manuais de match (sale_date × tipo) → depósito Cresol específico.
-- Usado quando o algoritmo D+1 erra (estornos, depósitos atípicos, etc) e o
-- auditor quer pareamento manual sem mexer no algoritmo.
--
-- O run-audit-match lê esta tabela ANTES do match automático: pra cada
-- (sale_date, tipo) com override, usa cresol_deposit_id especificado e exclui
-- esse dep do pool de candidatos pro algoritmo.

CREATE TABLE public.audit_lot_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  sale_date date NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('PIX', 'CARD')),
  -- NULL = "marcar como sem match" intencional (auditor confirma que esse lote
  -- não tem cresol correspondente — ex: estorno completo).
  cresol_deposit_id uuid REFERENCES public.audit_bank_deposits(id) ON DELETE SET NULL,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(audit_period_id, sale_date, tipo)
);

ALTER TABLE public.audit_lot_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage audit_lot_overrides"
  ON public.audit_lot_overrides FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_audit_lot_overrides_period ON public.audit_lot_overrides(audit_period_id);

CREATE OR REPLACE FUNCTION public.update_audit_lot_overrides_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_lot_overrides_updated
  BEFORE UPDATE ON public.audit_lot_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_audit_lot_overrides_updated_at();
