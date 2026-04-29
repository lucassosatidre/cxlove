// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fetchAllPaginated } from '../_shared/pagination.ts';

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
    const missing = ['maquinona', 'cresol'].filter(t => !types.has(t));
    if (missing.length > 0) {
      return new Response(JSON.stringify({
        error: `Importe os 2 arquivos antes de conciliar. Faltando: ${missing.join(', ')}`,
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Clear previous iFood daily matches (idempotent rerun)
    await supabase.from('audit_daily_matches').delete().eq('audit_period_id', audit_period_id);

    // ===== iFOOD MATCH (by date) =====
    // Usa fetchAllPaginated p/ contornar o limite default de 1000 do PostgREST.
    // Vendas iFood facilmente passam disso (mês cheio = ~2.5k txs). Sem paginar,
    // dias do final do range somem do daily_matches e o carry-forward quebra.
    const txs = await fetchAllPaginated<any>(
      supabase
        .from('audit_card_transactions')
        .select('expected_deposit_date,net_amount')
        .eq('audit_period_id', audit_period_id)
        .eq('deposit_group', 'ifood'),
    );

    const deps = await fetchAllPaginated<any>(
      supabase
        .from('audit_bank_deposits')
        .select('deposit_date,amount')
        .eq('audit_period_id', audit_period_id)
        .eq('bank', 'cresol')
        .eq('category', 'ifood'),
    );

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

    // Carry-forward: vendas em dias sem depósito acumulam pra o próximo dia
    // com depósito. Resolve carnaval/feriados bancários (carnaval, sex santa,
    // outros feriados estaduais) onde a Maquinona escreve expected_deposit_date
    // de um dia que o banco não opera, e o dinheiro só cai 1-3 dias depois.
    const allDates = Array.from(new Set<string>([...txByDate.keys(), ...depByDate.keys()])).sort();
    const dailyRows: any[] = [];
    let carryAmount = 0;
    let carryCount = 0;
    let carryDates: string[] = [];

    for (const date of allDates) {
      const tx = txByDate.get(date);
      const dp = depByDate.get(date);
      const expectedToday = tx?.amount ?? 0;
      const deposited = dp?.amount ?? 0;
      const txCount = tx?.count ?? 0;
      const dpCount = dp?.count ?? 0;

      // Acumula vendas de hoje no carry pra ver o expected total
      const cumExpected = expectedToday + carryAmount;
      const cumCount = txCount + carryCount;

      if (deposited === 0 && cumExpected > 0) {
        // Dia com vendas mas sem depósito ainda. Marca pending e acumula.
        dailyRows.push({
          audit_period_id,
          match_date: date,
          expected_amount: expectedToday,
          deposited_amount: 0,
          difference: -expectedToday,
          transaction_count: txCount,
          deposit_count: 0,
          status: 'pending',
        });
        carryAmount = cumExpected;
        carryCount = cumCount;
        carryDates.push(date);
      } else if (deposited === 0 && cumExpected === 0) {
        // Dia totalmente vazio (não chega aqui na prática, allDates filtra)
        continue;
      } else {
        // Há depósito. Compara com expected acumulado (incluindo carry).
        const diff = deposited - cumExpected;
        // Tolerância adaptativa: max(R$ 1, 0.5% do esperado).
        // Variação de centavos por transação é normal (taxa real varia).
        // Sem isso, todo dia vira "partial" mesmo com diff irrelevante (ex: -R$ 9 em
        // R$ 11k = 0,08% — taxa de transação variando entre tipos de cartão).
        const tolerance = Math.max(1, cumExpected * 0.005);
        let status: string;
        if (cumCount === 0 && deposited > 0) {
          status = 'extra_deposit';
        } else if (Math.abs(diff) <= tolerance) {
          status = carryDates.length > 0 ? 'cluster_matched' : 'matched';
        } else {
          status = carryDates.length > 0 ? 'cluster_partial' : 'partial';
        }
        dailyRows.push({
          audit_period_id,
          match_date: date,
          expected_amount: cumExpected,
          deposited_amount: deposited,
          difference: diff,
          transaction_count: cumCount,
          deposit_count: dpCount,
          status,
        });
        carryAmount = 0;
        carryCount = 0;
        carryDates = [];
      }
    }

    // Se sobrou carry no fim do range (vendas dos últimos dias do mês cujo
    // depósito cai no próximo período), registra como pending sem terminal.
    // Não precisa de linha extra: as últimas linhas já estão com status='pending'.

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

    return new Response(JSON.stringify({
      success: true,
      daily_matches_count: dailyRows.length,
      total_difference_ifood: totalIfood,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('run-audit-match error', e);
    return new Response(JSON.stringify({ error: e.message ?? 'Erro interno' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
