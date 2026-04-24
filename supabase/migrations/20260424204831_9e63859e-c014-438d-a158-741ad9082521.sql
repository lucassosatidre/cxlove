-- 1) Vínculo de depósitos ao arquivo de importação + status de match
ALTER TABLE public.audit_bank_deposits
  ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES public.audit_imports(id) ON DELETE CASCADE;

ALTER TABLE public.audit_bank_deposits
  ADD COLUMN IF NOT EXISTS match_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.audit_bank_deposits
  ADD COLUMN IF NOT EXISTS match_confidence numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_bank_deposits_match_status_check'
  ) THEN
    ALTER TABLE public.audit_bank_deposits
      ADD CONSTRAINT audit_bank_deposits_match_status_check
      CHECK (match_status IN ('pending','matched','fora_periodo','nao_identificado'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_audit_bank_deposits_import_id
  ON public.audit_bank_deposits(import_id);

CREATE INDEX IF NOT EXISTS idx_audit_bank_deposits_period_bank_cat
  ON public.audit_bank_deposits(audit_period_id, bank, category);

-- 2) RPC de totais do período: precisa DROP por mudança de assinatura
DROP FUNCTION IF EXISTS public.get_audit_period_totals(uuid);

CREATE FUNCTION public.get_audit_period_totals(p_period_id uuid)
RETURNS TABLE (
  total_bruto numeric,
  total_liquido_declarado numeric,
  total_liquido_ifood numeric,
  total_bruto_ifood numeric,
  total_taxa_declarada numeric,
  total_promocao numeric,
  total_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(gross_amount), 0)                                                AS total_bruto,
    COALESCE(SUM(net_amount), 0)                                                  AS total_liquido_declarado,
    COALESCE(SUM(net_amount)   FILTER (WHERE deposit_group = 'ifood'), 0)         AS total_liquido_ifood,
    COALESCE(SUM(gross_amount) FILTER (WHERE deposit_group = 'ifood'), 0)         AS total_bruto_ifood,
    COALESCE(SUM(tax_amount), 0)                                                  AS total_taxa_declarada,
    COALESCE(SUM(promotion_amount), 0)                                            AS total_promocao,
    COUNT(*)                                                                      AS total_count
  FROM public.audit_card_transactions
  WHERE audit_period_id = p_period_id
$$;

-- 3) Classificação FIFO de depósitos voucher (BB)
CREATE OR REPLACE FUNCTION public.classify_voucher_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company text;
  v_sold_total numeric;
  v_cumulative numeric;
  v_deposit record;
BEGIN
  UPDATE public.audit_bank_deposits
     SET match_status = 'pending', match_confidence = NULL
   WHERE audit_period_id = p_period_id
     AND bank = 'bb'
     AND category IN ('alelo','ticket','pluxee','vr');

  FOR v_company IN
    SELECT DISTINCT category FROM public.audit_bank_deposits
     WHERE audit_period_id = p_period_id
       AND bank = 'bb'
       AND category IN ('alelo','ticket','pluxee','vr')
  LOOP
    SELECT COALESCE(SUM(gross_amount), 0) INTO v_sold_total
      FROM public.audit_card_transactions
     WHERE audit_period_id = p_period_id
       AND deposit_group = v_company;

    v_cumulative := 0;

    FOR v_deposit IN
      SELECT id, amount FROM public.audit_bank_deposits
       WHERE audit_period_id = p_period_id
         AND bank = 'bb'
         AND category = v_company
       ORDER BY deposit_date ASC, created_at ASC, id ASC
    LOOP
      IF v_cumulative + v_deposit.amount <= v_sold_total + 0.01 THEN
        UPDATE public.audit_bank_deposits
           SET match_status = 'matched', match_confidence = 1.0
         WHERE id = v_deposit.id;
        v_cumulative := v_cumulative + v_deposit.amount;
      ELSE
        UPDATE public.audit_bank_deposits
           SET match_status = 'fora_periodo', match_confidence = 0.5
         WHERE id = v_deposit.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- 4) Classificação iFood (Cresol): casa por data esperada de depósito
CREATE OR REPLACE FUNCTION public.classify_ifood_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_month integer;
  v_period_year  integer;
  v_period_start date;
  v_period_end   date;
  v_dep record;
  v_expected numeric;
  v_diff numeric;
  v_tolerance numeric;
BEGIN
  SELECT month, year INTO v_period_month, v_period_year
    FROM public.audit_periods WHERE id = p_period_id;

  IF v_period_month IS NULL THEN RETURN; END IF;

  v_period_start := make_date(v_period_year, v_period_month, 1);
  v_period_end   := (v_period_start + INTERVAL '1 month - 1 day')::date;

  UPDATE public.audit_bank_deposits
     SET match_status = 'pending', match_confidence = NULL
   WHERE audit_period_id = p_period_id
     AND bank = 'cresol'
     AND category = 'ifood';

  FOR v_dep IN
    SELECT id, deposit_date, amount
      FROM public.audit_bank_deposits
     WHERE audit_period_id = p_period_id
       AND bank = 'cresol'
       AND category = 'ifood'
  LOOP
    SELECT COALESCE(SUM(net_amount), 0) INTO v_expected
      FROM public.audit_card_transactions
     WHERE audit_period_id = p_period_id
       AND deposit_group = 'ifood'
       AND expected_deposit_date = v_dep.deposit_date;

    v_tolerance := GREATEST(5.0, ABS(v_expected) * 0.01);
    v_diff := ABS(v_dep.amount - v_expected);

    IF v_expected > 0 AND v_diff <= v_tolerance THEN
      UPDATE public.audit_bank_deposits
         SET match_status = 'matched',
             match_confidence = 1.0 - LEAST(1.0, v_diff / NULLIF(v_expected,0))
       WHERE id = v_dep.id;
    ELSIF v_dep.deposit_date < v_period_start
       OR v_dep.deposit_date > (v_period_end + INTERVAL '15 days')::date THEN
      UPDATE public.audit_bank_deposits
         SET match_status = 'fora_periodo', match_confidence = 0.4
       WHERE id = v_dep.id;
    ELSE
      UPDATE public.audit_bank_deposits
         SET match_status = 'nao_identificado', match_confidence = 0.0
       WHERE id = v_dep.id;
    END IF;
  END LOOP;
END;
$$;