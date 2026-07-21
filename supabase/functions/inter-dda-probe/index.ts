// @ts-nocheck
// inter-dda-probe — TESTE temporário: descobre se a API Inter expõe DDA (escopos + endpoints).
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const INTER_BASE = 'https://cdpj.partners.bancointer.com.br';
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
  const out: any = { scopes: [], grantedScopes: [], endpoints: [] };
  try {
    const client = buildClient();
    const scopes = [
      'pagamento-boleto.read', 'pagamento-boleto.write',
      'pagamento-dda.read', 'pagamento-dda.write',
      'dda.read', 'consulta-dda.read', 'boleto-pagamento.read',
      'pagamento-lote.read', 'agenda-pagamento.read', 'pagamento.read',
      'boletos-pagamento.read', 'pagamentos.read',
    ];
    for (const s of scopes) {
      const r = await tokenFor(client, s);
      out.scopes.push({ scope: s, ok: r.ok, status: r.status, body: r.ok ? '(ok)' : r.body });
      if (r.ok) out.grantedScopes.push(s);
    }
    let token: string | null = null;
    if (out.grantedScopes.length > 0) {
      const r = await tokenFor(client, out.grantedScopes.join(' '));
      token = r.token;
      out.combinedTokenStatus = r.status;
    }
    if (token) {
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
      ];
      for (const ep of eps) {
        try {
          const r = await fetch(`${INTER_BASE}${ep}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            client,
          } as any);
          const t = await r.text();
          out.endpoints.push({ ep, status: r.status, body: t.slice(0, 300) });
        } catch (e: any) {
          out.endpoints.push({ ep, error: String(e?.message ?? e).slice(0, 200) });
        }
      }
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e), out }, null, 2), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
