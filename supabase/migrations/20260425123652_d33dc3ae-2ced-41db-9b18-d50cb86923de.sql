-- 1. Nova classify_ifood_deposits: agrega depósitos por dia (lógica N:1 + FIFO)
CREATE OR REPLACE FUNCTION public.classify_ifood_deposits(p_period_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_date date;
  v_expected_comp numeric;
  v_expected_adj numeric;
  v_dep_total numeric;
  v_tolerance numeric;
  v_dep record;
  v_remaining_comp numeric;
  v_remaining_adj numeric;
  v_consume numeric;
BEGIN
  -- Reset
  UPDATE public.audit_bank_deposits
     SET match_status = 'pending',
         match_confidence = NULL,
         match_reason = NULL
   WHERE audit_period_id = p_period_id
     AND bank = 'cresol'
     AND category = 'ifood';

  -- Itera por data de depósito (não por depósito individual)
  FOR v_date IN
    SELECT DISTINCT deposit_date
      FROM public.audit_bank_deposits
     WHERE audit_period_id = p_period_id
       AND bank = 'cresol'
       AND category = 'ifood'
     ORDER BY deposit_date
  LOOP
    -- Esperado da competência neste dia
    SELECT COALESCE(SUM(net_amount), 0) INTO v_expected_comp
      FROM public.audit_card_transactions
     WHERE audit_period_id = p_period_id
       AND deposit_group = 'ifood'
       AND expected_deposit_date = v_date
       AND is_competencia = true;

    -- Esperado adjacente (fev/abr) neste dia
    SELECT COALESCE(SUM(net_amount), 0) INTO v_expected_adj
      FROM public.audit_card_transactions
     WHERE audit_period_id = p_period_id
       AND deposit_group = 'ifood'
       AND expected_deposit_date = v_date
       AND is_competencia = false;

    -- Total depositado neste dia
    SELECT COALESCE(SUM(amount), 0) INTO v_dep_total
      FROM public.audit_bank_deposits
     WHERE audit_period_id = p_period_id
       AND bank = 'cresol'
       AND category = 'ifood'
       AND deposit_date = v_date;

    v_tolerance := GREATEST(5.0, ABS(v_expected_comp + v_expected_adj) * 0.02);

    -- FIFO: distribui cada parcela primeiro pra competência (até esgotar),
    -- depois pra adjacente (até esgotar), e o resto vira nao_identificado
    v_remaining_comp := v_expected_comp;
    v_remaining_adj := v_expected_adj;

    FOR v_dep IN
      SELECT id, amount FROM public.audit_bank_deposits
       WHERE audit_period_id = p_period_id
         AND bank = 'cresol'
         AND category = 'ifood'
         AND deposit_date = v_date
       ORDER BY amount DESC, id ASC  -- maiores primeiro pra reduzir splits
    LOOP
      IF v_remaining_comp >= v_dep.amount - v_tolerance / 10 THEN
        -- Cabe inteiro em competência
        UPDATE public.audit_bank_deposits
           SET match_status = 'matched',
               match_confidence = 1.0,
               match_reason = FORMAT('Casa com vendas iFood do dia %s (esperado R$%s da competência, total recebido R$%s)',
                                     to_char(v_date, 'DD/MM'),
                                     to_char(v_expected_comp, 'FM999G990D00'),
                                     to_char(v_dep_total, 'FM999G990D00'))
         WHERE id = v_dep.id;
        v_remaining_comp := v_remaining_comp - v_dep.amount;
      ELSIF v_remaining_comp > v_tolerance / 5 THEN
        -- Cabe parcialmente: ainda classifica como matched (maioria competência)
        UPDATE public.audit_bank_deposits
           SET match_status = 'matched',
               match_confidence = v_remaining_comp / NULLIF(v_dep.amount, 0),
               match_reason = FORMAT('Casa parcialmente com competência (%s de R$%s). Restante atribuído a vendas adjacentes',
                                     to_char(v_remaining_comp, 'FM999G990D00'),
                                     to_char(v_dep.amount, 'FM999G990D00'))
         WHERE id = v_dep.id;
        v_consume := v_dep.amount - v_remaining_comp;
        v_remaining_comp := 0;
        v_remaining_adj := GREATEST(v_remaining_adj - v_consume, 0);
      ELSIF v_remaining_adj > v_tolerance / 5 OR v_expected_adj > 0 THEN
        -- Vai pra adjacente
        UPDATE public.audit_bank_deposits
           SET match_status = 'fora_periodo',
               match_confidence = 0.7,
               match_reason = FORMAT('Atribuído a vendas iFood de mês adjacente em %s',
                                     to_char(v_date, 'DD/MM'))
         WHERE id = v_dep.id;
        v_remaining_adj := GREATEST(v_remaining_adj - v_dep.amount, 0);
      ELSE
        -- Sobrou: não identificado
        UPDATE public.audit_bank_deposits
           SET match_status = 'nao_identificado',
               match_confidence = 0.0,
               match_reason = FORMAT('Excedente em %s: R$%s sem venda iFood correspondente',
                                     to_char(v_date, 'DD/MM'),
                                     to_char(v_dep.amount, 'FM999G990D00'))
         WHERE id = v_dep.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$function$;

-- 2. Limpa as transferências internas (Pix recebido PIZZARIA) já importadas em Março/2026
DELETE FROM public.audit_bank_deposits
 WHERE audit_period_id = '74d75c7c-a4f2-4e58-ac97-721bf8ca9c4b'
   AND bank = 'bb'
   AND description ILIKE '%pix%recebido%'
   AND detail ILIKE '%PIZZARIA%';

-- 3. Re-roda a classificação para Março/2026
SELECT public.classify_ifood_deposits('74d75c7c-a4f2-4e58-ac97-721bf8ca9c4b');
SELECT public.classify_voucher_deposits('74d75c7c-a4f2-4e58-ac97-721bf8ca9c4b');