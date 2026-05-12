-- =============================================================================
-- iFood Marketplace — backfill da separação "Ocorrência avulsa"
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ifood_calc_data_repasse(base date)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
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
  dow := EXTRACT(DOW FROM base)::int;
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

CREATE OR REPLACE FUNCTION public.ifood_shift_back21d(base date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE WHEN base IS NULL THEN NULL ELSE base - 21 END;
$$;

UPDATE public.audit_ifood_lancamentos
SET categoria_calc = CASE
  WHEN lower(coalesce(tipo_lancamento,'')) LIKE 'frota garantida%'
       OR lower(coalesce(descricao_lancamento,'')) LIKE '%frota garantida%'
       OR lower(coalesce(descricao_lancamento,'')) LIKE '%frota dedicada%' THEN 'frota_garantida'
  WHEN lower(coalesce(tipo_lancamento,'')) LIKE '%ajuste de comiss%' THEN 'comissao'
  WHEN lower(coalesce(descricao_lancamento,'')) LIKE '%pacote de an%'
       OR lower(coalesce(descricao_lancamento,'')) LIKE '%an%ncios%' THEN 'ads'
  ELSE 'outros'
END
WHERE lower(coalesce(fato_gerador,'')) IN ('ocorrência avulsa', 'ocorrencia avulsa');

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
    l.valor,
    lower(coalesce(l.fato_gerador,'')) AS fg_lower
  FROM public.audit_ifood_lancamentos l
), agg AS (
  SELECT
    audit_period_id,
    store_id_curto,
    data_repasse_calc,
    SUM(CASE WHEN categoria_calc = 'ads'             THEN valor ELSE 0 END) AS sum_ads,
    SUM(CASE WHEN categoria_calc = 'frota_garantida' THEN valor ELSE 0 END) AS sum_frota,
    SUM(CASE WHEN categoria_calc = 'comissao'        THEN valor ELSE 0 END) AS sum_comissao_extra,
    SUM(CASE WHEN categoria_calc = 'outros'          THEN valor ELSE 0 END) AS sum_outros_extra,
    SUM(valor) AS sum_total_avulsa
  FROM lanc
  WHERE impacto_no_repasse = 'SIM'
    AND fg_lower IN ('ocorrência avulsa', 'ocorrencia avulsa')
    AND data_repasse_calc IS NOT NULL
  GROUP BY 1, 2, 3
)
UPDATE public.audit_ifood_repasses r
SET
  ads             = ROUND((COALESCE(r.ads, 0) - agg.sum_total_avulsa + agg.sum_ads)::numeric, 2),
  frota_garantida = ROUND((COALESCE(r.frota_garantida, 0) + agg.sum_frota)::numeric, 2),
  comissao        = ROUND((COALESCE(r.comissao, 0) + agg.sum_comissao_extra)::numeric, 2),
  outros          = ROUND((COALESCE(r.outros, 0) + agg.sum_outros_extra)::numeric, 2),
  updated_at      = now()
FROM agg
WHERE r.audit_period_id        = agg.audit_period_id
  AND r.store_id_curto         = agg.store_id_curto
  AND r.data_repasse_esperada  = agg.data_repasse_calc;