// @ts-nocheck
// inter-extrato-pdf — exporta extrato Inter em PDF e sobe para Storage (bucket inter-extratos).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const INTER_BASE = 'https://cdpj.partners.bancointer.com.br';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'inter-extratos';

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
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
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
    const { data_inicio, data_fim } = await req.json().catch(() => ({}));
    if (!data_inicio || !data_fim) return json({ error: 'data_inicio e data_fim são obrigatórios' }, 400);

    const client = buildMtlsClient();
    const token = await getToken(client);

    const url = `${INTER_BASE}/banking/v2/extrato/exportar?dataInicio=${data_inicio}&dataFim=${data_fim}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf, application/json' },
      client,
    } as any);
    if (!res.ok) {
      const txt = await res.text();
      return json({ error: `Inter (${res.status}): ${txt}` }, 500);
    }

    const ct = res.headers.get('content-type') ?? '';
    let pdfBytes: Uint8Array;
    if (ct.includes('application/pdf')) {
      pdfBytes = new Uint8Array(await res.arrayBuffer());
    } else {
      const txt = await res.text();
      let parsed: any;
      try { parsed = JSON.parse(txt); } catch { parsed = null; }
      const b64 = parsed?.pdf ?? parsed?.arquivo ?? (typeof parsed === 'string' ? parsed : null);
      if (!b64) return json({ error: `Resposta Inter não é PDF nem base64: ${txt.slice(0, 200)}` }, 500);
      pdfBytes = b64ToBytes(String(b64));
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const path = `extrato-inter-${data_inicio}-${data_fim}-${Date.now()}.pdf`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, pdfBytes, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (upErr) return json({ error: `Upload falhou: ${upErr.message}` }, 500);

    // Bucket privado → signed URL (1h).
    const { data: signed, error: sErr } = await supabase.storage
      .from(BUCKET).createSignedUrl(path, 60 * 60);
    if (sErr || !signed?.signedUrl) {
      return json({ error: `Signed URL falhou: ${sErr?.message ?? 'sem url'}` }, 500);
    }

    return json({ url: signed.signedUrl, path, data_inicio, data_fim, size: pdfBytes.byteLength });
  } catch (e: any) {
    console.error('inter-extrato-pdf error', e);
    return json({ error: e?.message ?? 'Erro inesperado' }, 500);
  }
});
