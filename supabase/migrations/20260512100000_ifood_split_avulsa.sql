-- =============================================================================
-- iFood Marketplace — separa "Ocorrência avulsa" em ads (anúncios) + Frota
-- Garantida (logística) + outros avulsos
-- =============================================================================
-- Bug: o classificador agrupava TODO fato_gerador="Ocorrência avulsa" no bucket
-- `ads`. iFood usa essa categoria como guarda-chuva pra anúncios, Frota
-- Garantida e ajustes diversos. Em Mar/26 a Estrela contratou Frota Garantida
-- e R$ ~6,8k caiu indevidamente em ADS, inflando o KPI de marketing.
--
-- Esta migration: adiciona 2 colunas, atualiza categoria_calc em lançamentos
-- existentes e re-agrega audit_ifood_repasses sem precisar reimportar XLSX.
-- =============================================================================

-- ─── 1. Novas colunas em audit_ifood_repasses ────────────────────────────────
ALTER TABLE public.audit_ifood_repasses
  ADD COLUMN IF NOT EXISTS frete_garantido numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outros_avulsos  numeric(14,2) DEFAULT 0;

-- ─── 2. Helpers SQL para recalcular data_repasse a partir de uma data base ──
-- Espelha calcDataRepasseFromPedido() do edge function:
--   1) corte = próximo domingo (>= base) OU último dia do mês se vier antes
--   2) data_repasse = próxima quarta-feira após o corte
CREATE OR REPLACE FUNCTION public.ifood_calc_data_repasse(base date)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  dow int;
  days_until_sun int;
  sunday_corte date;
  last_day date;
  corte date;
  corte_dow int;
  days_until_wed int;
BEGIN
  IF base IS NULL THEN RETURN NULL; END IF;
  dow := EXTRACT(DOW FROM base)::int;  -- 0=Sun..6=Sat
  days_until_sun := (7 - dow) % 7;
  sunday_corte := base + days_until_sun;
  last_day := (date_trunc('month', base) + interval '1 month - 1 day')::date;
  IF last_day < sunday_corte AND last_day >= base THEN
    corte := last_day;
  ELSE
    corte := sunday_corte;
  END IF;
  corte_dow := EXTRACT(DOW FROM corte)::int;
  days_until_wed := ((3 - corte_dow + 7) % 7);
  IF days_until_wed = 0 THEN days_until_wed := 7; END IF;
  RETURN corte + days_until_wed;
END;
$$;

-- Espelha shiftBack21d()
CREATE OR REPLACE FUNCTION public.ifood_shift_back21d(base date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN base IS NULL THEN NULL ELSE base - 21 END;
$$;

-- ─── 3. Backfill audit_ifood_lancamentos.categoria_calc ─────────────────────
-- Linhas com fato_gerador="Ocorrência avulsa" ficam:
--   - "pacote de anúncios"  → 'ads' (continua)
--   - "Frota Garantida"     → 'frete_garantido' (novo bucket)
--   - resto                 → 'outros_avulsos'
UPDATE public.audit_ifood_lancamentos
SET categoria_calc = CASE
  WHEN descricao_lancamento ILIKE '%pacote de an%ncios%' THEN 'ads'
  WHEN descricao_lancamento ILIKE '%frota garantida%'    THEN 'frete_garantido'
  ELSE 'outros_avulsos'
END
WHERE lower(coalesce(fato_gerador,'')) IN ('ocorrência avulsa', 'ocorrencia avulsa');

-- ─── 4. Re-agregação dos repasses existentes ────────────────────────────────
-- Recalcula data_repasse via mesma cascata de fallbacks do edge function:
--   1) data_criacao_pedido_associado (UTC date)
--   2) data_apuracao_fim
--   3) data_repasse_esperada do XLSX − 21 dias
WITH lanc AS (
  SELECT
    l.audit_period_id,
    l.store_id_curto,
    COALESCE(
      public.ifood_calc_data_repasse((l.data_criacao_pedido_associado AT TIME ZONE 'UTC')::date),
      public.ifood_calc_data_repasse(l.data_apuracao_fim),
      public.ifood_shift_back21d(l.data_repasse_esperada)
    ) AS data_repasse_calc,
    l.categoria_calc,
    l.impacto_no_repasse,
    l.valor
  FROM public.audit_ifood_lancamentos l
), agg AS (
  SELECT
    audit_period_id,
    store_id_curto,
    data_repasse_calc,
    SUM(CASE WHEN impacto_no_repasse = 'SIM' AND categoria_calc = 'ads'             THEN valor ELSE 0 END) AS ads_novo,
    SUM(CASE WHEN impacto_no_repasse = 'SIM' AND categoria_calc = 'frete_garantido' THEN valor ELSE 0 END) AS frete_garantido_sum,
    SUM(CASE WHEN impacto_no_repasse = 'SIM' AND categoria_calc = 'outros_avulsos'  THEN valor ELSE 0 END) AS outros_avulsos_sum
  FROM lanc
  WHERE data_repasse_calc IS NOT NULL
  GROUP BY 1, 2, 3
)
UPDATE public.audit_ifood_repasses r
SET
  ads             = ROUND(agg.ads_novo::numeric, 2),
  frete_garantido = ROUND(agg.frete_garantido_sum::numeric, 2),
  outros_avulsos  = ROUND(agg.outros_avulsos_sum::numeric, 2),
  updated_at      = now()
FROM agg
WHERE r.audit_period_id        = agg.audit_period_id
  AND r.store_id_curto         = agg.store_id_curto
  AND r.data_repasse_esperada  = agg.data_repasse_calc;
