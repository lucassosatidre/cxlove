// @ts-nocheck
// Auto-match Ticket: pra cada lote pendente, busca depósito BB
// (bank='bb', category='ticket') com amount == valor_liquido (±0.02) E
// deposit_date dentro de janela [data_credito ± 2 dias úteis SC]. Match
// prioritário pra lotes com data_credito mais antiga.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { businessDayWindow, isBusinessDay, nextBusinessDay } from '../_shared/calendar.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Tolerância por operadora.
// - Ticket: valor exato do extrato bate certinho com BB (R$0,02 só pra arredondamento).
// - Alelo: cobra "tarifa de transação" no momento do depósito (NÃO incluída no
//   valor_liquido das vendas), que reduz 1-3 reais por lote. Tolerância R$15
//   absorve isso sem casar lotes errados (lotes Alelo distintos costumam diferir
//   em dezenas/centenas de reais).
// - Pluxee: credita valor exato no BB (igual Ticket, sem tarifa de transação).
//   Tolerância larga (R$15) gerava ambiguidade quando lotes fora-de-competência
//   no mesmo audit_period_id caíam na janela de outro depósito.
// - VR: também credita valor exato (líquido_lote = depósito BB confirmado em
//   todos os lotes mar/26). Tolerância R$15 causava ambíguo no exactSingles
//   e no pair search quando vários lotes ficavam dentro da janela.
const TOLERANCE_BY_OPERADORA: Record<string, number> = {
  ticket: 0.02,
  alelo: 15,
  pluxee: 10, // taxa real varia por origem (PAT/AUXILIO/REEMBOLSO EXPRESSO); estimativa rateada do header é aproximação
  vr: 0.02,
};
const DEFAULT_TOLERANCE = 0.02;
const WINDOW_DAYS = 2;  // ±2 dias úteis SC

function fmtBRDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Não autenticado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: roleData } = await supabase
      .from('user_roles').select('role').eq('user_id', userData.user.id).eq('role', 'admin').maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Acesso restrito a admin' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { audit_period_id, operadora = 'ticket', reset = false } = body || {};
    if (!audit_period_id) {
      return new Response(JSON.stringify({ error: 'audit_period_id obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const TOLERANCE = TOLERANCE_BY_OPERADORA[operadora] ?? DEFAULT_TOLERANCE;

    // Calcula janela de data_credito centrada no period: do início do mês
    // anterior até o fim do mês posterior. Cobre todos os lotes cujos deps
    // PODEM cair nesse period (atravessam de um mês pro outro).
    const { data: period } = await supabase
      .from('audit_periods').select('month,year').eq('id', audit_period_id).maybeSingle();
    if (!period) {
      return new Response(JSON.stringify({ error: 'Período não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const windowMin = new Date(period.year, period.month - 2, 1).toISOString().slice(0, 10);
    const windowMax = new Date(period.year, period.month + 1, 0).toISOString().slice(0, 10);

    // Reset matches automáticos: zera lotes que poderiam casar com deps deste
    // period (cross-period, baseado em data_credito na janela do period).
    if (reset) {
      await supabase
        .from('audit_voucher_lots')
        .update({ bb_deposit_id: null, bb_deposit_id_2: null, status: 'pending', diff: null })
        .eq('operadora', operadora)
        .eq('manual', false)
        .gte('data_credito', windowMin)
        .lte('data_credito', windowMax);
    }

    // Carrega lotes na janela (cross-period). Lote pode estar em audit_period
    // diferente do atual — auditoria por competência de venda separa lote
    // (period = mês da venda) do depósito BB (period = onde foi importado).
    const { data: lots } = await supabase
      .from('audit_voucher_lots')
      .select('id, numero_reembolso, valor_liquido, data_credito, bb_deposit_id, bb_deposit_id_2, manual, audit_period_id, data_transacao_bb, valor_creditado_bb, banco_credito')
      .eq('operadora', operadora)
      .gte('data_credito', windowMin)
      .lte('data_credito', windowMax)
      .order('data_credito', { ascending: true });


    if (!lots || lots.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'Nenhum lote a processar', matched: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Depósitos BB do period atual (deposit_date pode atravessar pra mês seguinte
    // porque user importa BB de X + X+1 no period X).
    const { data: deposits } = await supabase
      .from('audit_bank_deposits')
      .select('id, deposit_date, amount')
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'bb')
      .eq('category', operadora)
      .order('deposit_date', { ascending: true });

    type Dep = { id: string; deposit_date: string; amount: number; usedBy?: string };
    const depPool: Dep[] = (deposits ?? []).map(d => ({
      id: d.id, deposit_date: d.deposit_date, amount: Number(d.amount),
    }));

    // Depósitos já usados (por lotes manuais OU lotes em outros periods que
    // foram match em rodadas anteriores) — não devem ser reusados.
    const depIds = depPool.map(d => d.id);
    const usedIds = new Set<string>();
    if (depIds.length > 0) {
      const { data: alreadyMatched } = await supabase
        .from('audit_voucher_lots')
        .select('id, bb_deposit_id, bb_deposit_id_2')
        .eq('operadora', operadora)
        .or(`bb_deposit_id.in.(${depIds.join(',')}),bb_deposit_id_2.in.(${depIds.join(',')})`);
      for (const r of (alreadyMatched ?? [])) {
        if (r.bb_deposit_id) usedIds.add(r.bb_deposit_id as string);
        if (r.bb_deposit_id_2) usedIds.add(r.bb_deposit_id_2 as string);
      }
    }
    for (const d of depPool) if (usedIds.has(d.id)) d.usedBy = 'preexisting';

    type PendingLot = { id: string; numero_reembolso: string; valor_liquido: number; data_credito: string };
    // Normaliza data_credito: se cair em dia não-útil (sáb/dom/feriado), o
    // crédito real entra no próximo dia útil. Caso real abr/26 Ticket: lote
    // com data_credito 05/04 (dom) recebe no dep 06/04 (seg); lote com
    // 11/04 (sáb) recebe no dep 13/04 (seg). Sem essa normalização o lote
    // fica fora da janela ±2 úteis de qualquer dep.
    // Antecipação Banco Topázio (Ticket): quando o lote tem
    // data_transacao_bb + valor_creditado_bb preenchidos manualmente, usa
    // ESSES valores em vez de data_credito/valor_liquido (o crédito real
    // chegou antes via cessão Topázio, com valor diferente da projeção PDF).
    const pendingLots: PendingLot[] = lots
      .filter(l => !l.bb_deposit_id)
      .map(l => {
        const hasOverride = l.data_transacao_bb && l.valor_creditado_bb != null;
        const effectiveDate = hasOverride ? l.data_transacao_bb : l.data_credito;
        const effectiveAmount = hasOverride ? Number(l.valor_creditado_bb) : Number(l.valor_liquido);
        return {
          id: l.id,
          numero_reembolso: l.numero_reembolso,
          valor_liquido: effectiveAmount,
          data_credito: effectiveDate && !isBusinessDay(effectiveDate)
            ? nextBusinessDay(effectiveDate)
            : effectiveDate,
        };
      });


    let matchedSingle = 0;
    let matchedPair = 0;        // grupos de N lotes → 1 dep (N=2..MAX)
    let matchedPairLots = 0;    // total de lotes em grupos N-pra-1
    let matchedSplit = 0;        // 1 lote → 2 deps somados
    const updates: Array<{ id: string; bb_deposit_id: string; bb_deposit_id_2?: string | null; diff: number }> = [];
    const ambiguous: string[] = [];

    // Ordem dos passes (refatorado mar/26): single primeiro pq é a hipótese
    // de maior confiança. Antes Pass 1 (split) consumia deps que casariam
    // 1-pra-1 com outros lotes — caso real mar/26: lote R$244,26 dividia
    // dep #10 (R$198,81) + dep R$45,45, deixando lote 702400274 R$198,81
    // órfão sem que dep #10 fosse testado pra match exato.

    // Pass A: 1-pra-1 single (confiança máxima — valor exato + janela).
    // Empate por proximidade: se múltiplos lotes caem dentro da tolerância,
    // o de menor diff vence quando é o ÚNICO no menor diff. Crítico pra
    // Alelo (tolerância R$15 absorve tarifa de transação variável de R$1-3,
    // mas o lote sem tarifa de transação fica com diff 0 e ganha do com R$3).
    for (const dep of depPool) {
      if (dep.usedBy) continue;
      const taken = new Set(updates.map(u => u.id));
      const free = pendingLots.filter(l => !taken.has(l.id));
      const window = new Set(businessDayWindow(dep.deposit_date, WINDOW_DAYS));
      const candidates = free.filter(l => window.has(l.data_credito));

      const exactSingles = candidates
        .filter(l => Math.abs(l.valor_liquido - dep.amount) <= TOLERANCE)
        .map(l => ({ lot: l, diff: Math.abs(l.valor_liquido - dep.amount) }))
        .sort((a, b) => a.diff - b.diff);

      if (exactSingles.length === 0) continue;
      const minDiff = exactSingles[0].diff;
      const closest = exactSingles.filter(e => e.diff === minDiff);
      if (closest.length === 1) {
        const l = closest[0].lot;
        dep.usedBy = l.id;
        updates.push({ id: l.id, bb_deposit_id: dep.id, diff: dep.amount - l.valor_liquido });
        matchedSingle++;
      } else {
        ambiguous.push(`Depósito #${fmtBRDate(dep.deposit_date)} R$${dep.amount.toFixed(2)}: ${closest.length} lotes empatam no menor diff (R$${minDiff.toFixed(2)})`);
      }
    }

    // Pass B: 1 lote → 2 depósitos somados (Alelo divide um lote em 2 TEDs).
    // Caso real: ALELO-20260218 R$692,23 = #10 (R$530,95) + #11 (R$161,28).
    // Empate por menor diff absoluto da soma (igual Pass A).
    for (const lot of pendingLots) {
      const taken = new Set(updates.map(u => u.id));
      if (taken.has(lot.id)) continue;
      const window = new Set(businessDayWindow(lot.data_credito, WINDOW_DAYS));
      const candidates = depPool.filter(d => !d.usedBy && window.has(d.deposit_date));
      const pairs: { a: Dep; b: Dep; diff: number }[] = [];
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const a = candidates[i];
          const b = candidates[j];
          const diff = Math.abs((a.amount + b.amount) - lot.valor_liquido);
          if (diff <= TOLERANCE) {
            pairs.push({ a, b, diff });
          }
        }
      }
      if (pairs.length === 0) continue;
      pairs.sort((x, y) => x.diff - y.diff);
      const minDiff = pairs[0].diff;
      const closest = pairs.filter(p => p.diff === minDiff);
      if (closest.length === 1) {
        const { a, b } = closest[0];
        a.usedBy = lot.id;
        b.usedBy = lot.id;
        updates.push({
          id: lot.id,
          bb_deposit_id: a.id,
          bb_deposit_id_2: b.id,
          diff: (a.amount + b.amount) - lot.valor_liquido,
        });
        matchedSplit++;
      } else {
        ambiguous.push(`Lote ${lot.numero_reembolso} R$${lot.valor_liquido.toFixed(2)}: ${closest.length} pares de depósitos empatam no menor diff (R$${minDiff.toFixed(2)})`);
      }
    }

    // Pass C: N lotes → 1 depósito (até MAX_LOTS_PER_DEP). Caso real abr/26
    // Ticket: 3 lotes credito 13/04 somam R$610,44 = dep 13/04; 5 lotes
    // (datas 26-27/04 + carnaval) somam R$766,93 = dep 27/04.
    // Estratégia: tenta tamanhos crescentes 2,3,4,5; aceita o menor tamanho
    // com match único de menor diff. Tamanho menor = mais confiança.
    const MAX_LOTS_PER_DEP = 5;
    for (const dep of depPool) {
      if (dep.usedBy) continue;
      const taken = new Set(updates.map(u => u.id));
      const free = pendingLots.filter(l => !taken.has(l.id));
      const window = new Set(businessDayWindow(dep.deposit_date, WINDOW_DAYS));
      const candidates = free.filter(l => window.has(l.data_credito));

      // Subset sum: encontra todas combinações de tamanho [2..MAX] cuja soma
      // está dentro de TOLERANCE de dep.amount. Para cada tamanho, prefere
      // a combinação de menor diff se for única; senão marca ambíguo.
      let matched = false;
      for (let size = 2; size <= MAX_LOTS_PER_DEP && !matched; size++) {
        const found: { combo: PendingLot[]; diff: number }[] = [];
        const cur: PendingLot[] = [];
        const recurse = (start: number, sum: number) => {
          if (cur.length === size) {
            const diff = Math.abs(sum - dep.amount);
            if (diff <= TOLERANCE) found.push({ combo: [...cur], diff });
            return;
          }
          // Poda: se já passou do target + tolerance, não vale continuar
          // (todos os valores são positivos, somar mais só aumenta)
          if (sum - dep.amount > TOLERANCE) return;
          for (let i = start; i < candidates.length; i++) {
            cur.push(candidates[i]);
            recurse(i + 1, sum + candidates[i].valor_liquido);
            cur.pop();
          }
        };
        recurse(0, 0);
        if (found.length === 0) continue;
        found.sort((x, y) => x.diff - y.diff);
        const minDiff = found[0].diff;
        const closest = found.filter(c => c.diff === minDiff);
        if (closest.length === 1) {
          const { combo } = closest[0];
          dep.usedBy = combo.map(l => l.id).join(',');
          for (const l of combo) {
            updates.push({ id: l.id, bb_deposit_id: dep.id, diff: 0 });
          }
          matchedPair++;
          matchedPairLots += combo.length;
          matched = true;
        } else {
          ambiguous.push(`Depósito #${fmtBRDate(dep.deposit_date)} R$${dep.amount.toFixed(2)}: ${closest.length} combos de ${size} lotes empatam no menor diff (R$${minDiff.toFixed(2)})`);
          matched = true; // marca como tratado (ambíguo) e não tenta tamanhos maiores
        }
      }
    }

    // Pass D: Pool Banco Topázio (antecipação Edenred/Ticket). Lotes com
    // data_transacao_bb + valor_creditado_bb preenchidos manualmente são
    // creditados via "Cessão Créd Liquid Princ" pelo Banco Topázio (082) no
    // mesmo dia, agregados em 1-2 depósitos. Não respeita 1-pra-1 nem categoria
    // ticket — esses depósitos podem estar sob outra categoria no BB. Logo:
    // busca por dia + descrição cessão/topázio direto, independente de pool A/B/C.
    let matchedPoolLots = 0;
    let matchedPoolDeps = 0;
    if (operadora === 'ticket') {
      const takenIds = new Set(updates.map(u => u.id));
      const overrideLots = lots
        .filter(l => !l.bb_deposit_id && !takenIds.has(l.id))
        .filter(l => l.data_transacao_bb && l.valor_creditado_bb != null);

      // Agrupa por data_transacao_bb
      const byDate = new Map<string, typeof overrideLots>();
      for (const l of overrideLots) {
        const d = l.data_transacao_bb as string;
        if (!byDate.has(d)) byDate.set(d, []);
        byDate.get(d)!.push(l);
      }

      for (const [date, dayLots] of byDate.entries()) {
        // Busca depósitos BB no dia, ainda não casados, com descrição cessão/topázio.
        const { data: poolDeps } = await supabase
          .from('audit_bank_deposits')
          .select('id, deposit_date, amount, description, detail')
          .eq('audit_period_id', audit_period_id)
          .eq('bank', 'bb')
          .eq('deposit_date', date)
          .eq('matched', false);
        const candidates = (poolDeps ?? []).filter((d: any) => {
          const desc = String(d.description ?? '').toLowerCase();
          const det = String(d.detail ?? '').toLowerCase();
          return desc.includes('cess') || desc.includes('topazio') || desc.includes('topázio')
            || det.includes('cess') || det.includes('topazio') || det.includes('topázio');
        });
        if (candidates.length === 0) continue;
        const sumLots = dayLots.reduce((s, l) => s + Number(l.valor_creditado_bb), 0);
        const sumDeps = candidates.reduce((s: number, d: any) => s + Number(d.amount), 0);
        const POOL_TOLERANCE = 5;
        // Aceita se soma dos lotes <= soma dos deps + tolerância (deps podem
        // conter outras operadoras antecipadas invisíveis no PDF Ticket).
        if (sumLots > sumDeps + POOL_TOLERANCE) continue;
        const anchorDep = candidates[0];
        for (const l of dayLots) {
          updates.push({
            id: l.id,
            bb_deposit_id: anchorDep.id,
            diff: 0,
          });
          matchedPoolLots++;
        }
        // Marca todos os deps do pool como matched
        for (const d of candidates) {
          await supabase
            .from('audit_bank_deposits')
            .update({ matched: true, match_reason: 'pool_topazio' })
            .eq('id', d.id);
          matchedPoolDeps++;
        }
      }
    }

    for (const u of updates) {
      await supabase
        .from('audit_voucher_lots')
        .update({
          bb_deposit_id: u.bb_deposit_id,
          bb_deposit_id_2: u.bb_deposit_id_2 ?? null,
          diff: u.diff,
          status: 'matched',
        })
        .eq('id', u.id);
    }

    return new Response(JSON.stringify({
      success: true,
      total_lots: lots.length,
      matched_single: matchedSingle,
      matched_pair: matchedPair,
      matched_pair_lots: matchedPairLots,
      matched_split: matchedSplit,
      matched_pool_lots: matchedPoolLots,
      matched_pool_deps: matchedPoolDeps,
      matched: matchedSingle + matchedPairLots + matchedSplit + matchedPoolLots,
      ambiguous: ambiguous.slice(0, 20),
      message: `${matchedSingle} 1-pra-1 + ${matchedPair} grupos N-pra-1 (${matchedPairLots} lotes) + ${matchedSplit} 1 lote→2 deps${matchedPoolLots > 0 ? ` + ${matchedPoolLots} lotes pool Topázio (${matchedPoolDeps} deps)` : ''}${ambiguous.length > 0 ? ` (${ambiguous.length} ambíguos)` : ''}`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e: any) {
    console.error('match-vouchers error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
