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

    // Clear previous matches
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

    // ===== VOUCHER MATCH (per company) =====
    const companies = ['alelo', 'ticket', 'pluxee', 'vr'];
    const { data: voucherTxs } = await supabase
      .from('audit_card_transactions')
      .select('deposit_group,gross_amount')
      .eq('audit_period_id', audit_period_id)
      .in('deposit_group', companies);

    const { data: voucherDeps } = await supabase
      .from('audit_bank_deposits')
      .select('category,amount')
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'bb')
      .in('category', companies);

    const soldBy = new Map<string, { amount: number; count: number }>();
    for (const t of voucherTxs ?? []) {
      const k = t.deposit_group!;
      const cur = soldBy.get(k) ?? { amount: 0, count: 0 };
      cur.amount += Number(t.gross_amount || 0);
      cur.count += 1;
      soldBy.set(k, cur);
    }
    const depBy = new Map<string, { amount: number; count: number }>();
    for (const d of voucherDeps ?? []) {
      const k = d.category!;
      const cur = depBy.get(k) ?? { amount: 0, count: 0 };
      cur.amount += Number(d.amount || 0);
      cur.count += 1;
      depBy.set(k, cur);
    }

    const voucherRows = companies.map(company => {
      const sold = soldBy.get(company) ?? { amount: 0, count: 0 };
      const dep = depBy.get(company) ?? { amount: 0, count: 0 };
      const diff = sold.amount - dep.amount;
      const rate = sold.amount > 0 ? diff / sold.amount : 0;
      let status = 'ok';
      if (sold.amount === 0 && dep.amount === 0) status = 'no_sales';
      else if (sold.amount === 0) status = 'no_sales';
      else if (rate > 0.10) status = 'critico';
      else if (rate > 0.05) status = 'alerta';
      else if (rate < -0.05) status = 'divergente';
      return {
        audit_period_id,
        company,
        sold_amount: sold.amount,
        sold_count: sold.count,
        deposited_amount: dep.amount,
        deposit_count: dep.count,
        difference: diff,
        effective_tax_rate: rate * 100,
        status,
      };
    }).filter(r => r.sold_amount > 0 || r.deposited_amount > 0);

    if (voucherRows.length > 0) {
      const { error: vErr } = await supabase.from('audit_voucher_matches').insert(voucherRows);
      if (vErr) throw vErr;
    }

    // Update period status
    await supabase
      .from('audit_periods')
      .update({ status: 'conciliado', updated_at: new Date().toISOString() })
      .eq('id', audit_period_id);

    const totalIfood = dailyRows.reduce((s, r) => s + r.difference, 0);
    const totalVoucher = voucherRows.reduce((s, r) => s + r.difference, 0);

    return new Response(JSON.stringify({
      success: true,
      daily_matches_count: dailyRows.length,
      voucher_matches_count: voucherRows.length,
      total_difference_ifood: totalIfood,
      total_difference_voucher: totalVoucher,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('run-audit-match error', e);
    return new Response(JSON.stringify({ error: e.message ?? 'Erro interno' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
