-- Estágio 2 da auditoria — overrides manuais de taxa por competência.
CREATE TABLE public.audit_voucher_lot_competencia_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES public.audit_voucher_lots(id) ON DELETE CASCADE,
  year int NOT NULL,
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  taxa_competencia numeric(12,2) NOT NULL CHECK (taxa_competencia >= 0),
  note text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lot_id, year, month)
);

CREATE INDEX idx_voucher_lot_comp_ovr_lot ON public.audit_voucher_lot_competencia_overrides(lot_id);
CREATE INDEX idx_voucher_lot_comp_ovr_period ON public.audit_voucher_lot_competencia_overrides(year, month);

ALTER TABLE public.audit_voucher_lot_competencia_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage voucher_lot_competencia_overrides"
  ON public.audit_voucher_lot_competencia_overrides
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.touch_voucher_lot_comp_ovr_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_voucher_lot_comp_ovr_updated_at
  BEFORE UPDATE ON public.audit_voucher_lot_competencia_overrides
  FOR EACH ROW EXECUTE FUNCTION public.touch_voucher_lot_comp_ovr_updated_at();