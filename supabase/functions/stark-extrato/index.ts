// @ts-nocheck
import { starkFetch, starkErrorMessage } from "../_shared/stark.ts";
import { getAuthedUser } from "../_shared/require-user.ts";

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
    let after: string | undefined, before: string | undefined, limit = 100;
    if (req.method === 'POST') {
      const b = await req.json().catch(() => ({}));
      after = b.after; before = b.before; limit = Number(b.limit ?? 100);
    } else {
      const u = new URL(req.url);
      after = u.searchParams.get('after') ?? undefined;
      before = u.searchParams.get('before') ?? undefined;
      limit = Number(u.searchParams.get('limit') ?? 100);
    }

    const params = new URLSearchParams();
    params.set('limit', String(Math.min(Math.max(limit, 1), 100)));
    if (after) params.set('after', after);
    if (before) params.set('before', before);

    const { ok, status, data, raw } = await starkFetch(`/transaction?${params.toString()}`);
    if (!ok) return json({ ok: false, error: starkErrorMessage(data, raw, status), status }, 200);

    const txs = (data?.transactions ?? []).map((t: any) => ({
      id: t.id,
      amount: Number(t.amount ?? 0) / 100,
      description: t.description ?? '',
      fee: Number(t.fee ?? 0) / 100,
      source: t.source ?? '',
      created: t.created,
      balance: t.balance != null ? Number(t.balance) / 100 : null,
    }));

    return json({ ok: true, transactions: txs });
  } catch (e: any) {
    console.error('stark-extrato error', e);
    return json({ ok: false, error: e?.message ?? 'Erro inesperado' }, 200);
  }
});
