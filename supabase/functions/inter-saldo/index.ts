// @ts-nocheck
// inter-saldo — consulta saldo em tempo real do Banco Inter Empresas via API REST + mTLS.
import { getAuthedUser, isFinance } from "../_shared/require-user.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  const certB64 = Deno.env.get('INTER_CERT_BASE64');
  const keyB64 = Deno.env.get('INTER_KEY_BASE64');
  if (!certB64 || !keyB64) throw new Error('INTER_CERT_BASE64/INTER_KEY_BASE64 não configurados');
  const cert = b64ToText(certB64);
  const key = b64ToText(keyB64);
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const user = await getAuthedUser(req);
    if (!user) return json({ error: 'Não autenticado' }, 401);
    if (!(await isFinance(user.email))) return json({ error: 'Acesso restrito ao financeiro' }, 403);
    const client = buildMtlsClient();
    const token = await getInterToken(client);

    const res = await fetch(`${INTER_BASE}/banking/v2/saldo`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      client,
    } as any);
    const txt = await res.text();
    if (!res.ok) return json({ error: `Saldo Inter falhou (${res.status}): ${txt}` }, 500);

    const parsed = JSON.parse(txt);
    const disponivel = Number(parsed?.disponivel ?? 0);
    const bloqueado =
      Number(parsed?.bloqueado ?? 0) +
      Number(parsed?.bloqueadoCheque ?? 0) +
      Number(parsed?.bloqueadoJudicialmente ?? 0) +
      Number(parsed?.bloqueadoAdministrativo ?? 0);
    const limite = Number(parsed?.limite ?? 0);

    return json({
      disponivel,
      bloqueado,
      limite,
      saldo_total: disponivel + bloqueado,
      atualizado_em: new Date().toISOString(),
      raw: parsed,
    });
  } catch (e: any) {
    console.error('inter-saldo error', e);
    return json({ error: e?.message ?? 'Erro inesperado' }, 500);
  }
});
