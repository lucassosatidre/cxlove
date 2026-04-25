import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
]);

const SYSTEM_PROMPT_TEMPLATE = `Você é a Clau, assistente IA da Pizzaria Estrela da Ilha, integrada ao CX Love (sistema de gestão operacional do Lucas).

# Suas características
- Personalidade direta, sem bajulação
- Responde em português brasileiro, tom natural e confiável
- Sincera quando algo não está certo (incluindo discordar do usuário)
- Foca em ajudar a operação prática (caixa, auditoria, conciliação, vouchers)
- Concisa por padrão, mas detalhada quando o usuário pede análise

# Memória do projeto (informações fixas)
{PROJECT_MEMORY}

# Contexto da tela atual
O usuário está navegando em: {CURRENT_PAGE}
Dados visíveis na tela:
{SCREEN_CONTEXT}

# Conversas anteriores relevantes (resumos pinados)
{PINNED_SUMMARIES}

# Suas capacidades
- Ler dados que o usuário cola/digita
- Analisar contexto da tela atual que o sistema te envia
- Lembrar informações com o comando "lembra disso: ..."
- Pedir ao usuário pra colar dados específicos quando precisar
- NÃO acessa banco de dados diretamente (ainda)
- NÃO acessa código fonte

# Como agir
- Se for pergunta operacional simples: responde direto
- Se precisar de dados que não tem: pede ao usuário pra colar
- Se o usuário disser "lembra disso" ou "anota": confirma e o sistema salva
- Se discordar de algo: fala honestamente e explica
- Se não souber: admite, não inventa

# Formato de respostas
- Markdown simples (negrito, listas se necessário)
- Cabeçalhos só quando resposta longa
- Códigos em blocos quando aplicável
- Nunca emojis em excesso (1-2 quando útil, no máximo)`;

