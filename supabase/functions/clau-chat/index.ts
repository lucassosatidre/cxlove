import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { fetchAllPaginated } from '../_shared/pagination.ts';

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

// ============================================================
// TOOLS — Camada B (read-only DB + memória contínua)
// ============================================================
const TOOLS = [
  {
    name: 'get_period_summary',
    description: 'Retorna totais consolidados de um período de auditoria: vendido, recebido competência, recebido adjacente, agrupado por categoria (ifood, alelo, ticket, pluxee, vr).',
    input_schema: {
      type: 'object',
      properties: { period_id: { type: 'string', description: 'UUID do audit_period' } },
      required: ['period_id'],
    },
  },
  {
    name: 'get_voucher_audit',
    description: 'Retorna a linha do audit_voucher_competencia (vendido, reconhecido, pago bruto, pago líquido, taxa real) por operadora.',
    input_schema: {
      type: 'object',
      properties: {
        period_id: { type: 'string' },
        operadora: { type: 'string', enum: ['alelo', 'ticket', 'pluxee', 'vr'] },
      },
      required: ['period_id'],
    },
  },
  {
    name: 'get_voucher_lots',
    description: 'Lista lotes de voucher importados com bruto, líquido, data de pagamento e se já casaram com depósito BB.',
    input_schema: {
      type: 'object',
      properties: {
        period_id: { type: 'string' },
        operadora: { type: 'string', enum: ['alelo', 'ticket', 'pluxee', 'vr'] },
        status: { type: 'string', enum: ['matched', 'pending', 'all'] },
        limit: { type: 'integer', default: 50 },
      },
      required: ['period_id'],
    },
  },
  {
    name: 'get_bank_deposits',
    description: 'Lista depósitos bancários (Cresol/iFood ou BB/Vouchers) com matched_competencia, matched_adjacente e match_status.',
    input_schema: {
      type: 'object',
      properties: {
        period_id: { type: 'string' },
        bank: { type: 'string', enum: ['cresol', 'bb'] },
        category: { type: 'string', enum: ['ifood', 'alelo', 'ticket', 'pluxee', 'vr', 'brendi', 'outro'] },
        status: { type: 'string', enum: ['matched', 'fora_periodo', 'pending', 'all'] },
        limit: { type: 'integer', default: 50 },
      },
      required: ['period_id'],
    },
  },
  {
    name: 'get_maquinona_sales',
    description: 'Lista vendas Maquinona (audit_card_transactions) com bruto, líquido, expected_deposit_date.',
    input_schema: {
      type: 'object',
      properties: {
        period_id: { type: 'string' },
        deposit_group: { type: 'string', enum: ['ifood', 'alelo', 'ticket', 'pluxee', 'vr'] },
        sale_date_from: { type: 'string', description: 'YYYY-MM-DD' },
        sale_date_to: { type: 'string', description: 'YYYY-MM-DD' },
        is_competencia_only: { type: 'boolean', default: true },
        limit: { type: 'integer', default: 100 },
      },
      required: ['period_id'],
    },
  },
  {
    name: 'run_query',
    description: 'Executa SELECT customizado nas tabelas de auditoria. Use APENAS quando as tools específicas não cobrirem. Permitido apenas SELECT/WITH com LIMIT.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Query SQL começando com SELECT ou WITH' },
        explanation: { type: 'string', description: 'Por que essa query é necessária' },
      },
      required: ['sql', 'explanation'],
    },
  },
  {
    name: 'search_past_chats',
    description: 'Busca em conversas anteriores e resumos por palavras-chave (full-text em português). Use quando o usuário referenciar algo discutido antes.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Termos de busca' },
        limit: { type: 'integer', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'recall',
    description: 'Combinação inteligente: fatos auto-extraídos + resumos relacionados a um tópico. Use no início quando perguntarem sobre passado.',
    input_schema: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'Tópico a buscar' } },
      required: ['topic'],
    },
  },
  {
    name: 'extract_fact',
    description: 'Salva um fato útil afirmado pelo usuário (ex: "VR cobra 17,5% real", "operadora X paga D+5"). NÃO USE pra coisas óbvias ou triviais.',
    input_schema: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'Fato a salvar (frase única, objetiva)' },
        category: { type: 'string', enum: ['voucher', 'ifood', 'fornecedor', 'colaborador', 'sistema', 'outro'] },
      },
      required: ['fact', 'category'],
    },
  },
];

