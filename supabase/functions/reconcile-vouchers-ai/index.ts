// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const MODEL = 'claude-opus-4-7';
const MAX_TOKENS = 16000;
const PRICE_INPUT = 15.0;
const PRICE_OUTPUT = 75.0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `Você é uma auditora financeira especializada em reconciliação de vouchers (vale-refeição/alimentação) no Brasil. Trabalha pra Pizzaria Estrela da Ilha em Florianópolis. O dono é Lucas.

Sua missão: cruzar 3 fontes de dados e devolver matches estruturados:
1. Vendas registradas no Maquinona (POS iFood) — campo deposit_group identifica operadora (alelo, ticket, pluxee, vr)
2. Items dos extratos das operadoras (voucher_lot_items) — vendas como a operadora viu
3. Depósitos no Banco do Brasil (audit_bank_deposits) — dinheiro que efetivamente caiu

# Regras de cada operadora (memorize)

## Alelo (sem antecipação)
- Refeição PAT: taxa 3,60% — prazo D+1 a D+2
- Refeição Auxílio: taxa 5,50% — prazo D+1 a D+2
- Tarifa Anuidade Auxílio: R$ 162/ano (1x ao ano)
- Maquinona não distingue PAT vs Auxílio — só fala "alelo"

## Ticket (com antecipação contratada)
- PAT (frequência diária, prazo 14-15d): taxa Adm 3,60% — sem tarifa de gestão
- Auxílio Alimentação (frequência semanal, prazo 26d): taxa Adm 6,30% + Tarifa Gestão R$ 9,18 fixa por lote
- Lote pode ter SOMA de N reembolsos diferentes na mesma data de pagamento BB
- 1 depósito BB pode ter múltiplos lotes consolidados

## Pluxee (com antecipação contratada — "Reembolso Expresso")
- Adm: 3,50% constante
- Antecipação Expresso: ~7,76% (varia 5-16% por lote)
- Total: ~11,26%
- Prazo: ~D+4 a D+5

## VR (com antecipação total)
- PAT Refeição/Alimentação: 7,44%
- Auxílio Alimentação: 16,98%
- Auxílio Refeição: 26,17% (alto)
- Prazo: D+1 a D+2

# Diferenças de valor que são NORMAIS (não bug)
- Cashback do cliente: operadora desconta, Maquinona não — pode dar 3-9% de diff
- Gorjeta: pode estar no item lote mas não no Maquinona, ou vice-versa
- Arredondamento de centavos
- Tarifa Gestão R$ 9,18 nos lotes Ticket Auxílio (some do net mas sai do bruto)

# Casos especiais a reconhecer

## N lotes → 1 depósito BB (consolidação)
Operadora paga vários reembolsos juntos no mesmo dia. Identifique somando net dos lotes que casam com o amount do depósito (tolerância R$ 2 ou 0,5%).

## 1 lote → N depósitos BB (fragmentação)
Raro. Acontece com Ticket. Confira somando deps próximos da data_pagamento do lote.

## Item órfão (no extrato voucher mas não no Maquinona)
Pode ser: venda dinheiro/cancelada/de outro mês. Marca como "orphan_item".

## Venda Maquinona órfã (no Maquinona mas não no extrato voucher)
Pode ser: extrato voucher incompleto ou venda muito recente. Marca como "orphan_sale".

# Formato OBRIGATÓRIO da resposta (JSON apenas, sem markdown, sem prosa)

{
  "operadora": "alelo",
  "items_matched": [
    {"item_id": "uuid", "ct_id": "uuid", "confidence": "high|medium|low", "diff_valor": 0.50, "diff_dias": 0, "reason": "..."}
  ],
  "items_ambiguous": [
    {"item_id": "uuid", "candidates": [], "reason": "..."}
  ],
  "items_orphan": [
    {"item_id": "uuid", "reason": "..."}
  ],
  "vendas_maquinona_orphan": [
    {"ct_id": "uuid", "reason": "..."}
  ],
  "lots_to_bb_matches": [
    {"deposit_id": "uuid", "lot_ids": ["uuid1"], "soma_lotes": 484.77, "deposit_amount": 484.77, "diff": 0, "type": "exact|grouped|fragmented", "reason": "..."}
  ],
  "deposits_orphan": [
    {"deposit_id": "uuid", "reason": "..."}
  ],
  "summary": {
    "total_vendido_bruto": 0,
    "total_recebido_liquido": 0,
    "total_recebido_competencia": 0,
    "taxa_real_pct": 0,
    "prazo_medio_dias": 0,
    "alertas": []
  }
}

NÃO inclua texto fora do JSON. NÃO use markdown.`;

