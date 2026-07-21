// @ts-nocheck
// inter-dda-probe — TESTE temporário: método/allow do endpoint DDA do Inter.
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
async function getToken(client: any, scope: string) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: Deno.env.get('INTER_CLIENT_ID') ?? '',
    client_secret: Deno.env.get('INTER_CLIENT_SECRET') ?? '',
    scope,
  });
  const r = await fetch(`${INTER_BASE}/oauth/v2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(), client,
  } as any);
  const t = await r.text();
  try { return r.ok ? JSON.parse(t).access_token : null; } catch { return null; }
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const out: any = { probes: [] };
  try {
    const client = buildClient();
    const token = await getToken(client, 'pagamento-boleto.read pagamento-boleto.write');
    if (!token) { out.error = 'sem token base'; return new Response(JSON.stringify(out), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
    const H = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
    const routes405 = ['/banking/v2/pagamento/dda', '/banking/v2/pagamento/boletos', '/banking/v2/pagamento/agenda', '/banking/v2/pagamento/buscar'];
    // GET pra ler o header allow
    for (const ep of routes405) {
      const r = await fetch(`${INTER_BASE}${ep}`, { method: 'GET', headers: H, client } as any);
      const t = await r.text();
      out.probes.push({ ep, method: 'GET', status: r.status, allow: r.headers.get('allow'), body: t.slice(0, 200) });
      await sleep(400);
    }
    // POST no /pagamento/dda (consulta por código de barras) e /pagamento/buscar
    const postTargets = [
      { ep: '/banking/v2/pagamento/dda', body: { codigoBarras: '00000000000000000000000000000000000000000000' } },
      { ep: '/banking/v2/pagamento/buscar', body: {} },
      { ep: '/banking/v2/pagamento/agenda', body: {} },
    ];
    for (const pt of postTargets) {
      const r = await fetch(`${INTER_BASE}${pt.ep}`, { method: 'POST', headers: H, body: JSON.stringify(pt.body), client } as any);
      const t = await r.text();
      out.probes.push({ ep: pt.ep, method: 'POST', status: r.status, allow: r.headers.get('allow'), body: t.slice(0, 300) });
      await sleep(400);
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e), out }, null, 2), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
