// @ts-nocheck
// inter-webhook-register — cadastra a URL do webhook no Banco Inter (mTLS + OAuth2 webhook.write).

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const INTER_BASE = 'https://cdpj.partners.bancointer.com.br';
const WEBHOOK_URL = 'https://hvpmkkxvvjnefayrlcjy.supabase.co/functions/v1/inter-webhook';

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function b64ToText(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function buildMtlsClient(): Deno.HttpClient {
  const certB64 = Deno.env.get('INTER_CERT_BASE64');
  const keyB64 = Deno.env.get('INTER_KEY_BASE64');
  if (!certB64 || !keyB64) throw new Error('INTER_CERT_BASE64/INTER_KEY_BASE64 não configurados');
  return (Deno as any).createHttpClient({ cert: b64ToText(certB64), key: b64ToText(keyB64) });
}

async function getToken(client: Deno.HttpClient, scope: string): Promise<string> {
  const clientId = Deno.env.get('INTER_CLIENT_ID');
  const clientSecret = Deno.env.get('INTER_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('INTER_CLIENT_ID/INTER_CLIENT_SECRET não configurados');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });
  const res = await fetch(`${INTER_BASE}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    client,
  } as any);
  const txt = await res.text();
  if (!res.ok) throw new Error(`OAuth Inter (${scope}) falhou (${res.status}): ${txt}`);
  return JSON.parse(txt).access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const tipo = String(body?.tipo ?? 'transacao').toLowerCase();
    const ALLOWED = ['pix', 'boleto', 'ted', 'transacao'];
    if (!ALLOWED.includes(tipo)) return json({ error: `tipo inválido (use ${ALLOWED.join('|')})` }, 400);

    const client = buildMtlsClient();
    // Extrato + webhook: usamos escopos amplos suportados; se o Inter pedir só webhook.write, ele aceita.
    const token = await getToken(client, 'extrato.read webhook.write');

    const res = await fetch(`${INTER_BASE}/banking/v2/webhooks/${tipo}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ webhookUrl: WEBHOOK_URL }),
      client,
    } as any);
    const txt = await res.text();
    if (!res.ok) return json({ error: `Inter respondeu ${res.status}: ${txt}`, tipo, webhookUrl: WEBHOOK_URL }, 500);

    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return json({ ok: true, tipo, webhookUrl: WEBHOOK_URL, response: parsed });
  } catch (e: any) {
    console.error('inter-webhook-register error', e);
    return json({ error: e?.message ?? 'Erro inesperado' }, 500);
  }
});