function errResponse(msg: string, status: number) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getCurrentTokens(supabase: any, convId: string): Promise<number> {
  const { data } = await supabase
    .from('clau_conversations')
    .select('total_tokens_used')
    .eq('id', convId)
    .single();
  return data?.total_tokens_used ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errResponse('Não autenticado', 401);

    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return errResponse('Não autenticado', 401);
    const userId = userData.user.id;

    const { data: roleData } = await supabase
      .from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleData) return errResponse('Acesso restrito a admin', 403);

    const body = await req.json();
    const { conversation_id, user_message, current_page, screen_context, model: requestedModel } = body;

    if (!user_message || typeof user_message !== 'string') {
      return errResponse('Mensagem obrigatória', 400);
    }

    // Pick model: explicit request > conversation stored > default
    const validatedRequested = requestedModel && ALLOWED_MODELS.has(requestedModel) ? requestedModel : null;

    // 1. Get or create conversation
    let convId = conversation_id;
    let convModel: string = validatedRequested ?? DEFAULT_MODEL;
    if (!convId) {
      const { data: newConv, error: convErr } = await supabase
        .from('clau_conversations')
        .insert({ user_id: userId, app_origin: 'cx-love', model: convModel })
        .select('id, model').single();
      if (convErr) return errResponse(`Erro ao criar conversa: ${convErr.message}`, 500);
      convId = newConv.id;
      convModel = newConv.model ?? convModel;
    } else if (validatedRequested) {
      // Update model if user changed it for an existing conversation
      await supabase.from('clau_conversations').update({ model: validatedRequested }).eq('id', convId);
      convModel = validatedRequested;
    } else {
      const { data: existing } = await supabase
        .from('clau_conversations').select('model').eq('id', convId).single();
      convModel = (existing?.model && ALLOWED_MODELS.has(existing.model)) ? existing.model : DEFAULT_MODEL;
    }

    // 2. Project memory
    const { data: memory } = await supabase
      .from('clau_project_memory')
      .select('content')
      .eq('app_origin', 'cx-love')
      .maybeSingle();
    const projectMemory = memory?.content ?? '(memória vazia)';

    // 3. Pinned summaries
    const { data: pinned } = await supabase
      .from('clau_conversations')
      .select('title, summary, updated_at')
      .eq('user_id', userId)
      .eq('is_pinned', true)
      .not('summary', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(5);

    const pinnedSummaries = (pinned ?? [])
      .map((p: any) => `## ${p.title ?? 'Sem título'} (${new Date(p.updated_at).toLocaleDateString('pt-BR')})\n${p.summary}`)
      .join('\n\n') || '(nenhuma conversa pinada)';

    // 4. History
    const { data: history } = await supabase
      .from('clau_messages')
      .select('role, content')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });

    // 5. System prompt
    const systemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace('{PROJECT_MEMORY}', projectMemory)
      .replace('{CURRENT_PAGE}', current_page ?? '(desconhecida)')
      .replace('{SCREEN_CONTEXT}', JSON.stringify(screen_context ?? {}, null, 2))
      .replace('{PINNED_SUMMARIES}', pinnedSummaries);

    // 6. Save user message
    const { error: userMsgErr } = await supabase
      .from('clau_messages')
      .insert({
        conversation_id: convId,
        role: 'user',
        content: user_message,
        context_snapshot: { current_page, screen_context }
      });
    if (userMsgErr) console.error('Erro salvando user msg:', userMsgErr);

    // 7. Detect "lembra disso"
    const memoryUpdatePattern = /^(lembra|anota|salva)\s+(disso|isso|na\s+mem[oó]ria)\s*:?\s*(.+)/i;
    const memoryMatch = user_message.match(memoryUpdatePattern);
    
    let memoryUpdateNote = '';
    if (memoryMatch) {
      const newFact = memoryMatch[3].trim();
      const updatedContent = projectMemory + `\n\n## Adicionado em ${new Date().toLocaleDateString('pt-BR')}\n- ${newFact}`;
      
      await supabase
        .from('clau_project_memory')
        .update({ content: updatedContent, updated_at: new Date().toISOString(), updated_by: userId })
        .eq('app_origin', 'cx-love');
      
      memoryUpdateNote = `\n\n[Sistema: anotação adicionada à memória do projeto]`;
    }

    // 8. Build messages
    const messages = [
      ...(history ?? []).map((h: any) => ({ role: h.role, content: h.content })),
      { role: 'user', content: user_message }
    ];

    // 9. Call Anthropic
    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system: systemPrompt,
        messages: messages,
      }),
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      console.error('Anthropic error:', apiResp.status, errText);
      return errResponse(`Erro Anthropic: ${apiResp.status} ${errText}`, 500);
    }

    const apiData = await apiResp.json();
    const assistantText = apiData.content?.[0]?.text ?? '(resposta vazia)';
    const tokensUsed = (apiData.usage?.input_tokens ?? 0) + (apiData.usage?.output_tokens ?? 0);
    const finalText = assistantText + memoryUpdateNote;

    // 10. Save assistant message
    await supabase
      .from('clau_messages')
      .insert({
        conversation_id: convId,
        role: 'assistant',
        content: finalText,
        tokens_used: tokensUsed,
      });

    // 11. Update stats
    const { count } = await supabase
      .from('clau_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', convId);

    let newTitle = null;
    if ((count ?? 0) <= 2) {
      newTitle = user_message.slice(0, 60).trim() + (user_message.length > 60 ? '...' : '');
    }

    await supabase
      .from('clau_conversations')
      .update({
        message_count: count ?? 0,
        total_tokens_used: (await getCurrentTokens(supabase, convId)) + tokensUsed,
        updated_at: new Date().toISOString(),
        ...(newTitle ? { title: newTitle } : {}),
      })
      .eq('id', convId);

    return new Response(JSON.stringify({
      success: true,
      conversation_id: convId,
      assistant_message: finalText,
      tokens_used: tokensUsed,
      memory_updated: !!memoryMatch,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('clau-chat error:', msg);
    return errResponse(msg, 500);
  }
});