const SYSTEM_PROMPT_TEMPLATE = `Você é a Clau, assistente IA da Pizzaria Estrela da Ilha, integrada ao CX Love (sistema de gestão operacional do Lucas, dono).

# Personalidade
- Direta, honesta, sem bajulação. Discorda quando o usuário tá errado e explica o porquê.
- Português brasileiro, tom natural.
- Concisa por padrão. Detalhada só quando o usuário pede análise.
- Nunca inventa dados — busca via tool ou pede pro usuário colar.

# Memória do projeto
{PROJECT_MEMORY}

# Contexto da tela atual
Página: {CURRENT_PAGE}
Dados visíveis:
{SCREEN_CONTEXT}

# Resumos relevantes (pinados + auto)
{PINNED_SUMMARIES}

# Suas capacidades (Camada B ativa)
Você tem ACESSO READ-ONLY ao banco de dados via 9 tools:

## Tools específicas (use primeiro, mais rápidas):
- **get_period_summary(period_id)** — totais consolidados (vendido/recebido por categoria)
- **get_voucher_audit(period_id, operadora?)** — auditoria de voucher
- **get_voucher_lots(period_id, operadora?, status?)** — lotes de extratos voucher
- **get_bank_deposits(period_id, bank?, category?, status?)** — depósitos Cresol/BB
- **get_maquinona_sales(period_id, deposit_group?, ...)** — vendas Maquinona

## Tools de memória:
- **search_past_chats(query)** — busca em mensagens e resumos antigos
- **recall(topic)** — fatos extraídos + resumos sobre um tópico
- **extract_fact(fact, category)** — salva fato útil afirmado pelo usuário

## SQL livre (último recurso):
- **run_query(sql, explanation)** — SELECT em tabelas audit_*, voucher_*, clau_extracted_facts, clau_conversation_summaries. Auto LIMIT 100, timeout 5s.

# Esquema principal

## audit_periods: id, month, year, status
## audit_card_transactions (vendas Maquinona):
audit_period_id, sale_date, deposit_group (ifood|alelo|ticket|pluxee|vr), brand, gross_amount, net_amount, expected_deposit_date, is_competencia
## audit_bank_deposits:
audit_period_id, bank (cresol|bb), category, deposit_date, amount, matched_competencia_amount, matched_adjacente_amount, match_status (matched|fora_periodo|pending)
## voucher_lots:
audit_period_id, operadora, gross_amount, net_amount, data_pagamento, data_corte, bb_deposit_id
## voucher_lot_items:
lot_id, gross_amount, net_amount, data_transacao, maquinona_match_id
## audit_voucher_competencia (view):
audit_period_id, operadora, vendido_bruto, reconhecido_bruto, pago_bruto, pago_liquido, taxa_real_pct, taxa_estimada_pct

# Como agir
1. Pergunta operacional simples → responde direto sem tools
2. Pergunta de dados → tool específica primeiro, run_query só se necessário
3. Pergunta sobre passado → search_past_chats ou recall
4. Usuário afirmou fato útil → extract_fact (categoria correta)
5. Discorda → fala honestamente
6. Não sabe → admite, não inventa

# Formato
- Markdown simples (negrito, listas)
- Mostra o que encontrou de forma clara (tabela/lista)
- Se tool retornar muito dado, resume e ofereça detalhes
- Nunca expõe SQL/estruturas técnicas sem necessidade
- Emojis moderados (1-2)`;

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

