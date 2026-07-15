
ALTER TABLE public.saipos_fin_transactions
  ADD COLUMN IF NOT EXISTS conferido boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS conferido_em timestamptz;

-- Helper predicates inlined:
--   is_frente_caixa  := desc_store_category_financial = 'Frente de Caixa'
--   is_retido        := amount < 0 AND is_frente_caixa = false AND (
--                         desc_store_category_financial IN (...FEE_CATS...) OR
--                         (desc_store_category_financial='Motoboy' AND desc_store_fin_transaction ~* 'ifood|frete|frota|retenç|sob demanda|serviço')
--                       )
--   paid boolean     := paid = 'Y'
--   company          := 'proposito' if desc_store_payment_method ~* 'c6' else 'estrela'

CREATE OR REPLACE FUNCTION public.cashflow_upcoming_bills()
RETURNS TABLE(vencimento date, amount numeric, category text, fornecedor text, descricao text)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT
    date AS vencimento,
    amount,
    desc_store_category_financial AS category,
    provider_trade_name AS fornecedor,
    COALESCE(NULLIF(TRIM(desc_store_fin_transaction),''), provider_trade_name) AS descricao
  FROM public.saipos_fin_transactions
  WHERE paid = 'N' AND amount < 0
    AND COALESCE(desc_store_category_financial,'') <> 'Frente de Caixa'
    AND NOT (
      desc_store_category_financial IN ('Comissão do Ifood','Ifood Ads','Taxa de Antecipação - Ifood','Taxas de Cartão - Crédito, Débito e Pix','Taxas de Cartão - Vouchers','Taxas Brendi')
      OR (desc_store_category_financial = 'Motoboy' AND desc_store_fin_transaction ~* 'ifood|frete|frota|retenç|sob demanda|serviço')
    )
    AND date >= CURRENT_DATE
  ORDER BY date;
$$;

CREATE OR REPLACE FUNCTION public.cashflow_upcoming_bills_daily(p_start date DEFAULT CURRENT_DATE, p_days integer DEFAULT 30)
RETURNS TABLE(date date, total numeric, n bigint, items jsonb)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH days AS (
    SELECT generate_series(p_start, p_start + (GREATEST(p_days,1)-1), interval '1 day')::date dia
  ),
  bills AS (
    SELECT
      s.date AS vencimento,
      s.amount,
      s.desc_store_category_financial AS category,
      s.provider_trade_name AS fornecedor,
      COALESCE(NULLIF(TRIM(s.desc_store_fin_transaction),''), s.provider_trade_name) AS descricao,
      s.id
    FROM public.saipos_fin_transactions s
    WHERE s.paid = 'N' AND s.amount < 0
      AND COALESCE(s.desc_store_category_financial,'') <> 'Frente de Caixa'
      AND NOT (
        s.desc_store_category_financial IN ('Comissão do Ifood','Ifood Ads','Taxa de Antecipação - Ifood','Taxas de Cartão - Crédito, Débito e Pix','Taxas de Cartão - Vouchers','Taxas Brendi')
        OR (s.desc_store_category_financial = 'Motoboy' AND s.desc_store_fin_transaction ~* 'ifood|frete|frota|retenç|sob demanda|serviço')
      )
  )
  SELECT
    d.dia,
    COALESCE(SUM(ABS(b.amount)), 0),
    COALESCE(COUNT(b.id), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'categoria', COALESCE(NULLIF(TRIM(b.category),''),'Sem categoria'),
      'fornecedor', b.fornecedor,
      'descricao', COALESCE(NULLIF(TRIM(b.descricao),''), b.fornecedor),
      'valor', ABS(b.amount)
    ) ORDER BY ABS(b.amount) DESC) FILTER (WHERE b.id IS NOT NULL), '[]'::jsonb)
  FROM days d
  LEFT JOIN bills b ON b.vencimento = d.dia
  GROUP BY d.dia
  ORDER BY d.dia;
$$;

