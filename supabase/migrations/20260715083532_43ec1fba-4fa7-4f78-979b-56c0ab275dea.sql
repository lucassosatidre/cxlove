
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
      OR (s.desc_store_payment_method ILIKE '%c6%'              AND acc.name = 'C6 Propósito')
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
