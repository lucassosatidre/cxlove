-- 1) Coluna is_competencia
ALTER TABLE public.audit_card_transactions
ADD COLUMN IF NOT EXISTS is_competencia boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_card_tx_competencia
  ON public.audit_card_transactions(audit_period_id, is_competencia);

-- Backfill por data x período
UPDATE public.audit_card_transactions tx
SET is_competencia = (
  EXTRACT(MONTH FROM tx.sale_date)::int = p.month
  AND EXTRACT(YEAR FROM tx.sale_date)::int = p.year
)
FROM public.audit_periods p
WHERE p.id = tx.audit_period_id;

-- 2) get_audit_period_totals: filtra por competência
CREATE OR REPLACE FUNCTION public.get_audit_period_totals(p_period_id uuid)
RETURNS TABLE(
  total_bruto numeric,
  total_liquido_declarado numeric,
  total_liquido_ifood numeric,
  total_bruto_ifood numeric,
  total_taxa_declarada numeric,
  total_promocao numeric,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
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
    AND is_competencia = true
$$;

-- 3) get_audit_contabil_breakdown: filtra por competência
CREATE OR REPLACE FUNCTION public.get_audit_contabil_breakdown(p_period_id uuid)
RETURNS TABLE(categoria text, dia integer, qtd bigint, bruto numeric, liquido numeric, taxa numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    CASE
      WHEN payment_method ILIKE 'credito' OR payment_method ILIKE 'crédito' THEN 'credito'
      WHEN payment_method ILIKE 'debito' OR payment_method ILIKE 'débito' THEN 'debito'
      WHEN payment_method ILIKE 'pix' THEN 'pix'
      WHEN payment_method ILIKE 'voucher' AND UPPER(COALESCE(brand, '')) = 'ALELO' THEN 'alelo'
      WHEN payment_method ILIKE 'voucher' AND UPPER(COALESCE(brand, '')) = 'TICKET' THEN 'ticket'
      WHEN payment_method ILIKE 'voucher' AND UPPER(COALESCE(brand, '')) = 'VR' THEN 'vr'
      WHEN payment_method ILIKE 'voucher' AND UPPER(COALESCE(brand, '')) IN ('SODEXO', 'PLUXEE') THEN 'pluxee'
      ELSE 'outro'
    END AS categoria,
    EXTRACT(DAY FROM sale_date)::integer AS dia,
    COUNT(*) AS qtd,
    COALESCE(SUM(gross_amount), 0) AS bruto,
    COALESCE(SUM(net_amount), 0) AS liquido,
    COALESCE(SUM(tax_amount), 0) AS taxa
  FROM public.audit_card_transactions
  WHERE audit_period_id = p_period_id
    AND is_competencia = true
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

-- 4) classify_ifood_deposits
CREATE OR REPLACE FUNCTION public.classify_ifood_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dep record;
  v_expected_comp numeric;
  v_expected_adj numeric;
  v_diff numeric;
  v_tolerance numeric;
BEGIN
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
    SELECT COALESCE(SUM(net_amount), 0) INTO v_expected_comp
      FROM public.audit_card_transactions
     WHERE audit_period_id = p_period_id
       AND deposit_group = 'ifood'
       AND expected_deposit_date = v_dep.deposit_date
       AND is_competencia = true;

    SELECT COALESCE(SUM(net_amount), 0) INTO v_expected_adj
      FROM public.audit_card_transactions
     WHERE audit_period_id = p_period_id
       AND deposit_group = 'ifood'
       AND expected_deposit_date = v_dep.deposit_date
       AND is_competencia = false;

    IF v_expected_comp > 0 THEN
      v_tolerance := GREATEST(5.0, ABS(v_expected_comp) * 0.01);
      v_diff := ABS(v_dep.amount - v_expected_comp);
      IF v_diff <= v_tolerance THEN
        UPDATE public.audit_bank_deposits
           SET match_status = 'matched',
               match_confidence = 1.0 - LEAST(1.0, v_diff / NULLIF(v_expected_comp,0)),
               match_reason = FORMAT('Casa com vendas do mês de competência em %s (R$%s)',
                                     to_char(v_dep.deposit_date, 'DD/MM'),
                                     to_char(v_expected_comp, 'FM999G990D00'))
         WHERE id = v_dep.id;
      ELSE
        UPDATE public.audit_bank_deposits
           SET match_status = 'nao_identificado',
               match_confidence = 0.0,
               match_reason = FORMAT('Divergência: esperado R$%s da competência, recebido R$%s',
                                     to_char(v_expected_comp, 'FM999G990D00'),
                                     to_char(v_dep.amount, 'FM999G990D00'))
         WHERE id = v_dep.id;
      END IF;
    ELSIF v_expected_adj > 0 THEN
      UPDATE public.audit_bank_deposits
         SET match_status = 'fora_periodo',
             match_confidence = 0.6,
             match_reason = FORMAT('Casa com vendas de mês adjacente em %s (R$%s) — fora da competência',
                                   to_char(v_dep.deposit_date, 'DD/MM'),
                                   to_char(v_expected_adj, 'FM999G990D00'))
       WHERE id = v_dep.id;
    ELSE
      UPDATE public.audit_bank_deposits
         SET match_status = 'nao_identificado',
             match_confidence = 0.0,
             match_reason = FORMAT('Sem venda iFood com data esperada %s (recebido R$%s)',
                                   to_char(v_dep.deposit_date, 'DD/MM'),
                                   to_char(v_dep.amount, 'FM999G990D00'))
       WHERE id = v_dep.id;
    END IF;
  END LOOP;
