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

    // ===== iFOOD MATCH (lote-a-lote por valor) =====
    // Estratégia: cada lote (sale_date × tipo PIX/CARD) na Maquinona corresponde
    // a UM depósito Cresol específico. O extrato bancário tem 1 lançamento por
    // (sale_date × tipo). Match valor-a-valor com tolerância 5% pra detectar
    // taxa oculta (PIX retido sem declaração, antecipação extra, etc).
    //
    // Vantagens vs match por expected_deposit_date:
    // - Funciona com carnaval/feriados/fim de semana naturalmente (o depósito
    //   está lá, só precisa achar o lote correspondente em valor)
    // - Permite competência por sale_date (não expected_deposit_date)
    // - Detecta divergências por dia × tipo (cobrável)
    const txs = await fetchAllPaginated<any>(
      supabase
        .from('audit_card_transactions')
        .select('sale_date,payment_method,gross_amount,net_amount')
        .eq('audit_period_id', audit_period_id)
        .eq('deposit_group', 'ifood'),
    );

    const deps = await fetchAllPaginated<any>(
      supabase
        .from('audit_bank_deposits')
        .select('id,deposit_date,amount')
        .eq('audit_period_id', audit_period_id)
        .eq('bank', 'cresol')
        .eq('category', 'ifood'),
    );

    // Agrupa Maquinona em lotes (sale_date × tipo PIX/CARD)
    type Lot = { sale_date: string; tipo: 'PIX'|'CARD'; bruto: number; liq: number; count: number };
    const lotsMap = new Map<string, Lot>();
    for (const t of txs ?? []) {
      const sd = t.sale_date as string;
      const method = String(t.payment_method ?? '').toUpperCase();
      const tipo: 'PIX'|'CARD' = method === 'PIX' ? 'PIX' : 'CARD';
      const key = `${sd}|${tipo}`;
      const lot = lotsMap.get(key) ?? { sale_date: sd, tipo, bruto: 0, liq: 0, count: 0 };
      lot.bruto += Number(t.gross_amount || 0);
      lot.liq += Number(t.net_amount || 0);
      lot.count += 1;
      lotsMap.set(key, lot);
    }
    const lots: Lot[] = Array.from(lotsMap.values()).sort((a, b) => a.sale_date.localeCompare(b.sale_date));

    // Match: pra cada lote, busca depósito Cresol mais próximo em valor (tol 5%)
    // que ainda não foi matched. Depósito >= sale_date é preferível mas não obrigatório.
    type DepStatus = { id: string; date: string; amount: number; matched: boolean };
    const depPool: DepStatus[] = (deps ?? []).map(d => ({
      id: d.id, date: d.deposit_date, amount: Number(d.amount || 0), matched: false
    }));

    const matchedLots: Array<Lot & { cresol_amount?: number; cresol_date?: string; diff?: number; matched: boolean }> = [];

    for (const lot of lots) {
      let best: DepStatus | null = null;
      let bestPct = 999;
      for (const dep of depPool) {
        if (dep.matched) continue;
        if (dep.date < lot.sale_date) continue; // depósito tem que ser >= sale_date
        const diffPct = lot.liq > 0 ? Math.abs(dep.amount - lot.liq) / lot.liq : 999;
        if (diffPct < 0.05 && diffPct < bestPct) {
          best = dep;
          bestPct = diffPct;
        }
      }
      if (best) {
        best.matched = true;
        matchedLots.push({ ...lot, cresol_amount: best.amount, cresol_date: best.date, diff: best.amount - lot.liq, matched: true });
      } else {
        matchedLots.push({ ...lot, matched: false });
      }
    }

    // Agrega por sale_date pro audit_daily_matches (1 row por sale_date,
    // somando PIX + CARD do dia)
    type DayAgg = { expected: number; deposited: number; bruto: number; count: number; lots: number; matched_lots: number };
    const byDay = new Map<string, DayAgg>();
    for (const m of matchedLots) {
      const a = byDay.get(m.sale_date) ?? { expected: 0, deposited: 0, bruto: 0, count: 0, lots: 0, matched_lots: 0 };
      a.expected += m.liq;
      a.deposited += m.cresol_amount ?? 0;
      a.bruto += m.bruto;
      a.count += m.count;
      a.lots += 1;
      if (m.matched) a.matched_lots += 1;
      byDay.set(m.sale_date, a);
    }

    const dailyRows: any[] = [];
    for (const [sale_date, a] of byDay) {
      const diff = a.deposited - a.expected;
      const tolerance = Math.max(1, a.expected * 0.005);
      let status: string;
      if (a.matched_lots === 0) {
        status = 'pending'; // nenhum lote do dia foi matched (depósito não chegou)
      } else if (a.matched_lots < a.lots) {
        status = 'partial'; // alguns lotes matched, outros não
      } else if (Math.abs(diff) <= tolerance) {
        status = 'matched';
      } else {
        status = 'partial';
      }
      dailyRows.push({
        audit_period_id,
        match_date: sale_date,
        expected_amount: a.expected,
        deposited_amount: a.deposited,
        difference: diff,
        transaction_count: a.count,
        deposit_count: a.matched_lots,
        status,
      });
    }

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
