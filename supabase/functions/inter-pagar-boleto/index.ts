// @ts-nocheck
// inter-pagar-boleto — paga boleto/código de barras via API Inter (mTLS + OAuth2).
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    const { codigo_barras, data_vencimento, valor_pagar, descricao } =
      await req.json().catch(() => ({}));
    const codigoBarras = String(codigo_barras ?? '').replace(/\D/g, '');
    if (!codigoBarras || (codigoBarras.length !== 44 && codigoBarras.length !== 47 && codigoBarras.length !== 48)) {
      return json({ error: 'codigo_barras inválido (esperado 44/47/48 dígitos)' }, 400);
    }
    const hoje = new Date().toISOString().slice(0, 10);
    const dataPagamento = String(data_vencimento ?? hoje).slice(0, 10);

    const payload: Record<string, unknown> = {
      codigoBarras,
      dataPagamento,
    };
    if (valor_pagar !== undefined && valor_pagar !== null && valor_pagar !== '') {
      const v = Number(valor_pagar);
      if (!isFinite(v) || v <= 0) return json({ error: 'valor_pagar inválido' }, 400);
      payload.valorPagar = v;
    }
    if (descricao) payload.descricao = String(descricao);

    const client = buildClient();
    const token = await getToken(client);
    const res = await fetch(`${INTER_BASE}/banking/v2/pagamento`, {
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
    console.error('inter-pagar-boleto error', e);
    return json({ error: e?.message ?? 'Erro inesperado' }, 500);
  }
});