async function reconcileOperadora(input: any) {
  const userPrompt = `Reconcilie a operadora "${input.operadora}".

Taxa esperada: ${input.expected_rate}% (referência, pode haver desvios reais)

VENDAS MAQUINONA (${input.vendas_maquinona.length}):
${JSON.stringify(input.vendas_maquinona, null, 2)}

ITEMS EXTRATO VOUCHER (${input.voucher_items.length}):
${JSON.stringify(input.voucher_items, null, 2)}

LOTES VOUCHER (${input.voucher_lots.length}):
${JSON.stringify(input.voucher_lots, null, 2)}

DEPÓSITOS BB ${input.operadora.toUpperCase()} (${input.bank_deposits.length}):
${JSON.stringify(input.bank_deposits, null, 2)}

Retorne APENAS o JSON estruturado conforme system prompt.`;

  const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!apiResp.ok) {
    const errText = await apiResp.text();
    throw new Error(`Anthropic ${apiResp.status}: ${errText}`);
  }

  const apiData = await apiResp.json();
  const text = apiData.content?.[0]?.text ?? '';

  let parsed: any;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
  } catch (e: any) {
    throw new Error(`Falha parsing JSON da IA: ${e.message}. Texto: ${text.slice(0, 500)}`);
  }

  const inputTokens = apiData.usage?.input_tokens ?? 0;
  const outputTokens = apiData.usage?.output_tokens ?? 0;
  const costUsd = (inputTokens / 1_000_000) * PRICE_INPUT + (outputTokens / 1_000_000) * PRICE_OUTPUT;

  return { result: parsed, inputTokens, outputTokens, costUsd };
}

