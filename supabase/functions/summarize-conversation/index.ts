import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { conversation_id } = await req.json();
    if (!conversation_id) {
      return new Response(JSON.stringify({ error: 'conversation_id obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: msgs } = await supabase
      .from('clau_messages')
      .select('role, content')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: true });

    if (!msgs || msgs.length < 2) {
      return new Response(JSON.stringify({ skipped: true, reason: 'conversa muito curta' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const transcript = msgs.map((m: any) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        system: 'Você gera resumos estruturados de conversas pra serem usados como memória. Responda APENAS em JSON.',
        messages: [{
          role: 'user',
          content: `Resume esta conversa entre Lucas (dono da pizzaria) e a Clau (sua IA):\n\n${transcript}\n\nResponda APENAS com JSON neste formato:\n{\n  "summary": "Resumo de 3-5 frases do que foi discutido e decidido",\n  "topics": ["topico1", "topico2", "topico3"]\n}`,
        }],
      }),
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      return new Response(JSON.stringify({ error: `Anthropic ${apiResp.status}: ${errText}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apiData = await apiResp.json();
    const text = apiData.content?.[0]?.text ?? '';
    let parsed: any;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
    } catch {
      return new Response(JSON.stringify({ error: 'Falha parsing JSON', raw: text }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: upsertErr } = await supabase.from('clau_conversation_summaries').upsert({
      conversation_id,
      summary: parsed.summary ?? '',
      topics: parsed.topics ?? [],
      message_count_when_generated: msgs.length,
      generated_at: new Date().toISOString(),
    });

    if (upsertErr) {
      return new Response(JSON.stringify({ error: upsertErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      summary: parsed.summary,
      topics: parsed.topics,
      message_count: msgs.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
