-- 1. Add match_reason to audit_bank_deposits
ALTER TABLE public.audit_bank_deposits
  ADD COLUMN IF NOT EXISTS match_reason text;

-- 2. Update classify_voucher_deposits to fill match_reason and auto-classify brendi/outro
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
  -- Reset all BB classifications
  UPDATE public.audit_bank_deposits
     SET match_status = 'pending',
         match_confidence = NULL,
         match_reason = NULL
   WHERE audit_period_id = p_period_id
     AND bank = 'bb';

  -- Auto-classify brendi as fora_periodo (not audited yet)
  UPDATE public.audit_bank_deposits
     SET match_status = 'fora_periodo',
         match_confidence = 0.5,
         match_reason = 'Brendi (marketplace) — auditoria não implementada'
   WHERE audit_period_id = p_period_id
     AND bank = 'bb'
     AND category = 'brendi';

  -- Auto-classify "outro" as nao_identificado
  UPDATE public.audit_bank_deposits
     SET match_status = 'nao_identificado',
         match_confidence = 0.0,
         match_reason = 'Categoria "outro" — não vinculado a vendas auditadas'
   WHERE audit_period_id = p_period_id
     AND bank = 'bb'
     AND (category IS NULL OR category = 'outro');

  -- FIFO match for known voucher companies
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
      IF v_cumulative + v_deposit.amount <= v_sold_total + 1.0 THEN
        UPDATE public.audit_bank_deposits
           SET match_status = 'matched',
               match_confidence = 1.0,
               match_reason = FORMAT('FIFO: acumulado R$%s de R$%s vendidos',
                                     to_char(v_cumulative + v_deposit.amount, 'FM999G990D00'),
                                     to_char(v_sold_total, 'FM999G990D00'))
         WHERE id = v_deposit.id;
        v_cumulative := v_cumulative + v_deposit.amount;
      ELSE
        UPDATE public.audit_bank_deposits
           SET match_status = 'fora_periodo',
               match_confidence = 0.5,
               match_reason = FORMAT('Excede total vendido: já acumulado R$%s de R$%s',
                                     to_char(v_cumulative, 'FM999G990D00'),
                                     to_char(v_sold_total, 'FM999G990D00'))
         WHERE id = v_deposit.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- 3. Update classify_ifood_deposits to fill match_reason
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
     SET match_status = 'pending',
         match_confidence = NULL,
         match_reason = NULL
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
             match_confidence = 1.0 - LEAST(1.0, v_diff / NULLIF(v_expected,0)),
             match_reason = FORMAT('Match por data: vendas esperadas em %s = R$%s',
                                   to_char(v_dep.deposit_date, 'DD/MM'),
                                   to_char(v_expected, 'FM999G990D00'))
       WHERE id = v_dep.id;
    ELSIF v_dep.deposit_date < v_period_start THEN
      UPDATE public.audit_bank_deposits
         SET match_status = 'fora_periodo',
             match_confidence = 0.4,
             match_reason = 'Antes do mês de competência'
       WHERE id = v_dep.id;
    ELSIF v_dep.deposit_date > (v_period_end + INTERVAL '15 days')::date THEN
      UPDATE public.audit_bank_deposits
         SET match_status = 'fora_periodo',
             match_confidence = 0.4,
             match_reason = 'Após janela de competência (>15d)'
       WHERE id = v_dep.id;
    ELSE
      UPDATE public.audit_bank_deposits
         SET match_status = 'nao_identificado',
             match_confidence = 0.0,
             match_reason = FORMAT('Sem venda iFood com data esperada %s (esperado R$%s, recebido R$%s)',
                                   to_char(v_dep.deposit_date, 'DD/MM'),
                                   to_char(v_expected, 'FM999G990D00'),
                                   to_char(v_dep.amount, 'FM999G990D00'))
       WHERE id = v_dep.id;
    END IF;
  END LOOP;
END;
$$;

-- 4. Update get_audit_period_deposits to also return match_status
DROP FUNCTION IF EXISTS public.get_audit_period_deposits(uuid);
CREATE OR REPLACE FUNCTION public.get_audit_period_deposits(p_period_id uuid)
RETURNS TABLE(category text, bank text, match_status text, total_amount numeric, deposit_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    category,
    bank,
    match_status,
    COALESCE(SUM(amount), 0) AS total_amount,
    COUNT(*) AS deposit_count
  FROM public.audit_bank_deposits
  WHERE audit_period_id = p_period_id
  GROUP BY category, bank, match_status
$$;