END;
$$;

-- 5) classify_voucher_deposits: FIFO com cumulative tracking, considerando competência
CREATE OR REPLACE FUNCTION public.classify_voucher_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company text;
  v_dep record;
  v_dep_remaining numeric;
  v_consumed numeric;
  v_consumed_comp numeric;
  v_consumed_adj numeric;
  v_total_consumed numeric;
  -- Arrays paralelos de vendas
  v_sale_amounts numeric[];
  v_sale_iscomp boolean[];
  v_total_sales int;
  v_sale_idx int;
  v_sale_remaining numeric;
BEGIN
  -- Reset
  UPDATE public.audit_bank_deposits
     SET match_status = 'pending',
         match_confidence = NULL,
         match_reason = NULL
   WHERE audit_period_id = p_period_id
     AND bank = 'bb';

  -- Brendi/outro fora de auditoria
  UPDATE public.audit_bank_deposits
     SET match_status = 'fora_periodo',
         match_confidence = 0.5,
         match_reason = 'Brendi (marketplace) — auditoria não implementada'
   WHERE audit_period_id = p_period_id
     AND bank = 'bb'
     AND category = 'brendi';

  UPDATE public.audit_bank_deposits
     SET match_status = 'nao_identificado',
         match_confidence = 0.0,
         match_reason = 'Categoria "outro" — não vinculado a vendas auditadas'
   WHERE audit_period_id = p_period_id
     AND bank = 'bb'
     AND (category IS NULL OR category = 'outro');

  FOR v_company IN
    SELECT DISTINCT category FROM public.audit_bank_deposits
     WHERE audit_period_id = p_period_id
       AND bank = 'bb'
       AND category IN ('alelo','ticket','pluxee','vr')
  LOOP
    -- Carrega vendas em arrays paralelos, ordenadas cronologicamente
    SELECT
      COALESCE(array_agg(gross_amount ORDER BY sale_date, created_at, id), ARRAY[]::numeric[]),
      COALESCE(array_agg(is_competencia ORDER BY sale_date, created_at, id), ARRAY[]::boolean[])
    INTO v_sale_amounts, v_sale_iscomp
    FROM public.audit_card_transactions
    WHERE audit_period_id = p_period_id
      AND deposit_group = v_company;

    v_total_sales := COALESCE(array_length(v_sale_amounts, 1), 0);

    IF v_total_sales = 0 THEN
      UPDATE public.audit_bank_deposits
         SET match_status = 'fora_periodo',
             match_confidence = 0.3,
             match_reason = 'Sem vendas correspondentes para esta empresa'
       WHERE audit_period_id = p_period_id
         AND bank = 'bb'
         AND category = v_company;
      CONTINUE;
    END IF;

    v_sale_idx := 1;
    v_sale_remaining := v_sale_amounts[v_sale_idx];

    FOR v_dep IN
      SELECT id, amount, deposit_date FROM public.audit_bank_deposits
       WHERE audit_period_id = p_period_id
         AND bank = 'bb'
         AND category = v_company
       ORDER BY deposit_date ASC, created_at ASC, id ASC
    LOOP
      v_dep_remaining := v_dep.amount;
      v_consumed_comp := 0;
      v_consumed_adj := 0;

      WHILE v_dep_remaining > 0.001 AND v_sale_idx <= v_total_sales LOOP
        v_consumed := LEAST(v_dep_remaining, v_sale_remaining);
        IF v_sale_iscomp[v_sale_idx] = true THEN
          v_consumed_comp := v_consumed_comp + v_consumed;
        ELSE
          v_consumed_adj := v_consumed_adj + v_consumed;
        END IF;
        v_dep_remaining := v_dep_remaining - v_consumed;
        v_sale_remaining := v_sale_remaining - v_consumed;
        IF v_sale_remaining <= 0.001 THEN
          v_sale_idx := v_sale_idx + 1;
          IF v_sale_idx <= v_total_sales THEN
            v_sale_remaining := v_sale_amounts[v_sale_idx];
          END IF;
        END IF;
      END LOOP;

      v_total_consumed := v_consumed_comp + v_consumed_adj;

      IF v_total_consumed <= 0.001 THEN
        UPDATE public.audit_bank_deposits
           SET match_status = 'fora_periodo',
               match_confidence = 0.3,
               match_reason = 'Excede vendas conhecidas (depósito sem venda correspondente)'
         WHERE id = v_dep.id;
      ELSIF v_consumed_comp >= v_consumed_adj THEN
        UPDATE public.audit_bank_deposits
           SET match_status = 'matched',
               match_confidence = v_consumed_comp / NULLIF(v_total_consumed, 0),
               match_reason = FORMAT('FIFO: R$%s de vendas do mês de competência',
                                     to_char(v_consumed_comp, 'FM999G990D00'))
         WHERE id = v_dep.id;
      ELSE
        UPDATE public.audit_bank_deposits
           SET match_status = 'fora_periodo',
               match_confidence = v_consumed_adj / NULLIF(v_total_consumed, 0),
               match_reason = FORMAT('FIFO: R$%s de vendas de mês adjacente (fora competência)',
                                     to_char(v_consumed_adj, 'FM999G990D00'))
         WHERE id = v_dep.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;