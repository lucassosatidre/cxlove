// @ts-nocheck
// inter-dda-probe — TESTE temporário: DDA na API Inter (endpoints com 1 token + escopos espaçados).
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const INTER_BASE = 'https://cdpj.partners.bancointer.com.br';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function b64ToText(b64: string): string {
  const bin = atob((b64 || '').replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function buildClient(): any {
  const cert = b64ToText(Deno.env.get('INTER_CERT_BASE64') ?? '');
  const key = b64ToText(Deno.env.get('INTER_KEY_BASE64') ?? '');
  if (!cert || !key) throw new Error('INTER_CERT_BASE64/INTER_KEY_BASE64 ausentes');
  return (Deno as any).createHttpClient({ cert, key });
}
async function tokenFor(client: any, scope: string) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: Deno.env.get('INTER_CLIENT_ID') ?? '',
    client_secret: Deno.env.get('INTER_CLIENT_SECRET') ?? '',
    scope,
  });
  const r = await fetch(`${INTER_BASE}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    client,
  } as any);
  const t = await r.text();
  let token: string | null = null;
  try { token = r.ok ? JSON.parse(t).access_token : null; } catch { token = null; }
  return { ok: r.ok, status: r.status, body: t.slice(0, 300), token };
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const out: any = { baseToken: null, endpoints: [], scopes: [] };
  try {
    const client = buildClient();
    // 1) UM token válido conhecido, reutilizado para todos os endpoints
    const base = await tokenFor(client, 'pagamento-boleto.read pagamento-boleto.write');
    out.baseToken = { ok: base.ok, status: base.status, body: base.ok ? '(ok)' : base.body };
    if (base.token) {
      const today = new Date().toISOString().slice(0, 10);
      const d = new Date(); d.setMonth(d.getMonth() - 1);
      const from = d.toISOString().slice(0, 10);
      const eps = [
        '/banking/v2/pagamento',
        '/banking/v2/pagamentos',
        '/banking/v2/pagamento/dda',
        '/banking/v2/dda',
        '/banking/v2/dda/boletos',
        '/banking/v2/boletos',
        '/banking/v2/boletos-a-pagar',
        '/banking/v2/pagamento/boletos',
        '/banking/v2/pagamento/agenda',
        `/banking/v2/pagamento/dda?dataInicial=${from}&dataFinal=${today}`,
        `/banking/v2/dda?dataInicial=${from}&dataFinal=${today}`,
        '/banking/v3/pagamento',
        '/banking/v2/pagamento/buscar',
      ];
      for (const ep of eps) {
        try {
          const r = await fetch(`${INTER_BASE}${ep}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${base.token}`, Accept: 'application/json' },
            client,
          } as any);
          const t = await r.text();
          out.endpoints.push({ ep, status: r.status, body: t.slice(0, 300) });
        } catch (e: any) {
          out.endpoints.push({ ep, error: String(e?.message ?? e).slice(0, 200) });
        }
        await sleep(400);
      }
    }
    // 2) escopos DDA candidatos, ESPAÇADOS (evita 429)
    const ddaScopes = ['pagamento-dda.read', 'dda.read', 'boleto-pagamento.read', 'agenda-pagamento.read', 'consulta-dda.read'];
    for (const s of ddaScopes) {
      await sleep(3000);
      const r = await tokenFor(client, s);
      out.scopes.push({ scope: s, ok: r.ok, status: r.status, body: r.ok ? '(ok)' : r.body });
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e), out }, null, 2), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
