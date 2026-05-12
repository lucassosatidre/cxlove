-- =============================================================================
-- iFood Marketplace — backfill da separação "Ocorrência avulsa"
-- =============================================================================
-- Lovable adicionou a coluna `frota_garantida` em audit_ifood_repasses na
-- migration 20260511210859, e atualizou o classificador do edge function pra
-- separar Frota Garantida / ADS / ajustes de comissão / outros.
--
-- MAS dados já importados (Mar/26 em diante) continuam com tudo agrupado em
-- `ads` — sem reimport o KPI continua errado. Esta migration faz o backfill
-- 100% via SQL re-agregando audit_ifood_lancamentos, sem precisar reimportar
-- XLSX.
--
-- Passos:
--   1. Atualiza audit_ifood_lancamentos.categoria_calc das linhas "Ocorrência
--      avulsa" usando a MESMA regra do edge atualizado.
--   2. Re-agrega audit_ifood_repasses: redistribui o valor entre ads,
--      frota_garantida, comissao e outros conforme a nova classificação.
-- =============================================================================

-- ─── 1. Helpers SQL pra replicar calcDataRepasseFromPedido + shiftBack21d ───
-- Espelha calcDataRepasseFromPedido() do edge:
--   corte = próximo domingo (>= base), ou último dia do mês se vier antes;
--   data_repasse = próxima quarta-feira após o corte.
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

CREATE OR REPLACE FUNCTION public.ifood_shift_back21d(base date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN base IS NULL THEN NULL ELSE base - 21 END;
$$;

-- ─── 2. Reclassifica lançamentos "Ocorrência avulsa" ────────────────────────
-- Mesma regra do edge atualizado:
--   - tipo "Frota Garantida..." ou descrição com "frota garantida/dedicada" → frota_garantida
--   - tipo com "ajuste de comissão"                                         → comissao
--   - descrição com "anúncios/pacote de anúncios"                           → ads
--   - resto                                                                 → outros
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

-- ─── 3. Re-agregação dos repasses existentes ────────────────────────────────
-- Calcula data_repasse usando a mesma cascata de fallbacks do edge function:
--   1) data_criacao_pedido_associado (UTC)
--   2) data_apuracao_fim
--   3) data_repasse_esperada do XLSX − 21 dias
-- Considera apenas linhas com impacto_no_repasse='SIM' (mesma regra do agg
-- original). Só atualiza colunas que mudaram: ads, frota_garantida, comissao,
-- outros. As demais (bruto_venda, taxa_*, etc.) ficam inalteradas.
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
  -- Apenas avalia as linhas que vieram de "Ocorrência avulsa" — qualquer
  -- outra categoria já está corretamente agregada. Para essas, recomputa o
  -- delta a aplicar em ads, frota_garantida, comissao e outros.
  SELECT
    audit_period_id,
    store_id_curto,
    data_repasse_calc,
    SUM(CASE WHEN categoria_calc = 'ads'             THEN valor ELSE 0 END) AS sum_ads,
    SUM(CASE WHEN categoria_calc = 'frota_garantida' THEN valor ELSE 0 END) AS sum_frota,
    SUM(CASE WHEN categoria_calc = 'comissao'        THEN valor ELSE 0 END) AS sum_comissao_extra,
    SUM(CASE WHEN categoria_calc = 'outros'          THEN valor ELSE 0 END) AS sum_outros_extra,
    -- Total da "Ocorrência avulsa" que antes ia 100% pra ads
    SUM(valor) AS sum_total_avulsa
  FROM lanc
  WHERE impacto_no_repasse = 'SIM'
    AND fg_lower IN ('ocorrência avulsa', 'ocorrencia avulsa')
    AND data_repasse_calc IS NOT NULL
  GROUP BY 1, 2, 3
)
UPDATE public.audit_ifood_repasses r
SET
  -- Antes: ads continha TODO sum_total_avulsa. Agora separa.
  ads             = ROUND((COALESCE(r.ads, 0) - agg.sum_total_avulsa + agg.sum_ads)::numeric, 2),
  frota_garantida = ROUND((COALESCE(r.frota_garantida, 0) + agg.sum_frota)::numeric, 2),
  comissao        = ROUND((COALESCE(r.comissao, 0) + agg.sum_comissao_extra)::numeric, 2),
  outros          = ROUND((COALESCE(r.outros, 0) + agg.sum_outros_extra)::numeric, 2),
  updated_at      = now()
FROM agg
WHERE r.audit_period_id        = agg.audit_period_id
  AND r.store_id_curto         = agg.store_id_curto
  AND r.data_repasse_esperada  = agg.data_repasse_calc;
