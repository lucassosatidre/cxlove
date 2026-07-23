// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { starkFetch, starkErrorMessage } from "../_shared/stark.ts";
import { getAuthedUser, isFinance } from "../_shared/require-user.ts";

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

// Extrai id do formato "boleto-payment/<id>", "utility-payment/<id>", "tax-payment/<id>", "brcode-payment/<id>"
function extractPaymentId(source: string | null | undefined): string | null {
  if (!source) return null;
  const m = /^(?:boleto-payment|utility-payment|tax-payment|brcode-payment)\/([A-Za-z0-9-]+)/.exec(source);
  return m ? m[1] : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const user = await getAuthedUser(req);
    if (!user) return json({ error: 'Não autenticado' }, 401);
    if (!(await isFinance(user.email))) return json({ error: 'Acesso restrito ao financeiro' }, 403);
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

    // Enriquecimento: para transações de pagamento, buscar beneficiário salvo em stark_pagamentos
    try {
      const idMap = new Map<string, number[]>(); // stark_id -> índices em txs
      txs.forEach((t: any, idx: number) => {
        const pid = extractPaymentId(t.source);
        if (pid) {
          const arr = idMap.get(pid) || [];
          arr.push(idx);
          idMap.set(pid, arr);
        }
      });
      const ids = Array.from(idMap.keys());
      if (ids.length > 0) {
        const svc = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );
        const { data: pags } = await svc
          .from('stark_pagamentos')
          .select('stark_id, beneficiario')
          .in('stark_id', ids);
        for (const p of pags ?? []) {
          if (!p?.stark_id || !p?.beneficiario) continue;
          const idxs = idMap.get(p.stark_id) || [];
          for (const i of idxs) txs[i].description = p.beneficiario;
        }
      }
    } catch (enrichErr) {
      console.warn('stark-extrato enrich fail', enrichErr);
    }

    return json({ ok: true, transactions: txs });
  } catch (e: any) {
    console.error('stark-extrato error', e);
    return json({ ok: false, error: e?.message ?? 'Erro inesperado' }, 200);
  }
});
