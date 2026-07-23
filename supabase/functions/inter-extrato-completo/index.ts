// @ts-nocheck
// inter-extrato-completo — extrato enriquecido do Banco Inter.
import { getAuthedUser, isFinance } from "../_shared/require-user.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const INTER_BASE = 'https://cdpj.partners.bancointer.com.br';

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
    scope: 'extrato.read',
  });
  const res = await fetch(`${INTER_BASE}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    client,
  } as any);
  const txt = await res.text();
  if (!res.ok) throw new Error(`OAuth Inter (${res.status}): ${txt}`);
  return JSON.parse(txt).access_token as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const user = await getAuthedUser(req);
    if (!user) return json({ error: 'Não autenticado' }, 401);
    if (!(await isFinance(user.email))) return json({ error: 'Acesso restrito ao financeiro' }, 403);
    const { data_inicio, data_fim, pagina = 0, tamanhoPagina = 100 } = await req.json().catch(() => ({}));
    if (!data_inicio || !data_fim) return json({ error: 'data_inicio e data_fim são obrigatórios' }, 400);

    const client = buildMtlsClient();
    const token = await getToken(client);

    const all: any[] = [];
    let page = Number(pagina);
    const size = Number(tamanhoPagina);
    for (;;) {
      const url = `${INTER_BASE}/banking/v2/extrato/completo?dataInicio=${data_inicio}&dataFim=${data_fim}&pagina=${page}&tamanhoPagina=${size}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        client,
      } as any);
      const txt = await res.text();
      if (!res.ok) return json({ error: `Inter (${res.status}): ${txt}` }, 500);
      const parsed = JSON.parse(txt);
      const items: any[] = parsed?.transacoes ?? parsed?.movimentacoes ?? parsed?.content ?? [];
      all.push(...items);
      const totalPaginas = Number(parsed?.totalPaginas ?? 1);
      page += 1;
      if (page >= totalPaginas || items.length === 0) break;
      if (page > 50) break; // hard stop
    }

    return json({ data_inicio, data_fim, total: all.length, transacoes: all });
  } catch (e: any) {
    console.error('inter-extrato-completo error', e);
    return json({ error: e?.message ?? 'Erro inesperado' }, 500);
  }
});