async function applyResult(supabase: any, result: any) {
  for (const m of result.items_matched ?? []) {
    if (!m.item_id) continue;
    await supabase.from('voucher_lot_items').update({
      maquinona_match_id: m.ct_id ?? null,
      match_status: 'matched',
      ai_reasoning: m.reason ?? null,
    }).eq('id', m.item_id);
  }
  for (const a of result.items_ambiguous ?? []) {
    if (!a.item_id) continue;
    await supabase.from('voucher_lot_items').update({
      maquinona_match_id: null,
      match_status: 'ambiguous',
      ai_reasoning: a.reason ?? null,
    }).eq('id', a.item_id);
  }
  for (const o of result.items_orphan ?? []) {
    if (!o.item_id) continue;
    await supabase.from('voucher_lot_items').update({
      maquinona_match_id: null,
      match_status: 'unmatched',
      ai_reasoning: o.reason ?? null,
    }).eq('id', o.item_id);
  }
  for (const lbb of result.lots_to_bb_matches ?? []) {
    for (const lotId of lbb.lot_ids ?? []) {
      await supabase.from('voucher_lots').update({
        bb_deposit_id: lbb.deposit_id ?? null,
        status: 'bb_matched',
        ai_reasoning: lbb.reason ?? null,
      }).eq('id', lotId);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { period_id, force_refresh } = await req.json();

    if (!period_id) {
      return new Response(JSON.stringify({ error: 'period_id obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const operadoras = ['alelo', 'ticket', 'pluxee', 'vr'] as const;
    const allResults: Record<string, any> = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCost = 0;

    // Hash do estado pra cache
    const { count: itemsCount } = await supabase.from('voucher_lot_items').select('id', { count: 'exact', head: true });
    const { count: lotsCount } = await supabase.from('voucher_lots').select('id', { count: 'exact', head: true }).eq('audit_period_id', period_id);
    const { count: depsCount } = await supabase.from('audit_bank_deposits').select('id', { count: 'exact', head: true })
      .eq('audit_period_id', period_id).eq('bank', 'bb').in('category', ['alelo','ticket','pluxee','vr']);

    const inputHash = `${period_id}:${itemsCount ?? 0}:${lotsCount ?? 0}:${depsCount ?? 0}`;

    if (!force_refresh) {
      const { data: cached } = await supabase
        .from('voucher_ai_audits')
        .select('*')
        .eq('audit_period_id', period_id)
        .eq('input_hash', inputHash)
        .is('error', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cached) {
        return new Response(JSON.stringify({
          cached: true,
          audit_id: cached.id,
          result: cached.result,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      }
    }

    for (const op of operadoras) {
      const { data: vendas } = await supabase
        .from('audit_card_transactions')
        .select('id, sale_date, gross_amount, net_amount, is_competencia')
        .eq('audit_period_id', period_id)
        .eq('deposit_group', op)
        .eq('is_competencia', true);

      const { data: lots } = await supabase
        .from('voucher_lots')
        .select('id, data_pagamento, data_corte, gross_amount, net_amount, bb_deposit_id')
        .eq('audit_period_id', period_id)
        .eq('operadora', op);

      const lotIds = (lots ?? []).map((l: any) => l.id);
      const itemsResp = lotIds.length > 0
        ? await supabase
            .from('voucher_lot_items')
            .select('id, lot_id, data_transacao, gross_amount, net_amount')
            .in('lot_id', lotIds)
        : { data: [] };
      const items = itemsResp.data ?? [];

      const { data: deps } = await supabase
        .from('audit_bank_deposits')
        .select('id, deposit_date, amount, match_status')
        .eq('audit_period_id', period_id)
        .eq('bank', 'bb')
        .eq('category', op);

      if ((!vendas || vendas.length === 0) && items.length === 0) {
        allResults[op] = { skipped: true, reason: 'sem dados' };
        continue;
      }

      const { data: rateRow } = await supabase
        .from('voucher_expected_rates')
        .select('expected_rate_pct')
        .eq('company', op)
        .maybeSingle();
      const expected_rate = rateRow?.expected_rate_pct ?? 10.0;

      try {
        const { result, inputTokens, outputTokens, costUsd } = await reconcileOperadora({
          operadora: op,
          vendas_maquinona: vendas ?? [],
          voucher_items: items,
          voucher_lots: lots ?? [],
          bank_deposits: deps ?? [],
          expected_rate,
        });

        totalInputTokens += inputTokens;
        totalOutputTokens += outputTokens;
        totalCost += costUsd;
        allResults[op] = result;

        const { data: auditRow } = await supabase.from('voucher_ai_audits').insert({
          audit_period_id: period_id,
          model_used: MODEL,
          input_hash: inputHash,
          result: result,
          items_matched: (result.items_matched ?? []).length,
          items_ambiguous: (result.items_ambiguous ?? []).length,
          items_orphan: (result.items_orphan ?? []).length,
          lots_matched_bb: (result.lots_to_bb_matches ?? []).length,
          total_recebido_competencia: result.summary?.total_recebido_competencia ?? 0,
          total_taxa_real: result.summary?.taxa_real_pct ?? 0,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          cost_usd: costUsd,
          duration_ms: Date.now() - startedAt,
        }).select('id').single();

        await applyResult(supabase, result);
      } catch (opErr: any) {
        console.error(`Erro operadora ${op}:`, opErr.message);
        allResults[op] = { error: opErr.message };
        await supabase.from('voucher_ai_audits').insert({
          audit_period_id: period_id,
          model_used: MODEL,
          input_hash: inputHash,
          result: { operadora: op },
          error: opErr.message,
          duration_ms: Date.now() - startedAt,
        });
      }
    }

    // Reflete nos cards do dashboard
    await supabase.rpc('classify_voucher_deposits', { p_period_id: period_id });

    return new Response(JSON.stringify({
      success: true,
      cached: false,
      results: allResults,
      total_cost_usd: totalCost,
      total_tokens: totalInputTokens + totalOutputTokens,
      duration_ms: Date.now() - startedAt,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});

  } catch (e: any) {
    console.error('reconcile-vouchers-ai error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
