import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PORTEIRO_SECRET = Deno.env.get('PORTEIRO_SECRET') || '';

const cors = {
  ...corsHeaders,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-porteiro-secret',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  const secret = req.headers.get('x-porteiro-secret') || '';
  if (!PORTEIRO_SECRET || secret !== PORTEIRO_SECRET) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  const action = body?.action;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (action === 'pull') {
      const { data: rows, error: e1 } = await sb
        .from('stark_pagamentos')
        .select('id')
        .eq('status', 'aprovado')
        .order('approved_at', { ascending: true })
        .limit(5);
      if (e1) throw e1;
      const ids = (rows ?? []).map((r: any) => r.id);
      if (ids.length === 0) return json({ ok: true, jobs: [] });

      const { data: jobs, error: e2 } = await sb
        .from('stark_pagamentos')
        .update({ status: 'processando' })
        .in('id', ids)
        .select('*');
      if (e2) throw e2;
      return json({ ok: true, jobs: jobs ?? [] });
    }

    if (action === 'report') {
      const { id, ok, stark_id, amount_reais, beneficiario, erro } = body;
      if (!id) return json({ ok: false, error: 'id obrigatório' }, 400);
      const patch: Record<string, unknown> = {
        status: ok ? 'sucesso' : 'falha',
        processed_at: new Date().toISOString(),
      };
      if (stark_id !== undefined) patch.stark_id = stark_id;
      if (amount_reais !== undefined) patch.amount_reais = amount_reais;
      if (beneficiario !== undefined) patch.beneficiario = beneficiario;
      if (erro !== undefined) patch.erro = erro;
      const { error } = await sb.from('stark_pagamentos').update(patch).eq('id', id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ ok: false, error: 'action inválida' }, 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
