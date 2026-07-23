// @ts-nocheck
// inter-pagar-lote — pagamento em lote de boletos via API Inter.
import { getAuthedUser, isAprovador } from "../_shared/require-user.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const INTER_BASE = 'https://cdpj.partners.bancointer.com.br';

function json(o: any, s = 200) {
  return new Response(JSON.stringify(o), {
    status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function b64ToText(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function buildClient(): Deno.HttpClient {
  const cert = b64ToText(Deno.env.get('INTER_CERT_BASE64') ?? '');
  const key = b64ToText(Deno.env.get('INTER_KEY_BASE64') ?? '');
  if (!cert || !key) throw new Error('INTER_CERT_BASE64/INTER_KEY_BASE64 não configurados');
  return (Deno as any).createHttpClient({ cert, key });
}
async function getToken(client: Deno.HttpClient): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: Deno.env.get('INTER_CLIENT_ID') ?? '',
    client_secret: Deno.env.get('INTER_CLIENT_SECRET') ?? '',
    scope: 'pagamento-boleto.write pagamento-boleto.read',
  });
  const r = await fetch(`${INTER_BASE}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    client,
  } as any);
  const t = await r.text();
  if (!r.ok) throw new Error(`OAuth Inter (${r.status}): ${t}`);
  return JSON.parse(t).access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const user = await getAuthedUser(req);
    if (!user) return json({ error: 'Não autenticado' }, 401);
    if (!isAprovador(user.email)) return json({ error: 'Sem permissão para pagamentos' }, 403);
    const client = buildClient();
    const token = await getToken(client);

    // Consulta status de um lote existente.
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const idLote = url.searchParams.get('idLote') ?? url.searchParams.get('id_lote');
      if (!idLote) return json({ error: 'idLote é obrigatório' }, 400);
      const res = await fetch(`${INTER_BASE}/banking/v2/pagamento/lote/${idLote}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        client,
      } as any);
      const txt = await res.text();
      if (!res.ok) return json({ error: `Inter (${res.status}): ${txt}` }, res.status);
      let parsed: any = null;
      try { parsed = txt ? JSON.parse(txt) : {}; } catch { parsed = { raw: txt }; }
      return json({ ok: true, idLote, ...(parsed ?? {}) });
    }

    // POST — cria lote.
    const { pagamentos, meu_identificador } = await req.json().catch(() => ({}));
    if (!Array.isArray(pagamentos) || pagamentos.length === 0) {
      return json({ error: 'pagamentos deve ser um array não vazio' }, 400);
    }
    if (pagamentos.length > 100) {
      return json({ error: 'máximo de 100 pagamentos por lote' }, 400);
    }

    const items: any[] = [];
    for (const [i, p] of pagamentos.entries()) {
      const cb = String(p?.codigo_barras ?? p?.codigoBarras ?? '').replace(/\D/g, '');
      if (cb.length !== 44 && cb.length !== 47 && cb.length !== 48) {
        return json({ error: `pagamento ${i + 1}: codigo_barras inválido` }, 400);
      }
      const dp = String(p?.data_pagamento ?? p?.dataPagamento ?? '').slice(0, 10);
      if (!dp) return json({ error: `pagamento ${i + 1}: data_pagamento obrigatória` }, 400);
      const v = Number(p?.valor_pagar ?? p?.valorPagar ?? 0);
      if (!isFinite(v) || v <= 0) return json({ error: `pagamento ${i + 1}: valor_pagar inválido` }, 400);
      const it: any = { codBarraLinhaDigitavel: cb, dataVencimento: dp, valorPagar: v };
      if (p?.descricao) it.descricao = String(p.descricao);
      items.push(it);
    }

    const meuIdentificador = String(meu_identificador ?? crypto.randomUUID());
    const payload = { meuIdentificador, pagamentos: items };

    const res = await fetch(`${INTER_BASE}/banking/v2/pagamento/lote`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      client,
    } as any);
    const txt = await res.text();
    if (!res.ok) return json({ error: `Inter (${res.status}): ${txt}`, payload }, res.status);
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : {}; } catch { parsed = { raw: txt }; }
    return json({ ok: true, meuIdentificador, ...(parsed ?? {}) });
  } catch (e: any) {
    console.error('inter-pagar-lote error', e);
    return json({ error: e?.message ?? 'Erro inesperado' }, 500);
  }
});
