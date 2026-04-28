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

    // Clear previous matches (only the iFood daily summary; vouchers are now
    // recomputed via match_voucher_lots_v2 + calculate_voucher_audit, which
    // do their own idempotent updates).
    await supabase.from('audit_daily_matches').delete().eq('audit_period_id', audit_period_id);
    await supabase.from('audit_voucher_matches').delete().eq('audit_period_id', audit_period_id);

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

    // ===== VOUCHER MATCH v4 (competência por data Maquinona) =====
    // 1) Cross-period: casa voucher_lot_items ↔ audit_card_transactions por data + valor
    const { data: matchV2, error: matchV2Err } = await supabase
      .rpc('match_voucher_lots_v2', { p_period_id: audit_period_id });
    if (matchV2Err) {
      console.error('match_voucher_lots_v2 error', matchV2Err);
      throw matchV2Err;
    }

    // 2) Calcula auditoria por competência (vendido / reconhecido / pago / pendente)
    //    e popula public.audit_voucher_competencia (4 linhas, uma por operadora)
    const { data: calcRes, error: calcErr } = await supabase
      .rpc('calculate_voucher_audit', { p_period_id: audit_period_id });
    if (calcErr) {
      console.error('calculate_voucher_audit error', calcErr);
      throw calcErr;
    }

    // 3) Mantém audit_voucher_matches populada para telas legadas / PDFs antigos.
    //    Agora alimentada a partir de audit_voucher_competencia, não mais do
    //    bruto cego do período (que misturava meses).
    const { data: compRows } = await supabase
      .from('audit_voucher_competencia')
      .select('operadora,vendido_bruto,vendido_count,pago_bruto,pago_lotes_count,taxa_real_pct,taxa_estimada_pct,taxa_efetiva_consolidada_pct,status')
      .eq('audit_period_id', audit_period_id);

    const voucherRows = (compRows ?? []).map((c: any) => {
      const sold = Number(c.vendido_bruto || 0);
      const paid = Number(c.pago_bruto || 0);
      const diff = sold - paid;
      // Status mapeado para o vocabulário antigo (ok/alerta/critico/divergente/no_sales)
      let status: string = 'ok';
      if (sold === 0 && paid === 0) status = 'no_sales';
      else {
        const rate = sold > 0 ? diff / sold : 0;
        if (rate > 0.10) status = 'critico';
        else if (rate > 0.05) status = 'alerta';
        else if (rate < -0.05) status = 'divergente';
      }
      return {
        audit_period_id,
        company: c.operadora,
        sold_amount: sold,
        sold_count: Number(c.vendido_count || 0),
        deposited_amount: paid,
        deposit_count: Number(c.pago_lotes_count || 0),
        difference: diff,
        effective_tax_rate: Number(c.taxa_efetiva_consolidada_pct ?? c.taxa_real_pct ?? 0),
        status,
      };
    }).filter((r: any) => r.sold_amount > 0 || r.deposited_amount > 0);

    if (voucherRows.length > 0) {
      const { error: vErr } = await supabase.from('audit_voucher_matches').insert(voucherRows);
      if (vErr) throw vErr;
    }

    // ===== CLASSIFY DEPOSITS (matched / fora_periodo / nao_identificado) =====
    const { error: clsIfoodErr } = await supabase.rpc('classify_ifood_deposits', { p_period_id: audit_period_id });
    if (clsIfoodErr) console.error('classify_ifood_deposits error', clsIfoodErr);
    const { error: clsVouchErr } = await supabase.rpc('classify_voucher_deposits', { p_period_id: audit_period_id });
    if (clsVouchErr) console.error('classify_voucher_deposits error', clsVouchErr);

    // Update period status
    await supabase
      .from('audit_periods')
      .update({ status: 'conciliado', updated_at: new Date().toISOString() })
      .eq('id', audit_period_id);

    const totalIfood = dailyRows.reduce((s, r) => s + r.difference, 0);
    const totalVoucher = voucherRows.reduce((s, r) => s + r.difference, 0);

    // ===== Camada IA: 4 operadoras voucher em paralelo + iFood =====
    const SUPABASE_URL_AI = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_AI = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const aiHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_AI}`,
    };

    // @ts-ignore EdgeRuntime is available at runtime
    EdgeRuntime.waitUntil(
      (async () => {
        // 4 operadoras voucher em paralelo
        await Promise.allSettled(
          ['alelo', 'ticket', 'pluxee', 'vr'].map(op =>
            fetch(`${SUPABASE_URL_AI}/functions/v1/reconcile-vouchers-ai`, {
              method: 'POST',
              headers: aiHeaders,
              body: JSON.stringify({
                period_id: audit_period_id,
                force_refresh: false,
                operadora: op,
              }),
            }).catch((e: any) => console.error(`reconcile-${op} error:`, e.message))
          )
        );
        // Ao terminar todas as operadoras, roda o classify pra refletir no dashboard
        await fetch(`${SUPABASE_URL_AI}/rest/v1/rpc/classify_voucher_deposits`, {
          method: 'POST',
          headers: { ...aiHeaders, 'apikey': SERVICE_ROLE_AI },
          body: JSON.stringify({ p_period_id: audit_period_id }),
        }).catch((e: any) => console.error('classify_voucher_deposits final error:', e.message));
      })()
    );

    // iFood em paralelo (já funciona, manter como está)
    // @ts-ignore
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
      voucher_matches_count: voucherRows.length,
      total_difference_ifood: totalIfood,
      total_difference_voucher: totalVoucher,
      ai_pending: true,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('run-audit-match error', e);
    return new Response(JSON.stringify({ error: e.message ?? 'Erro interno' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
