// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { audit_period_id } = await req.json();
    if (!audit_period_id) {
      return new Response(JSON.stringify({ error: 'audit_period_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Block when period is closed
    const { data: periodRow } = await supabase
      .from('audit_periods').select('status').eq('id', audit_period_id).maybeSingle();
    if (periodRow?.status === 'fechado') {
      return new Response(JSON.stringify({
        error: 'Período fechado. Reabra antes de fazer alterações.',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Validate 3 imports exist
    const { data: imports } = await supabase
      .from('audit_imports')
      .select('file_type,status')
      .eq('audit_period_id', audit_period_id)
      .eq('status', 'completed');

    const types = new Set((imports ?? []).map((i: any) => i.file_type));
    const missing = ['maquinona', 'cresol', 'bb'].filter(t => !types.has(t));
    if (missing.length > 0) {
      return new Response(JSON.stringify({
        error: `Importe os 3 arquivos antes de conciliar. Faltando: ${missing.join(', ')}`,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Clear previous iFood daily matches (idempotent rerun)
    await supabase.from('audit_daily_matches').delete().eq('audit_period_id', audit_period_id);

    // ===== iFOOD MATCH (by date) =====
    const { data: txs } = await supabase
      .from('audit_card_transactions')
      .select('expected_deposit_date,net_amount')
      .eq('audit_period_id', audit_period_id)
      .eq('deposit_group', 'ifood');

    const { data: deps } = await supabase
      .from('audit_bank_deposits')
      .select('deposit_date,amount')
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'cresol')
      .eq('category', 'ifood');

    const txByDate = new Map<string, { amount: number; count: number }>();
    for (const t of txs ?? []) {
      const d = t.expected_deposit_date;
      if (!d) continue;
      const cur = txByDate.get(d) ?? { amount: 0, count: 0 };
      cur.amount += Number(t.net_amount || 0);
      cur.count += 1;
      txByDate.set(d, cur);
    }
    const depByDate = new Map<string, { amount: number; count: number }>();
    for (const d of deps ?? []) {
      const dt = d.deposit_date;
      const cur = depByDate.get(dt) ?? { amount: 0, count: 0 };
      cur.amount += Number(d.amount || 0);
      cur.count += 1;
      depByDate.set(dt, cur);
    }

    const allDates = new Set<string>([...txByDate.keys(), ...depByDate.keys()]);
    const dailyRows = Array.from(allDates).map(date => {
      const tx = txByDate.get(date);
      const dp = depByDate.get(date);
      const expected = tx?.amount ?? 0;
      const deposited = dp?.amount ?? 0;
      const diff = deposited - expected;
      let status = 'matched';
      if (!tx) status = 'extra_deposit';
      else if (!dp) status = 'missing_deposit';
      else if (Math.abs(diff) >= 1) status = 'partial';
      return {
        audit_period_id,
        match_date: date,
        expected_amount: expected,
        deposited_amount: deposited,
        difference: diff,
        transaction_count: tx?.count ?? 0,
        deposit_count: dp?.count ?? 0,
        status,
      };
    });

    if (dailyRows.length > 0) {
      const { error: dailyErr } = await supabase.from('audit_daily_matches').insert(dailyRows);
      if (dailyErr) throw dailyErr;
    }

    // ===== CLASSIFY DEPOSITS (matched / fora_periodo / nao_identificado) =====
    const { error: clsIfoodErr } = await supabase.rpc('classify_ifood_deposits', { p_period_id: audit_period_id });
    if (clsIfoodErr) console.error('classify_ifood_deposits error', clsIfoodErr);

    // Update period status
    await supabase
      .from('audit_periods')
      .update({ status: 'conciliado', updated_at: new Date().toISOString() })
      .eq('id', audit_period_id);

    const totalIfood = dailyRows.reduce((s, r) => s + r.difference, 0);

    // ===== Camada IA: comentários iFood em paralelo =====
    const SUPABASE_URL_AI = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_AI = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const aiHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_AI}`,
    };

    // @ts-ignore EdgeRuntime is available at runtime
    EdgeRuntime.waitUntil(
      fetch(`${SUPABASE_URL_AI}/functions/v1/audit-ifood-ai`, {
        method: 'POST',
        headers: aiHeaders,
        body: JSON.stringify({ period_id: audit_period_id, force_refresh: false }),
      }).catch((e: any) => console.error('audit-ifood-ai fire error:', e.message))
    );

    return new Response(JSON.stringify({
      success: true,
      daily_matches_count: dailyRows.length,
      total_difference_ifood: totalIfood,
      ai_pending: true,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('run-audit-match error', e);
    return new Response(JSON.stringify({ error: e.message ?? 'Erro interno' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
