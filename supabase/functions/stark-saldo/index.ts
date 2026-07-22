// @ts-nocheck
import { starkFetch, starkErrorMessage } from "../_shared/stark.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { ok, status, data, raw } = await starkFetch('/balance');
    if (!ok) return json({ ok: false, error: starkErrorMessage(data, raw, status), status }, 200);
    const b = data?.balances?.[0];
    if (!b) return json({ ok: false, error: 'Resposta sem balances', status }, 200);
    return json({
      ok: true,
      disponivel: Number(b.amount ?? 0) / 100,
      moeda: b.currency ?? 'BRL',
      atualizado_em: b.updated ?? new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('stark-saldo error', e);
    return json({ ok: false, error: e?.message ?? 'Erro inesperado' }, 200);
  }
});
