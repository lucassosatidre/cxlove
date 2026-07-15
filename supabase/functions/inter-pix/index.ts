// @ts-nocheck
// inter-pix — envia Pix por chave via API Inter (mTLS + OAuth2).
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
    scope: 'pagamento-pix.write pagamento-pix.read',
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

function detectTipoChave(chave: string): string {
  const s = String(chave).trim();
  if (/^\+?\d{10,15}$/.test(s.replace(/\D/g, '')) && s.length <= 20 && /\+?55/.test(s)) return 'TELEFONE';
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 && !s.includes('@')) return 'CPF';
  if (digits.length === 14) return 'CNPJ';
  if (s.includes('@')) return 'EMAIL';
  // UUID / EVP
  if (/^[0-9a-fA-F-]{32,36}$/.test(s)) return 'CHAVE_ALEATORIA';
  return 'CHAVE_ALEATORIA';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const client = buildClient();
    const token = await getToken(client);

    // Consulta status de um Pix.
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const codigo = url.searchParams.get('codigo_solicitacao') ?? url.searchParams.get('codigoSolicitacao');
      if (!codigo) return json({ error: 'codigo_solicitacao é obrigatório' }, 400);
      const res = await fetch(`${INTER_BASE}/banking/v2/pix/${codigo}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        client,
      } as any);
      const txt = await res.text();
      if (!res.ok) return json({ error: `Inter (${res.status}): ${txt}` }, res.status);
      let parsed: any = null;
      try { parsed = txt ? JSON.parse(txt) : {}; } catch { parsed = { raw: txt }; }
      return json({ ok: true, codigoSolicitacao: codigo, ...(parsed ?? {}) });
    }

    const { chave_pix, valor, descricao, data_pagamento } = await req.json().catch(() => ({}));
    const chave = String(chave_pix ?? '').trim();
    const v = Number(valor);
    if (!chave) return json({ error: 'chave_pix obrigatória' }, 400);
    if (!isFinite(v) || v <= 0) return json({ error: 'valor inválido' }, 400);

    const payload: Record<string, unknown> = {
      valor: v,
      destinatario: { tipo: detectTipoChave(chave), chave },
    };
    if (descricao) payload.descricao = String(descricao).slice(0, 140);
    if (data_pagamento) payload.dataPagamento = String(data_pagamento).slice(0, 10);

    const res = await fetch(`${INTER_BASE}/banking/v2/pix`, {
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
    return json({ ok: true, ...(parsed ?? {}) });
  } catch (e: any) {
    console.error('inter-pix error', e);
    return json({ error: e?.message ?? 'Erro inesperado' }, 500);
  }
});
