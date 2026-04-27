// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const MODEL = 'claude-sonnet-4-6';
const PRICE_INPUT = 3.0;
const PRICE_OUTPUT = 15.0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `Você é uma auditora financeira pra Pizzaria Estrela da Ilha. Sua função: revisar a conciliação iFood Maquinona x Cresol e detectar anomalias.

Contexto:
- iFood Maquinona é a maquininha física do iFood
- Cresol é o banco onde o iFood deposita as vendas
- Taxa real iFood é tipicamente 0,15-3% (depende do mix crédito/débito/pix)
- iFood paga em D+1 (com antecipação) ou D+2 a D+30 (sem)

Indicadores de anomalia:
- Dia com vendas Maquinona mas sem depósito Cresol em D+1 a D+5
- Depósito Cresol muito acima ou abaixo do esperado pra um dia
- Taxa efetiva > 5% ou < 0% em algum dia
- Padrão de feriado/fim de semana não respeitado

Formato OBRIGATÓRIO da resposta (JSON apenas):

{
  "status": "ok | warnings | critical",
  "summary": "resumo de 1-2 linhas",
  "anomalies": [
    {"day": "2026-02-15", "type": "missing_deposit | high_diff | low_diff | unusual_rate", "expected": 0, "actual": 0, "diff": 0, "diff_pct": 0, "description": "..."}
  ],
  "recommendations": []
}

Sem markdown. Sem prosa.`;

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

    const { count: vendas } = await supabase.from('audit_card_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('audit_period_id', period_id).eq('deposit_group', 'ifood');
    const { count: deps } = await supabase.from('audit_bank_deposits')
      .select('id', { count: 'exact', head: true })
      .eq('audit_period_id', period_id).eq('bank', 'cresol').eq('category', 'ifood');
    const inputHash = `${period_id}:ifood:${vendas ?? 0}:${deps ?? 0}`;

    if (!force_refresh) {
      const { data: cached } = await supabase
        .from('ifood_ai_audits')
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
          status: cached.status,
          summary: cached.summary,
          anomalies: cached.anomalies,
          recommendations: cached.recommendations,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
      }
    }

    const { data: dailyData } = await supabase.rpc('get_daily_audit_summary', { p_period_id: period_id });

    const userPrompt = `Audite a conciliação iFood do período id=${period_id}.

DADOS POR DIA (vendas Maquinona vs depósitos Cresol):
${JSON.stringify(dailyData ?? [], null, 2)}

Devolva APENAS o JSON conforme system prompt.`;

    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!apiResp.ok) {
      throw new Error(`Anthropic ${apiResp.status}: ${await apiResp.text()}`);
    }

    const apiData = await apiResp.json();
    const text = apiData.content?.[0]?.text ?? '';
    let parsed: any;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
    } catch (e: any) {
      throw new Error(`Falha parsing: ${e.message}`);
    }

    const inputTokens = apiData.usage?.input_tokens ?? 0;
    const outputTokens = apiData.usage?.output_tokens ?? 0;
    const costUsd = (inputTokens / 1_000_000) * PRICE_INPUT + (outputTokens / 1_000_000) * PRICE_OUTPUT;

    const status = ['ok','warnings','critical'].includes(parsed.status) ? parsed.status : 'ok';

    const { data: auditRow } = await supabase.from('ifood_ai_audits').insert({
      audit_period_id: period_id,
      model_used: MODEL,
      input_hash: inputHash,
      status,
      summary: parsed.summary ?? '',
      anomalies: parsed.anomalies ?? [],
      recommendations: parsed.recommendations ?? [],
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
      duration_ms: Date.now() - startedAt,
    }).select('id').single();

    return new Response(JSON.stringify({
      success: true,
      cached: false,
      audit_id: auditRow?.id,
      status,
      summary: parsed.summary,
      anomalies: parsed.anomalies,
      recommendations: parsed.recommendations,
      cost_usd: costUsd,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});

  } catch (e: any) {
    console.error('audit-ifood-ai error:', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
