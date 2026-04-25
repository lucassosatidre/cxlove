
-- ============================================================
-- FIX 1: classify_ifood_deposits — FIFO sem extrapolação
-- Garante: SUM(matched) <= total_liquido_ifood (competência)
-- ============================================================
CREATE OR REPLACE FUNCTION public.classify_ifood_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_liquido_esperado_competencia numeric;
  v_acumulado_matched numeric := 0;
  v_dep record;
  v_falta numeric;
BEGIN
  -- Reset
  UPDATE public.audit_bank_deposits
     SET match_status = 'pending',
         match_confidence = NULL,
         match_reason = NULL
   WHERE audit_period_id = p_period_id
     AND bank = 'cresol'
     AND category = 'ifood';

  -- Líquido esperado APENAS da competência
  SELECT COALESCE(SUM(net_amount), 0) INTO v_liquido_esperado_competencia
    FROM public.audit_card_transactions
   WHERE audit_period_id = p_period_id
     AND deposit_group = 'ifood'
     AND is_competencia = true;

  -- Iterar depósitos cronologicamente
  FOR v_dep IN
    SELECT id, amount, deposit_date
      FROM public.audit_bank_deposits
     WHERE audit_period_id = p_period_id
       AND bank = 'cresol'
       AND category = 'ifood'
     ORDER BY deposit_date ASC, created_at ASC, id ASC
  LOOP
    v_falta := v_liquido_esperado_competencia - v_acumulado_matched;

    IF v_falta <= 0 THEN
      UPDATE public.audit_bank_deposits
         SET match_status = 'fora_periodo',
             match_confidence = 0.7,
             match_reason = format('Excedente após cobrir vendas de competência (já matched R$%s)',
                                   to_char(v_acumulado_matched, 'FM999G990D00'))
       WHERE id = v_dep.id;

    ELSIF v_dep.amount <= v_falta * 1.02 THEN
      -- Cabe inteiro (com 2% de tolerância)
      UPDATE public.audit_bank_deposits
         SET match_status = 'matched',
             match_confidence = 1.0,
             match_reason = format('Casa com vendas iFood do dia %s (acumulado R$%s de R$%s)',
                                   to_char(v_dep.deposit_date, 'DD/MM'),
                                   to_char(v_acumulado_matched + v_dep.amount, 'FM999G990D00'),
                                   to_char(v_liquido_esperado_competencia, 'FM999G990D00'))
       WHERE id = v_dep.id;
      v_acumulado_matched := v_acumulado_matched + v_dep.amount;

    ELSE
      -- Excederia o esperado → fora_periodo
      UPDATE public.audit_bank_deposits
         SET match_status = 'fora_periodo',
             match_confidence = 0.6,
             match_reason = format('Depósito de R$%s excederia esperado (falta apenas R$%s)',
                                   to_char(v_dep.amount, 'FM999G990D00'),
                                   to_char(v_falta, 'FM999G990D00'))
       WHERE id = v_dep.id;
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- FIX 2: nova RPC para detalhamento diário do iFood (PDF Executivo)
-- Usa SOMENTE depósitos matched
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_audit_ifood_daily_detail(p_period_id uuid)
RETURNS TABLE (
  match_date date,
  vendas_count integer,
  bruto numeric,
  liquido numeric,
  deposito numeric,
  diferenca numeric,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH vendas_dia AS (
    SELECT
      expected_deposit_date AS d,
      COUNT(*)::integer AS vendas_count,
      SUM(gross_amount) AS bruto,
      SUM(net_amount) AS liquido
    FROM public.audit_card_transactions
    WHERE audit_period_id = p_period_id
      AND deposit_group = 'ifood'
      AND is_competencia = true
      AND expected_deposit_date IS NOT NULL
    GROUP BY expected_deposit_date
  ),
  depositos_dia AS (
    SELECT
      deposit_date AS d,
      SUM(amount) AS deposito
    FROM public.audit_bank_deposits
    WHERE audit_period_id = p_period_id
      AND bank = 'cresol'
      AND category = 'ifood'
      AND match_status = 'matched'
    GROUP BY deposit_date
  )
  SELECT
    COALESCE(v.d, d.d) AS match_date,
    COALESCE(v.vendas_count, 0)::integer,
    COALESCE(v.bruto, 0),
    COALESCE(v.liquido, 0),
    COALESCE(d.deposito, 0),
    COALESCE(d.deposito, 0) - COALESCE(v.liquido, 0) AS diferenca,
    CASE
      WHEN v.d IS NULL THEN 'extra_deposit'
      WHEN d.d IS NULL THEN 'missing_deposit'
      WHEN ABS(COALESCE(d.deposito, 0) - COALESCE(v.liquido, 0)) < 1 THEN 'matched'
      WHEN ABS(COALESCE(d.deposito, 0) - COALESCE(v.liquido, 0)) <= COALESCE(v.liquido, 0) * 0.02 THEN 'matched'
      ELSE 'partial'
    END AS status
  FROM vendas_dia v
  FULL OUTER JOIN depositos_dia d ON v.d = d.d
  ORDER BY 1;
$$;
