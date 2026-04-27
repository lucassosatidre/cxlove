-- Tabela 1: voucher_ai_audits
CREATE TABLE IF NOT EXISTS public.voucher_ai_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  triggered_by uuid REFERENCES auth.users(id),
  model_used text NOT NULL,
  input_hash text NOT NULL,
  result jsonb NOT NULL,
  items_matched int,
  items_ambiguous int,
  items_orphan int,
  lots_matched_bb int,
  lots_unmatched_bb int,
  total_recebido_competencia numeric,
  total_taxa_real numeric,
  input_tokens int,
  output_tokens int,
  cost_usd numeric,
  duration_ms int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voucher_ai_audits_period ON public.voucher_ai_audits(audit_period_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_voucher_ai_audits_hash ON public.voucher_ai_audits(input_hash);

ALTER TABLE public.voucher_ai_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read voucher ai audits" ON public.voucher_ai_audits
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role writes voucher ai audits" ON public.voucher_ai_audits
  FOR INSERT WITH CHECK (true);

-- Tabela 2: ifood_ai_audits
CREATE TABLE IF NOT EXISTS public.ifood_ai_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_period_id uuid NOT NULL REFERENCES public.audit_periods(id) ON DELETE CASCADE,
  triggered_by uuid REFERENCES auth.users(id),
  model_used text NOT NULL,
  input_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','warnings','critical')),
  summary text,
  anomalies jsonb,
  recommendations jsonb,
  input_tokens int,
  output_tokens int,
  cost_usd numeric,
  duration_ms int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ifood_ai_audits_period ON public.ifood_ai_audits(audit_period_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ifood_ai_audits_hash ON public.ifood_ai_audits(input_hash);

ALTER TABLE public.ifood_ai_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read ifood ai audits" ON public.ifood_ai_audits
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Service role writes ifood ai audits" ON public.ifood_ai_audits
  FOR INSERT WITH CHECK (true);

-- Colunas ai_reasoning
ALTER TABLE public.voucher_lot_items ADD COLUMN IF NOT EXISTS ai_reasoning text;
ALTER TABLE public.voucher_lots      ADD COLUMN IF NOT EXISTS ai_reasoning text;

-- RPC get_daily_audit_summary
CREATE OR REPLACE FUNCTION public.get_daily_audit_summary(p_period_id uuid)
RETURNS TABLE(
  dia date,
  vendas_maquinona_bruto numeric,
  vendas_maquinona_liquido numeric,
  vendas_qtd int,
  deposito_cresol numeric,
  deposito_qtd int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH vendas_dia AS (
    SELECT expected_deposit_date AS dia,
           SUM(gross_amount) AS bruto,
           SUM(net_amount) AS liq,
           COUNT(*)::int AS qtd
    FROM audit_card_transactions
    WHERE audit_period_id = p_period_id
      AND deposit_group = 'ifood'
      AND is_competencia = true
      AND expected_deposit_date IS NOT NULL
    GROUP BY 1
  ),
  deps_dia AS (
    SELECT deposit_date AS dia,
           SUM(amount) AS dep,
           COUNT(*)::int AS qtd
    FROM audit_bank_deposits
    WHERE audit_period_id = p_period_id
      AND bank = 'cresol' AND category = 'ifood'
    GROUP BY 1
  )
  SELECT
    COALESCE(v.dia, d.dia) AS dia,
    COALESCE(v.bruto, 0)::numeric AS vendas_maquinona_bruto,
    COALESCE(v.liq, 0)::numeric AS vendas_maquinona_liquido,
    COALESCE(v.qtd, 0)::int AS vendas_qtd,
    COALESCE(d.dep, 0)::numeric AS deposito_cresol,
    COALESCE(d.qtd, 0)::int AS deposito_qtd
  FROM vendas_dia v
  FULL OUTER JOIN deps_dia d ON d.dia = v.dia
  ORDER BY 1;
$$;