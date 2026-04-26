-- 1) Tabela de taxas esperadas por operadora
CREATE TABLE IF NOT EXISTS public.voucher_expected_rates (
  company text PRIMARY KEY,
  expected_rate_pct numeric NOT NULL,
  has_anticipation boolean NOT NULL DEFAULT false,
  notes text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.voucher_expected_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read voucher_expected_rates" ON public.voucher_expected_rates;
CREATE POLICY "Admins read voucher_expected_rates"
  ON public.voucher_expected_rates FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins write voucher_expected_rates" ON public.voucher_expected_rates;
CREATE POLICY "Admins write voucher_expected_rates"
  ON public.voucher_expected_rates FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.voucher_expected_rates (company, expected_rate_pct, has_anticipation, notes) VALUES
  ('alelo',  5.50, false, 'Refeição PAT 3,60% / Auxílio 5,50%. Ponderada típica ~5%. Sem antecipação ativa. Anuidade R$162/ano + Tarifa TOR R$1,22/ocorrência.'),
  ('ticket', 12.00, false, 'PAT 7,44% / Auxílio ~17%. Ponderada típica ~12% (depende mix). Sem antecipação ativa. Tarifa Gestão R$8,70-9,20/lote + R$0,82-0,89/transação no Auxílio. Tarifa Mensalidade ATIVA em Restaurante PAT e Flex PAT.'),
  ('pluxee', 10.00, true,  'Reembolso 3,5% constante + Reembolso Expresso variável (PAT 4-6%, Auxílio 11,16%). Antecipação ATIVA. Anuidade anual via IGP-M.'),
  ('vr',     17.50, true,  'PAT 7,44% / Auxílio 16,86%. Antecipação ATIVA com efeito ~258% a.a. no Auxílio. Anuidade R$388/ano em 4x. Tarifa Operacional R$6,76/lote no não-PAT.')
ON CONFLICT (company) DO UPDATE
  SET expected_rate_pct = EXCLUDED.expected_rate_pct,
      has_anticipation = EXCLUDED.has_anticipation,
      notes = EXCLUDED.notes,
      updated_at = now();

-- 2) Nova função classify_voucher_deposits (FIFO por valor + status por gap)
CREATE OR REPLACE FUNCTION public.classify_voucher_deposits(p_period_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_brand text;
  v_total_bruto_esperado numeric;
  v_total_matched_comp numeric;
  v_dep RECORD;
  v_dep_count integer;
  v_sold_count integer;
  v_diff numeric;
  v_rate numeric;
  v_expected_rate numeric;
  v_gap numeric;
  v_status text;
  v_period_month integer;
  v_period_year integer;
  v_period_start date;
  v_period_end date;
  v_window_end date;
  v_match_comp numeric;
  v_match_adj numeric;
BEGIN
  SELECT month, year INTO v_period_month, v_period_year
    FROM audit_periods WHERE id = p_period_id;

  v_period_start := MAKE_DATE(v_period_year, v_period_month, 1);
  v_period_end   := (v_period_start + INTERVAL '1 month')::date;
  v_window_end   := (v_period_end + INTERVAL '35 days')::date;

  UPDATE audit_bank_deposits
     SET match_status = 'pending', match_reason = NULL,
         matched_competencia_amount = 0, matched_adjacente_amount = 0
   WHERE audit_period_id = p_period_id
     AND bank = 'bb'
     AND category IN ('alelo', 'ticket', 'pluxee', 'vr');

  FOR v_brand IN SELECT unnest(ARRAY['alelo', 'ticket', 'pluxee', 'vr']) LOOP
    SELECT COALESCE(SUM(gross_amount), 0), COUNT(*)
      INTO v_total_bruto_esperado, v_sold_count
    FROM audit_card_transactions
    WHERE audit_period_id = p_period_id
      AND deposit_group = v_brand
      AND is_competencia = true;

    v_total_matched_comp := 0;

    FOR v_dep IN
      SELECT id, amount, deposit_date
        FROM audit_bank_deposits
       WHERE audit_period_id = p_period_id
         AND bank = 'bb'
         AND category = v_brand
       ORDER BY deposit_date ASC, id ASC
    LOOP
      IF v_total_matched_comp >= v_total_bruto_esperado THEN
        v_match_comp := 0;
        v_match_adj  := v_dep.amount;
        UPDATE audit_bank_deposits
           SET match_status = 'fora_periodo',
               matched_competencia_amount = v_match_comp,
               matched_adjacente_amount = v_match_adj,
               match_reason = format('Adjacente %s: já cobriu bruto competência (R$ %s)',
                                     UPPER(v_brand), round(v_total_matched_comp, 2))
         WHERE id = v_dep.id;
      ELSIF v_total_matched_comp + v_dep.amount <= v_total_bruto_esperado THEN
        v_match_comp := v_dep.amount;
        v_match_adj  := 0;
        UPDATE audit_bank_deposits
           SET match_status = 'matched',
               matched_competencia_amount = v_match_comp,
               matched_adjacente_amount = v_match_adj,
               match_reason = format('Comp %s: R$ %s (acum R$ %s / R$ %s)',
                                     UPPER(v_brand), round(v_match_comp, 2),
                                     round(v_total_matched_comp + v_match_comp, 2),
                                     round(v_total_bruto_esperado, 2))
         WHERE id = v_dep.id;
        v_total_matched_comp := v_total_matched_comp + v_match_comp;
      ELSE
        v_match_comp := v_total_bruto_esperado - v_total_matched_comp;
        v_match_adj  := v_dep.amount - v_match_comp;
        UPDATE audit_bank_deposits
           SET match_status = 'matched',
               matched_competencia_amount = v_match_comp,
               matched_adjacente_amount = v_match_adj,
               match_reason = format('Comp %s: R$ %s + Adj R$ %s (cobriu integral R$ %s)',
                                     UPPER(v_brand), round(v_match_comp, 2),
                                     round(v_match_adj, 2),
                                     round(v_total_bruto_esperado, 2))
         WHERE id = v_dep.id;
        v_total_matched_comp := v_total_matched_comp + v_match_comp;
      END IF;
    END LOOP;

    SELECT COUNT(*) INTO v_dep_count
      FROM audit_bank_deposits
     WHERE audit_period_id = p_period_id
       AND bank = 'bb'
       AND category = v_brand
       AND match_status = 'matched';

    v_diff := v_total_bruto_esperado - v_total_matched_comp;
    v_rate := CASE WHEN v_total_bruto_esperado > 0
                   THEN v_diff / v_total_bruto_esperado * 100
                   ELSE 0 END;

    SELECT expected_rate_pct INTO v_expected_rate
      FROM voucher_expected_rates
     WHERE company = v_brand;

    IF v_expected_rate IS NULL THEN v_expected_rate := 5.0; END IF;

    v_gap := v_rate - v_expected_rate;

    IF v_total_bruto_esperado = 0 THEN
      v_status := 'no_sales';
    ELSIF v_gap < -2.0 THEN
      v_status := 'divergente';
    ELSIF v_gap <= 2.0 THEN
      v_status := 'ok';
    ELSIF v_gap <= 5.0 THEN
      v_status := 'alerta';
    ELSE
      v_status := 'critico';
    END IF;

    INSERT INTO audit_voucher_matches
        (audit_period_id, company, sold_amount, sold_count,
         deposited_amount, deposit_count, difference,
         effective_tax_rate, status)
    VALUES
        (p_period_id, v_brand, v_total_bruto_esperado, v_sold_count,
         v_total_matched_comp, v_dep_count, v_diff,
         v_rate, v_status)
    ON CONFLICT (audit_period_id, company) DO UPDATE
       SET sold_amount       = EXCLUDED.sold_amount,
           sold_count        = EXCLUDED.sold_count,
           deposited_amount  = EXCLUDED.deposited_amount,
           deposit_count     = EXCLUDED.deposit_count,
           difference        = EXCLUDED.difference,
           effective_tax_rate = EXCLUDED.effective_tax_rate,
           status            = EXCLUDED.status;
  END LOOP;
END;
$$;