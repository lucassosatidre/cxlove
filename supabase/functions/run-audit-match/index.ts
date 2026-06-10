// @ts-nocheck
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fetchAllPaginated } from '../_shared/pagination.ts';
import { nextBusinessDay } from '../_shared/calendar.ts';

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
    // (sale_date × tipo). Match valor-a-valor com tolerância 15% pra detectar
    // taxa oculta (PIX retido sem declaração, antecipação extra, etc).
    //
    // Vantagens vs match por expected_deposit_date:
    // - Funciona com carnaval/feriados/fim de semana naturalmente (o depósito
    //   está lá, só precisa achar o lote correspondente em valor)
    // - Permite competência por sale_date (não expected_deposit_date)
    // - Detecta divergências por dia × tipo (cobrável)
    const periodInfo = await supabase
      .from('audit_periods').select('year,month').eq('id', audit_period_id).maybeSingle();
    const yr = periodInfo.data?.year as number;
    const mo = periodInfo.data?.month as number;
    const _monthStart = `${yr}-${String(mo).padStart(2, '0')}-01`;
    const _nextMonthStart = mo === 12 ? `${yr + 1}-01-01` : `${yr}-${String(mo + 1).padStart(2, '0')}-01`;
    const txs = await fetchAllPaginated<any>(
      supabase
        .from('audit_card_transactions')
        .select('sale_date,payment_method,gross_amount,net_amount')
        .eq('audit_period_id', audit_period_id)
        .eq('deposit_group', 'ifood')
        .gte('sale_date', _monthStart)
        .lt('sale_date', _nextMonthStart),
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

    // Match: D+1 com calendário bancário SC + overrides manuais.
    //
    // Regra:
    // 1. Carrega audit_lot_overrides do período. Pra cada (sale_date, tipo) com
    //    override: aplica primeiro (consome o cresol_deposit_id ou marca sem match).
    // 2. Pra lotes sem override, expected = nextBusinessDay(sale_date).
    // 3. Match estrito por data; tolerance 15% pra absorver retenções.
    // 4. Lotes maiores primeiro (CARD antes de PIX).
    type DepStatus = { id: string; date: string; amount: number; matched: boolean };
    const depPool: DepStatus[] = (deps ?? []).map(d => ({
      id: d.id, date: d.deposit_date, amount: Number(d.amount || 0), matched: false
    }));
    const depById = new Map<string, DepStatus>();
    for (const d of depPool) depById.set(d.id, d);

    // Carrega overrides
    const { data: overrides } = await supabase
      .from('audit_lot_overrides')
      .select('sale_date, tipo, cresol_deposit_id, note')
      .eq('audit_period_id', audit_period_id);
    const overrideMap = new Map<string, { cresol_deposit_id: string | null; note: string | null }>();
    for (const o of (overrides ?? [])) {
      overrideMap.set(`${o.sale_date}|${o.tipo}`, {
        cresol_deposit_id: o.cresol_deposit_id,
        note: o.note,
      });
    }

    const matchedLots: Array<Lot & { cresol_amount?: number; cresol_date?: string; diff?: number; matched: boolean; manual?: boolean }> = [];

    // Aplica overrides primeiro
    const overriddenKeys = new Set<string>();
    for (const lot of lots) {
      const key = `${lot.sale_date}|${lot.tipo}`;
      if (!overrideMap.has(key)) continue;
      overriddenKeys.add(key);
      const ov = overrideMap.get(key)!;
      if (ov.cresol_deposit_id) {
        const dep = depById.get(ov.cresol_deposit_id);
        if (dep) {
          dep.matched = true;
          matchedLots.push({ ...lot, cresol_amount: dep.amount, cresol_date: dep.date, diff: dep.amount - lot.liq, matched: true, manual: true });
          continue;
        }
      }
      // Override com cresol_deposit_id null OU dep não encontrado = sem match intencional
      matchedLots.push({ ...lot, matched: false, manual: true });
    }

    // Match automático D+1 pros lotes sem override
    const lotsForAuto = lots.filter(l => !overriddenKeys.has(`${l.sale_date}|${l.tipo}`)).sort((a, b) => b.liq - a.liq);
    for (const lot of lotsForAuto) {
      const expectedDate = nextBusinessDay(lot.sale_date);
      let best: DepStatus | null = null;
      let bestPct = 999;
      for (const dep of depPool) {
        if (dep.matched) continue;
        if (dep.date !== expectedDate) continue;
        const diffPct = lot.liq > 0 ? Math.abs(dep.amount - lot.liq) / lot.liq : 999;
        if (diffPct < 0.15 && diffPct < bestPct) {
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

    // Pass 2: match agrupado. Pra cada dep Cresol não pareado, tenta combinar
    // 2-4 lotes PIX iFood não pareados que somam o valor do dep (tolerância 3%,
    // janela 7 dias). iFood acumula PIX pequenos e paga em batch junto com a
    // antecipação semanal. Visto em abr/26: 16/04 R$833,60 + 22/04 R$1.093,95
    // foram pagos juntos em 23/04 como R$1.888,39.
    const unmatchedDeps = depPool.filter(d => !d.matched);
    const unmatchedPixIdx: number[] = [];
    for (let i = 0; i < matchedLots.length; i++) {
      if (!matchedLots[i].matched && matchedLots[i].tipo === 'PIX' && !matchedLots[i].manual) {
        unmatchedPixIdx.push(i);
      }
    }

    function daysBetween(a: string, b: string): number {
      const da = new Date(a + 'T00:00:00Z').getTime();
      const db = new Date(b + 'T00:00:00Z').getTime();
      return Math.round((db - da) / 86400000);
    }

    function findGroupedMatch(target: number, candIdx: number[], maxK: number, tol: number): number[] | null {
      const candidates = candIdx.map(i => ({ i, liq: matchedLots[i].liq }));
      candidates.sort((a, b) => b.liq - a.liq);
      function recurse(start: number, picked: number[], sum: number): number[] | null {
        if (picked.length >= 2 && Math.abs(sum - target) <= tol) return [...picked];
        if (picked.length >= maxK) return null;
        for (let i = start; i < candidates.length; i++) {
          const nextSum = sum + candidates[i].liq;
          if (nextSum > target + tol) continue; // prune: estourou
          picked.push(candidates[i].i);
          const r = recurse(i + 1, picked, nextSum);
          picked.pop();
          if (r) return r;
        }
        return null;
      }
      return recurse(0, [], 0);
    }

    for (const dep of unmatchedDeps) {
      // Filtra lotes PIX cuja expected_date está dentro de janela [dep.date - 7, dep.date]
      const windowIdx = unmatchedPixIdx.filter(i => {
        if (matchedLots[i].matched) return false;
        const expected = nextBusinessDay(matchedLots[i].sale_date);
        const dd = daysBetween(expected, dep.date);
        return dd >= 0 && dd <= 7;
      });
      if (windowIdx.length < 2) continue;
      const tol = Math.max(2, dep.amount * 0.03);
      const combo = findGroupedMatch(dep.amount, windowIdx, 4, tol);
      if (combo && combo.length >= 2) {
        dep.matched = true;
        const groupSum = combo.reduce((s, i) => s + matchedLots[i].liq, 0);
        const groupId = `grp:${dep.id}`;
        for (const i of combo) {
          matchedLots[i].matched = true;
          matchedLots[i].cresol_amount = matchedLots[i].liq * (dep.amount / groupSum); // rateio proporcional
          matchedLots[i].cresol_date = dep.date;
          matchedLots[i].diff = matchedLots[i].cresol_amount - matchedLots[i].liq;
          matchedLots[i].group_id = groupId;
        }
      }
    }

    // Agrega por sale_date pro audit_daily_matches (1 row por sale_date,
    // somando PIX + CARD do dia). Separa expected_matched (= líq dos lotes
    // que pareou) de expected_unmatched (= líq dos lotes que não pareou).
    // O diff (depositado - expected_matched) é o "custo oculto real" — não
    // inflado por lotes não conciliados.
    type DayAgg = { expected_matched: number; expected_unmatched: number; deposited: number; bruto: number; count: number; lots: number; matched_lots: number };
    const byDay = new Map<string, DayAgg>();
    for (const m of matchedLots) {
      const a = byDay.get(m.sale_date) ?? { expected_matched: 0, expected_unmatched: 0, deposited: 0, bruto: 0, count: 0, lots: 0, matched_lots: 0 };
      if (m.matched) {
        a.expected_matched += m.liq;
        a.deposited += m.cresol_amount ?? 0;
        a.matched_lots += 1;
      } else {
        a.expected_unmatched += m.liq;
      }
      a.bruto += m.bruto;
      a.count += m.count;
      a.lots += 1;
      byDay.set(m.sale_date, a);
    }

    const dailyRows: any[] = [];
    for (const [sale_date, a] of byDay) {
      const expectedTotal = a.expected_matched + a.expected_unmatched;
      const diff = a.deposited - a.expected_matched; // diff só dos matched (custo oculto real)
      const tolerance = Math.max(1, a.expected_matched * 0.005);
      let status: string;
      if (a.matched_lots === 0) {
        status = 'pending';
      } else if (a.matched_lots < a.lots) {
        status = 'partial'; // tem lotes sem match, mostrar
      } else if (Math.abs(diff) <= tolerance) {
        status = 'matched';
      } else {
        status = 'partial';
      }
      dailyRows.push({
        audit_period_id,
        match_date: sale_date,
        expected_amount: expectedTotal,
        deposited_amount: a.deposited,
        difference: diff, // negative = custo oculto (taxa real escondida) + unmatched
        transaction_count: a.count,
        deposit_count: a.matched_lots,
        status,
      });
    }

    if (dailyRows.length > 0) {
      const { error: dailyErr } = await supabase.from('audit_daily_matches').insert(dailyRows);
      if (dailyErr) throw dailyErr;
    }

    // classify_ifood_deposits removido: gravava match_status/matched_competencia_amount por data de crédito (anti-padrão sale_date) e nenhum KPI lê esses campos.

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