// ============================================================
// Tool executor
// ============================================================
async function executeTool(
  toolName: string,
  input: any,
  supabase: any,
  userId: string,
  conversationId: string,
): Promise<{ result: any; error?: string }> {
  const startedAt = Date.now();
  try {
    let result: any;

    switch (toolName) {
      case 'get_period_summary': {
        const { period_id } = input;
        // Paginado: audit_bank_deposits e audit_card_transactions podem
        // facilmente passar de 1000 rows num período mensal cheio.
        const deps = await fetchAllPaginated<any>(
          supabase
            .from('audit_bank_deposits')
            .select('bank, category, match_status, amount, matched_competencia_amount, matched_adjacente_amount')
            .eq('audit_period_id', period_id),
        );
        const sales = await fetchAllPaginated<any>(
          supabase
            .from('audit_card_transactions')
            .select('deposit_group, gross_amount, net_amount, is_competencia')
            .eq('audit_period_id', period_id)
            .eq('is_competencia', true),
        );
        const summary: any = {};
        for (const cat of ['ifood', 'alelo', 'ticket', 'pluxee', 'vr']) {
          const venda = (sales ?? []).filter((s: any) => s.deposit_group === cat);
          const dep = (deps ?? []).filter((d: any) => d.category === cat);
          summary[cat] = {
            vendido_bruto: venda.reduce((s: number, x: any) => s + Number(x.gross_amount), 0),
            vendido_liquido: venda.reduce((s: number, x: any) => s + Number(x.net_amount), 0),
            recebido_competencia: dep.reduce((s: number, x: any) => s + Number(x.matched_competencia_amount || 0), 0),
            recebido_adjacente: dep.reduce((s: number, x: any) => s + Number(x.matched_adjacente_amount || 0), 0),
            depositos_total: dep.reduce((s: number, x: any) => s + Number(x.amount || 0), 0),
            qtd_vendas: venda.length,
            qtd_depositos: dep.length,
          };
        }
        result = summary;
        break;
      }

      case 'get_voucher_audit': {
        const { period_id, operadora } = input;
        let q = supabase.from('audit_voucher_competencia').select('*').eq('audit_period_id', period_id);
        if (operadora) q = q.eq('operadora', operadora);
        const { data, error } = await q;
        if (error) throw error;
        result = data;
        break;
      }

      case 'get_voucher_lots': {
        const { period_id, operadora, status, limit = 50 } = input;
        let q = supabase
          .from('voucher_lots')
          .select('id, operadora, gross_amount, net_amount, data_pagamento, data_corte, bb_deposit_id, status')
          .eq('audit_period_id', period_id)
          .order('data_pagamento', { ascending: false })
          .limit(Math.min(limit, 200));
        if (operadora) q = q.eq('operadora', operadora);
        if (status === 'matched') q = q.not('bb_deposit_id', 'is', null);
        else if (status === 'pending') q = q.is('bb_deposit_id', null);
        const { data, error } = await q;
        if (error) throw error;
        result = data;
        break;
      }

      case 'get_bank_deposits': {
        const { period_id, bank, category, status, limit = 50 } = input;
        let q = supabase
          .from('audit_bank_deposits')
          .select('id, bank, category, deposit_date, amount, matched_competencia_amount, matched_adjacente_amount, match_status, match_reason')
          .eq('audit_period_id', period_id)
          .order('deposit_date', { ascending: false })
          .limit(Math.min(limit, 200));
        if (bank) q = q.eq('bank', bank);
        if (category) q = q.eq('category', category);
        if (status && status !== 'all') q = q.eq('match_status', status);
        const { data, error } = await q;
        if (error) throw error;
        result = data;
        break;
      }

      case 'get_maquinona_sales': {
        const { period_id, deposit_group, sale_date_from, sale_date_to, is_competencia_only = true, limit = 100 } = input;
        let q = supabase
          .from('audit_card_transactions')
          .select('id, sale_date, deposit_group, brand, gross_amount, net_amount, expected_deposit_date, is_competencia')
          .eq('audit_period_id', period_id)
          .order('sale_date', { ascending: false })
          .limit(Math.min(limit, 500));
        if (deposit_group) q = q.eq('deposit_group', deposit_group);
        if (is_competencia_only) q = q.eq('is_competencia', true);
        if (sale_date_from) q = q.gte('sale_date', sale_date_from);
        if (sale_date_to) q = q.lte('sale_date', sale_date_to);
        const { data, error } = await q;
        if (error) throw error;
        result = data;
        break;
      }

      case 'run_query': {
        const { sql } = input;
        const ALLOWED_TABLES = new Set([
          'audit_periods', 'audit_card_transactions', 'audit_bank_deposits',
          'audit_voucher_matches', 'audit_daily_matches', 'audit_imports',
          'audit_voucher_competencia', 'audit_period_log',
          'voucher_lots', 'voucher_lot_items', 'voucher_expected_rates',
          'voucher_imports', 'voucher_adjustments',
          'voucher_ai_audits', 'ifood_ai_audits',
          'clau_extracted_facts', 'clau_conversation_summaries',
        ]);
        const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|EXECUTE|COPY|VACUUM)\b/i;
        const MULTI_STATEMENT = /;\s*\S/;
        const trimmed = sql.trim();
        if (!trimmed.match(/^SELECT\b/i) && !trimmed.match(/^WITH\b/i)) {
          throw new Error('Apenas SELECT/WITH permitido');
        }
        if (FORBIDDEN.test(trimmed)) {
          throw new Error('SQL bloqueado: contém operações proibidas');
        }
        if (MULTI_STATEMENT.test(trimmed.replace(/;\s*$/, ''))) {
          throw new Error('Apenas 1 statement por chamada');
        }
        const fromMatches = trimmed.match(/(?:FROM|JOIN)\s+([a-z_]+)/gi) || [];
        const tablesUsed = new Set(fromMatches.map((m: string) => m.replace(/^.*\s/, '').toLowerCase()));
        for (const t of tablesUsed) {
          if (!ALLOWED_TABLES.has(t)) {
            throw new Error(`Tabela "${t}" não permitida na allowlist`);
          }
        }
        let finalSql = trimmed;
        if (!/\bLIMIT\b/i.test(finalSql)) {
          finalSql = finalSql.replace(/;?\s*$/, '') + ' LIMIT 100';
        }
        const { data, error } = await supabase.rpc('clau_safe_query', { p_sql: finalSql });
        if (error) throw error;
        result = data;
        break;
      }

      case 'search_past_chats': {
        const { query, limit = 10 } = input;
        const { data: msgs } = await supabase.rpc('clau_search_messages', {
          p_user_id: userId, p_query: query, p_limit: Math.min(limit, 30),
        });
        const { data: sums } = await supabase.rpc('clau_search_summaries', {
          p_user_id: userId, p_query: query, p_limit: Math.min(limit, 10),
        });
        result = { mensagens: msgs ?? [], resumos: sums ?? [] };
        break;
      }

      case 'recall': {
        const { topic } = input;
        const { data: facts } = await supabase
          .from('clau_extracted_facts')
          .select('fact, category, created_at')
          .eq('archived', false)
          .textSearch('search_vector', topic, { type: 'websearch', config: 'portuguese' })
          .limit(20);
        const { data: sums } = await supabase.rpc('clau_search_summaries', {
          p_user_id: userId, p_query: topic, p_limit: 5,
        });
        result = { fatos: facts ?? [], resumos: sums ?? [] };
        break;
      }

      case 'extract_fact': {
        const { fact, category } = input;
        const { data, error } = await supabase
          .from('clau_extracted_facts')
          .insert({
            fact, category,
            source_conversation_id: conversationId,
            confirmed_by_user: false,
          })
          .select('id').single();
        if (error) throw error;
        result = { saved: true, fact_id: data.id, message: `Fato salvo na categoria '${category}'.` };
        break;
      }

      default:
        throw new Error(`Tool desconhecida: ${toolName}`);
    }

    const duration = Date.now() - startedAt;
    const outputSize = JSON.stringify(result ?? {}).length;
    await supabase.from('clau_tool_logs').insert({
      conversation_id: conversationId,
      user_id: userId,
      tool_name: toolName,
      tool_input: input,
      tool_output_size: outputSize,
      duration_ms: duration,
    });
    return { result };

  } catch (e: any) {
    const duration = Date.now() - startedAt;
    await supabase.from('clau_tool_logs').insert({
      conversation_id: conversationId,
      user_id: userId,
      tool_name: toolName,
      tool_input: input,
      duration_ms: duration,
      error: e.message,
    });
    return { result: null, error: e.message };
  }
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

    const validatedRequested = requestedModel && ALLOWED_MODELS.has(requestedModel) ? requestedModel : null;

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
      await supabase.from('clau_conversations').update({ model: validatedRequested }).eq('id', convId);
      convModel = validatedRequested;
    } else {
      const { data: existing } = await supabase
        .from('clau_conversations').select('model').eq('id', convId).single();
      convModel = (existing?.model && ALLOWED_MODELS.has(existing.model)) ? existing.model : DEFAULT_MODEL;
    }

    // Project memory
    const { data: memory } = await supabase
      .from('clau_project_memory').select('content').eq('app_origin', 'cx-love').maybeSingle();
    const projectMemory = memory?.content ?? '(memória vazia)';

    // Manual pinned + auto summaries
    const { data: manualPinned } = await supabase
      .from('clau_conversations')
      .select('title, summary, updated_at')
      .eq('user_id', userId)
      .eq('is_pinned', true)
      .not('summary', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(5);

    const { data: autoSummaries } = await supabase
      .from('clau_conversation_summaries')
      .select('conversation_id, summary, topics, generated_at, clau_conversations!inner(title, user_id)')
      .eq('clau_conversations.user_id', userId)
      .order('generated_at', { ascending: false })
      .limit(10);

    const manualBlock = (manualPinned ?? [])
      .map((p: any) => `## [PINADA] ${p.title ?? 'Sem título'} (${new Date(p.updated_at).toLocaleDateString('pt-BR')})\n${p.summary}`)
      .join('\n\n');
    const autoBlock = (autoSummaries ?? [])
      .map((s: any) => `## ${s.clau_conversations?.title ?? 'Sem título'} (${new Date(s.generated_at).toLocaleDateString('pt-BR')}) — ${s.topics?.join(', ') ?? ''}\n${s.summary}`)
      .join('\n\n');
    const pinnedSummaries = [manualBlock, autoBlock].filter(Boolean).join('\n\n') || '(nenhum resumo disponível ainda)';

    // History
    const { data: history } = await supabase
      .from('clau_messages')
      .select('role, content')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });

    const systemPrompt = SYSTEM_PROMPT_TEMPLATE
      .replace('{PROJECT_MEMORY}', projectMemory)
      .replace('{CURRENT_PAGE}', current_page ?? '(desconhecida)')
      .replace('{SCREEN_CONTEXT}', JSON.stringify(screen_context ?? {}, null, 2))
      .replace('{PINNED_SUMMARIES}', pinnedSummaries);

    // Save user message
    const { error: userMsgErr } = await supabase
      .from('clau_messages')
      .insert({
        conversation_id: convId,
        role: 'user',
        content: user_message,
        context_snapshot: { current_page, screen_context },
      });
    if (userMsgErr) console.error('Erro salvando user msg:', userMsgErr);

    // "lembra disso" detector
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

    // Build initial messages
    const initialMessages = [
      ...(history ?? []).map((h: any) => ({ role: h.role, content: h.content })),
      { role: 'user', content: user_message },
    ];

    // ================================
    // Tool use loop (max 5 iterations)
    // ================================
    const MAX_TOOL_ITERATIONS = 5;
    let iterations = 0;
    let currentMessages: any[] = [...initialMessages];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalText = '';
    const toolsUsedSummary: string[] = [];

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: convModel,
          max_tokens: 4000,
          system: systemPrompt,
          messages: currentMessages,
          tools: TOOLS,
        }),
      });

      if (!apiResp.ok) {
        const errText = await apiResp.text();
        console.error('Anthropic error:', apiResp.status, errText);
        return errResponse(`Erro Anthropic: ${apiResp.status} ${errText}`, 500);
      }

      const apiData = await apiResp.json();
      totalInputTokens += apiData.usage?.input_tokens ?? 0;
      totalOutputTokens += apiData.usage?.output_tokens ?? 0;

      const textBlocks = (apiData.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text);
      const toolUseBlocks = (apiData.content ?? []).filter((b: any) => b.type === 'tool_use');

      if (toolUseBlocks.length === 0) {
        finalText = textBlocks.join('\n');
        break;
      }

      currentMessages.push({ role: 'assistant', content: apiData.content });

      const toolResults: any[] = [];
      for (const toolUse of toolUseBlocks) {
        toolsUsedSummary.push(toolUse.name);
        const { result, error } = await executeTool(
          toolUse.name, toolUse.input, supabase, userId, convId,
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: error ? `ERRO: ${error}` : JSON.stringify(result).slice(0, 50000),
          is_error: !!error,
        });
      }
      currentMessages.push({ role: 'user', content: toolResults });
    }

    if (!finalText) {
      finalText = `(Limite de ${MAX_TOOL_ITERATIONS} iterações de ferramentas atingido. Tente reformular a pergunta.)`;
    }

    const tokensUsed = totalInputTokens + totalOutputTokens;
    finalText = finalText + memoryUpdateNote;

    // Save assistant message
    await supabase
      .from('clau_messages')
      .insert({
        conversation_id: convId,
        role: 'assistant',
        content: finalText,
        tokens_used: tokensUsed,
      });

    // Update stats
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
      model: convModel,
      tools_used: toolsUsedSummary,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('clau-chat error:', msg);
    return errResponse(msg, 500);
  }
});