CREATE OR REPLACE FUNCTION public.cashflow_retido_summary(p_start date, p_end date)
RETURNS TABLE(category text, total numeric, n bigint)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(NULLIF(TRIM(desc_store_category_financial),''),'Sem categoria') AS category,
    SUM(ABS(amount)) AS total,
    COUNT(*) AS n
  FROM public.saipos_fin_transactions
  WHERE amount < 0
    AND (
      desc_store_category_financial IN ('Comissão do Ifood','Ifood Ads','Taxa de Antecipação - Ifood','Taxas de Cartão - Crédito, Débito e Pix','Taxas de Cartão - Vouchers','Taxas Brendi')
      OR (desc_store_category_financial = 'Motoboy' AND desc_store_fin_transaction ~* 'ifood|frete|frota|retenç|sob demanda|serviço')
    )
    AND COALESCE(desc_store_category_financial,'') <> 'Frente de Caixa'
    AND date BETWEEN p_start AND p_end
  GROUP BY 1
  ORDER BY total DESC;
$$;

CREATE OR REPLACE FUNCTION public.cashflow_category_summary(p_start date, p_end date)
RETURNS TABLE(company text, category text, total numeric, n bigint)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT
    CASE WHEN desc_store_payment_method ~* 'c6' THEN 'proposito' ELSE 'estrela' END AS company,
    COALESCE(NULLIF(TRIM(desc_store_category_financial),''),'Sem categoria') AS category,
    SUM(amount) AS total,
    COUNT(*) AS n
  FROM public.saipos_fin_transactions
  WHERE amount < 0
    AND COALESCE(desc_store_category_financial,'') <> 'Frente de Caixa'
    AND NOT (
      desc_store_category_financial IN ('Comissão do Ifood','Ifood Ads','Taxa de Antecipação - Ifood','Taxas de Cartão - Crédito, Débito e Pix','Taxas de Cartão - Vouchers','Taxas Brendi')
      OR (desc_store_category_financial = 'Motoboy' AND desc_store_fin_transaction ~* 'ifood|frete|frota|retenç|sob demanda|serviço')
    )
    AND date BETWEEN p_start AND p_end
  GROUP BY 1, 2
  ORDER BY total ASC;
$$;

CREATE OR REPLACE FUNCTION public.cashflow_monthly_consolidated()
RETURNS TABLE(ym text, entradas numeric, saidas numeric)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH ent AS (
    SELECT to_char(tx_date,'YYYY-MM') ym, SUM(amount) v
    FROM public.cashflow_transactions
    WHERE COALESCE(is_internal_transfer,false) = false AND amount > 0
    GROUP BY 1
  ),
  sai AS (
    SELECT to_char(date,'YYYY-MM') ym, SUM(amount) v
    FROM public.saipos_fin_transactions
    WHERE amount < 0
      AND COALESCE(desc_store_category_financial,'') <> 'Frente de Caixa'
      AND NOT (
        desc_store_category_financial IN ('Comissão do Ifood','Ifood Ads','Taxa de Antecipação - Ifood','Taxas de Cartão - Crédito, Débito e Pix','Taxas de Cartão - Vouchers','Taxas Brendi')
        OR (desc_store_category_financial = 'Motoboy' AND desc_store_fin_transaction ~* 'ifood|frete|frota|retenç|sob demanda|serviço')
      )
    GROUP BY 1
  )
  SELECT COALESCE(e.ym, s.ym) ym, COALESCE(e.v,0) entradas, COALESCE(s.v,0) saidas
  FROM ent e FULL OUTER JOIN sai s ON e.ym = s.ym
  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_saidas(p_ini date, p_fim date)
