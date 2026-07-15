// @ts-nocheck
// import-inter — puxa o extrato do Banco Inter Empresas (API REST direta, mTLS)
// e grava em audit_bank_deposits, no mesmo padrão de import-bb / import-cresol.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const INTER_BASE = 'https://cdpj.partners.bancointer.com.br';

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function b64ToText(b64: string): string {
  // Deno atob decodes base64 → binary string → text
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function buildMtlsClient(): Deno.HttpClient {
  const certB64 = Deno.env.get('INTER_CERT_BASE64');
  const keyB64 = Deno.env.get('INTER_KEY_BASE64');
  if (!certB64 || !keyB64) throw new Error('INTER_CERT_BASE64/INTER_KEY_BASE64 não configurados');
  const cert = b64ToText(certB64);
  const key = b64ToText(keyB64);
  // Deno.createHttpClient com mTLS
  return (Deno as any).createHttpClient({ cert, key });
}

async function getInterToken(client: Deno.HttpClient): Promise<string> {
  const clientId = Deno.env.get('INTER_CLIENT_ID');
  const clientSecret = Deno.env.get('INTER_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('INTER_CLIENT_ID/INTER_CLIENT_SECRET não configurados');

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'extrato.read',
  });

  const res = await fetch(`${INTER_BASE}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    client,
  } as any);
  const txt = await res.text();
  if (!res.ok) throw new Error(`OAuth Inter falhou (${res.status}): ${txt}`);
  const parsed = JSON.parse(txt);
  if (!parsed?.access_token) throw new Error(`OAuth Inter sem access_token: ${txt}`);
  return parsed.access_token as string;
}

async function fetchExtrato(
  client: Deno.HttpClient,
  token: string,
  dataInicio: string,
  dataFim: string,
): Promise<any[]> {
  const url = `${INTER_BASE}/banking/v2/extrato?dataInicio=${dataInicio}&dataFim=${dataFim}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    client,
  } as any);
  const txt = await res.text();
  if (!res.ok) throw new Error(`Extrato Inter falhou (${res.status}): ${txt}`);
  const parsed = JSON.parse(txt);
  // Formato Inter v2: { transacoes: [...] }
  const txs = parsed?.transacoes ?? parsed?.movimentacoes ?? parsed ?? [];
  return Array.isArray(txs) ? txs : [];
}

function toIsoDate(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Não autenticado' }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: 'Não autenticado' }, 401);
    const userId = userData.user.id;

    const { data: roleData } = await supabase
      .from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleData) return json({ error: 'Acesso restrito a admin' }, 403);

    const body = await req.json().catch(() => ({}));
    const { audit_period_id, data_inicio, data_fim } = body || {};
    if (!audit_period_id || !data_inicio || !data_fim) {
      return json({ error: 'Parâmetros obrigatórios: audit_period_id, data_inicio, data_fim' }, 400);
    }

    const { data: period, error: pErr } = await supabase
      .from('audit_periods').select('id,status,month,year').eq('id', audit_period_id).maybeSingle();
    if (pErr || !period) return json({ error: 'Período não encontrado' }, 404);
    if (period.status === 'fechado') {
      return json({ error: 'Período fechado. Reabra antes de puxar extratos.' }, 400);
    }
    const wasConciliado = period.status === 'conciliado';

    // mTLS + token
    const client = buildMtlsClient();
    const token = await getInterToken(client);
    const txs = await fetchExtrato(client, token, data_inicio, data_fim);

    // Registra importação
    const fileName = `Inter API — ${data_inicio} a ${data_fim}`;
    const { data: importRec, error: impErr } = await supabase
      .from('audit_imports').insert({
        audit_period_id,
        file_type: 'inter',
        file_name: fileName,
        total_rows: txs.length,
        status: 'pending',
        created_by: userId,
      }).select().single();
    if (impErr) return json({ error: `Erro ao registrar importação: ${impErr.message}` }, 500);

    // Mapeia transações
    const deposits: any[] = [];
    let skipped = 0;
    for (const t of txs) {
      const depositDate = toIsoDate(t.dataEntrada ?? t.dataLancamento ?? t.dataTransacao);
      const descricao = String(t.descricao ?? t.titulo ?? '').trim();
      const detalhes = String(t.detalhes ?? '').trim();
      const rawValor = t.valor ?? t.valorLancamento;
      const valorNum = Number(rawValor);
      if (!depositDate || !descricao || !isFinite(valorNum) || valorNum === 0) { skipped++; continue; }
      // Inter costuma retornar tipoOperacao: 'C' (crédito) / 'D' (débito).
      // Se vier explícito, aplicamos o sinal; caso contrário mantemos o valor como recebido.
      const tipoOp = String(t.tipoOperacao ?? '').toUpperCase();
      let amount = Math.abs(valorNum);
      if (tipoOp === 'D') amount = -amount;
      else if (tipoOp === 'C') amount = Math.abs(valorNum);
      else amount = valorNum; // usa sinal original

      deposits.push({
        audit_period_id,
        import_id: importRec.id,
        bank: 'inter',
        deposit_date: depositDate,
        description: descricao,
        detail: detalhes || null,
        amount,
        category: 'outro',
        auto_categorized: true,
        doc_number: t.idTransacao ? String(t.idTransacao) : null,
      });
    }

    const { count: beforeCount } = await supabase
      .from('audit_bank_deposits')
      .select('id', { count: 'exact', head: true })
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'inter');

    const CHUNK = 200;
    for (let i = 0; i < deposits.length; i += CHUNK) {
      const chunk = deposits.slice(i, i + CHUNK);
      const { error: insErr } = await supabase
        .from('audit_bank_deposits')
        .upsert(chunk, { onConflict: 'audit_period_id,bank,row_hash' });
      if (insErr) {
        await supabase.from('audit_imports').update({
          status: 'failed', error_message: insErr.message,
        }).eq('id', importRec.id);
        return json({ error: `Erro ao inserir: ${insErr.message}` }, 500);
      }
    }

    const { count: afterCount } = await supabase
      .from('audit_bank_deposits')
      .select('id', { count: 'exact', head: true })
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'inter');

    const inserted = (afterCount ?? 0) - (beforeCount ?? 0);
    const duplicates = deposits.length - inserted;

    await supabase.from('audit_imports').update({
      status: 'completed',
      imported_rows: inserted,
      duplicate_rows: duplicates,
    }).eq('id', importRec.id);

    if (period.status === 'aberto') {
      await supabase.from('audit_periods').update({ status: 'importado' }).eq('id', audit_period_id);
    } else if (wasConciliado) {
      await supabase.from('audit_daily_matches').delete().eq('audit_period_id', audit_period_id);
      await supabase.from('audit_periods')
        .update({ status: 'importado', updated_at: new Date().toISOString() })
        .eq('id', audit_period_id);
    }

    return json({
      success: true,
      total: txs.length,
      imported: inserted,
      duplicates,
      skipped,
      message: `${inserted} lançamentos Inter importados`,
    });
  } catch (e: any) {
    console.error('import-inter error', e);
    return json({ error: e?.message ?? 'Erro inesperado' }, 500);
  }
});
