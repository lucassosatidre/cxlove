// @ts-nocheck
// inter-pagar-darf — paga DARF via API Inter.
import { getAuthedUser, isAprovador } from "../_shared/require-user.ts";
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
    scope: 'pagamento-darf.write pagamento-boleto.write',
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
    const b = await req.json().catch(() => ({}));
    const cnpjCpf = String(b.cnpj_cpf ?? '').replace(/\D/g, '');
    const codigoReceita = String(b.codigo_receita ?? '').trim();
    const dataVencimento = String(b.data_vencimento ?? '').slice(0, 10);
    const dataApuracao = String(b.data_apuracao ?? '').slice(0, 10);
    const valorPrincipal = Number(b.valor_principal ?? 0);

    if (!cnpjCpf || (cnpjCpf.length !== 11 && cnpjCpf.length !== 14)) {
      return json({ error: 'cnpj_cpf inválido' }, 400);
    }
    if (!codigoReceita) return json({ error: 'codigo_receita obrigatório' }, 400);
    if (!dataVencimento || !dataApuracao) return json({ error: 'data_vencimento e data_apuracao obrigatórias' }, 400);
    if (!isFinite(valorPrincipal) || valorPrincipal <= 0) return json({ error: 'valor_principal inválido' }, 400);

    const payload: Record<string, unknown> = {
      cnpjCpf,
      codigoReceita,
      dataVencimento,
      dataApuracao,
      valorPrincipal,
    };
    if (b.valor_multa != null && b.valor_multa !== '') payload.valorMulta = Number(b.valor_multa);
    if (b.valor_juros != null && b.valor_juros !== '') payload.valorJuros = Number(b.valor_juros);
    if (b.descricao) payload.descricao = String(b.descricao);
    if (b.periodo_apuracao) payload.periodoApuracao = String(b.periodo_apuracao);
    if (b.referencia) payload.referencia = String(b.referencia);

    const client = buildClient();
    const token = await getToken(client);
    const res = await fetch(`${INTER_BASE}/banking/v2/pagamento/darf`, {
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
    console.error('inter-pagar-darf error', e);
    return json({ error: e?.message ?? 'Erro inesperado' }, 500);
  }
});