RETURNS TABLE(tipo text, account_name text, valor numeric, vencimento date, fornecedor text, descricao text, categoria text, tx_date date, descricao_banco text, confianca text, saipos_id uuid, tx_id uuid, conferido boolean)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH saida AS (
    SELECT s.id,
      CASE WHEN s.desc_store_payment_method ~* 'c6' THEN 'proposito' ELSE 'estrela' END AS company,
      ABS(s.amount) val,
      s.date AS vencimento,
      COALESCE(s.payment_date, s.date) AS dpag,
      s.provider_trade_name AS fornecedor,
      COALESCE(NULLIF(TRIM(s.desc_store_fin_transaction),''), s.provider_trade_name) AS descricao,
      s.desc_store_category_financial AS category,
      s.desc_store_payment_method AS payment_method,
      s.conferido,
      acc.id AS account_id, acc.name AS account_name
    FROM public.saipos_fin_transactions s
    JOIN public.cashflow_accounts acc ON acc.active AND (
         (s.desc_store_payment_method ILIKE '%banco do brasil%' AND acc.name = 'Banco do Brasil')
      OR (s.desc_store_payment_method ILIKE '%cresol%'          AND acc.name = 'Cresol')
      OR (s.desc_store_payment_method ILIKE '%ifood%'           AND acc.name = 'iFood Pago')
      OR (s.desc_store_payment_method ILIKE '%c6%'              AND acc.name = CASE WHEN s.desc_store_payment_method ~* 'c6' THEN 'C6 Prover' ELSE 'C6 Propósito' END)
    )
    WHERE s.amount < 0
      AND COALESCE(s.desc_store_category_financial,'') <> 'Frente de Caixa'
      AND s.paid = 'Y'
      AND s.desc_store_payment_method NOT ILIKE '%crédito%'
      AND s.desc_store_payment_method NOT ILIKE '%cart%'
      AND s.date BETWEEN p_ini AND p_fim
  ),
  deb AS (
    SELECT t.id, t.account_id, ABS(t.amount) val, t.tx_date, t.description, t.conferido,
           COALESCE(t.is_internal_transfer, false) AS interna
    FROM public.cashflow_transactions t
    WHERE t.amount < 0
      AND t.tx_date BETWEEN p_ini - 5 AND p_fim + 7
      AND NOT (
        COALESCE(t.source,'') <> 'pluggy'
        AND EXISTS (
          SELECT 1 FROM public.cashflow_transactions p
          WHERE p.account_id = t.account_id
            AND p.tx_date = t.tx_date
            AND round(ABS(p.amount),2) = round(ABS(t.amount),2)
            AND p.source = 'pluggy'
        )
      )
  ),
  cand AS (
    SELECT s.id sid, d.id did, s.account_id, s.val, s.vencimento, d.tx_date,
      LEAST(ABS(d.tx_date - s.vencimento), ABS(d.tx_date - s.dpag)) gap,
      (d.tx_date = s.vencimento OR d.tx_date = s.dpag) exato
    FROM saida s
    JOIN deb d ON d.account_id = s.account_id AND round(d.val, 2) = round(s.val, 2)
      AND ( d.tx_date BETWEEN s.vencimento - 3 AND s.vencimento + 3
         OR d.tx_date BETWEEN s.dpag - 3 AND s.dpag + 3 )
  ),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY sid ORDER BY gap, did) rs,
              row_number() OVER (PARTITION BY did ORDER BY gap, sid) rd
    FROM cand
  ),
  matched AS (SELECT * FROM ranked WHERE rs = 1 AND rd = 1)
  SELECT
    CASE WHEN m.did IS NOT NULL THEN 'casado' ELSE 'saipos_sem_banco' END,
    s.account_name, s.val, s.vencimento, s.fornecedor, s.descricao, s.category,
    m.tx_date,
    (SELECT d.description FROM deb d WHERE d.id = m.did),
    CASE WHEN m.exato THEN 'ALTA' WHEN m.did IS NOT NULL THEN 'MEDIA' ELSE NULL END,
    s.id, m.did, s.conferido
  FROM saida s
  LEFT JOIN matched m ON m.sid = s.id
  UNION ALL
  SELECT 'banco_sem_saipos', acc.name, d.val, NULL::date, NULL, NULL, NULL, d.tx_date, d.description, NULL,
    NULL::uuid, d.id, d.conferido
  FROM deb d
  JOIN public.cashflow_accounts acc ON acc.id = d.account_id
  WHERE d.tx_date BETWEEN p_ini AND p_fim
    AND d.interna = false
    AND NOT EXISTS (SELECT 1 FROM matched m WHERE m.did = d.id)
    AND d.description NOT ILIKE '%fatura%'
    AND d.description NOT ILIKE '%cart%';
$$;

CREATE OR REPLACE FUNCTION public.set_conferido(p_kind text, p_id uuid, p_value boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_kind = 'saipos' THEN
    UPDATE public.saipos_fin_transactions
       SET conferido = p_value, conferido_em = CASE WHEN p_value THEN now() ELSE NULL END
     WHERE id = p_id;
  ELSIF p_kind = 'banco' THEN
    UPDATE public.cashflow_transactions
       SET conferido = p_value, conferido_em = CASE WHEN p_value THEN now() ELSE NULL END
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'invalid kind %', p_kind;
  END IF;
END;
$$;
