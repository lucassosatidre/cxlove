// @ts-nocheck
// Auto-match Ticket: pra cada lote pendente, busca depósito BB
// (bank='bb', category='ticket') com amount == valor_liquido (±0.02) E
// deposit_date dentro de janela [data_credito ± 2 dias úteis SC]. Match
// prioritário pra lotes com data_credito mais antiga.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { businessDayWindow } from '../_shared/calendar.ts';

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
  pluxee: 0.02,
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

    // Reset matches automáticos (manual=false) se solicitado
    if (reset) {
      await supabase
        .from('audit_voucher_lots')
        .update({ bb_deposit_id: null, bb_deposit_id_2: null, status: 'pending', diff: null })
        .eq('audit_period_id', audit_period_id)
        .eq('operadora', operadora)
        .eq('manual', false);
    }

    // Carrega lotes pendentes (sem bb_deposit_id e não-manuais)
    const { data: lots } = await supabase
      .from('audit_voucher_lots')
      .select('id, numero_reembolso, valor_liquido, data_credito, bb_deposit_id, bb_deposit_id_2, manual')
      .eq('audit_period_id', audit_period_id)
      .eq('operadora', operadora)
      .order('data_credito', { ascending: true });

    if (!lots || lots.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'Nenhum lote a processar', matched: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Carrega depósitos BB Ticket — filtramos no app pq janelas variam por lote
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

    // Marca depósitos já usados por lotes manuais ou pré-existentes (em
    // bb_deposit_id ou bb_deposit_id_2)
    const { data: alreadyMatched } = await supabase
      .from('audit_voucher_lots')
      .select('id, bb_deposit_id, bb_deposit_id_2')
      .eq('audit_period_id', audit_period_id)
      .eq('operadora', operadora);
    const usedIds = new Set<string>();
    for (const r of (alreadyMatched ?? [])) {
      if (r.bb_deposit_id) usedIds.add(r.bb_deposit_id as string);
      if (r.bb_deposit_id_2) usedIds.add(r.bb_deposit_id_2 as string);
    }
    for (const d of depPool) if (usedIds.has(d.id)) d.usedBy = 'preexisting';

    type PendingLot = { id: string; numero_reembolso: string; valor_liquido: number; data_credito: string };
    const pendingLots: PendingLot[] = lots
      .filter(l => !l.bb_deposit_id)
      .map(l => ({
        id: l.id,
        numero_reembolso: l.numero_reembolso,
        valor_liquido: Number(l.valor_liquido),
        data_credito: l.data_credito,
      }));

    let matchedSingle = 0;
    let matchedPair = 0;        // 2 lotes → 1 dep
    let matchedSplit = 0;        // 1 lote → 2 deps somados
    const updates: Array<{ id: string; bb_deposit_id: string; bb_deposit_id_2?: string | null; diff: number }> = [];
    const ambiguous: string[] = [];

    // Ordem dos passes (refatorado mar/26): single primeiro pq é a hipótese
    // de maior confiança. Antes Pass 1 (split) consumia deps que casariam
    // 1-pra-1 com outros lotes — caso real mar/26: lote R$244,26 dividia
    // dep #10 (R$198,81) + dep R$45,45, deixando lote 702400274 R$198,81
    // órfão sem que dep #10 fosse testado pra match exato.

    // Pass A: 1-pra-1 single (confiança máxima — valor exato + janela)
    for (const dep of depPool) {
      if (dep.usedBy) continue;
      const taken = new Set(updates.map(u => u.id));
      const free = pendingLots.filter(l => !taken.has(l.id));
      const window = new Set(businessDayWindow(dep.deposit_date, WINDOW_DAYS));
      const candidates = free.filter(l => window.has(l.data_credito));

      const exactSingles = candidates.filter(l => Math.abs(l.valor_liquido - dep.amount) <= TOLERANCE);
      if (exactSingles.length === 1) {
        const l = exactSingles[0];
        dep.usedBy = l.id;
        updates.push({ id: l.id, bb_deposit_id: dep.id, diff: dep.amount - l.valor_liquido });
        matchedSingle++;
      } else if (exactSingles.length > 1) {
        ambiguous.push(`Depósito #${fmtBRDate(dep.deposit_date)} R$${dep.amount.toFixed(2)}: ${exactSingles.length} lotes com valor exato`);
      }
    }

    // Pass B: 1 lote → 2 depósitos somados (Alelo divide um lote em 2 TEDs).
    // Caso real: ALELO-20260218 R$692,23 = #10 (R$530,95) + #11 (R$161,28).
    for (const lot of pendingLots) {
      const taken = new Set(updates.map(u => u.id));
      if (taken.has(lot.id)) continue;
      const window = new Set(businessDayWindow(lot.data_credito, WINDOW_DAYS));
      const candidates = depPool.filter(d => !d.usedBy && window.has(d.deposit_date));
      const pairs: [Dep, Dep][] = [];
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const a = candidates[i];
          const b = candidates[j];
          if (Math.abs((a.amount + b.amount) - lot.valor_liquido) <= TOLERANCE) {
            pairs.push([a, b]);
          }
        }
      }
      if (pairs.length === 1) {
        const [a, b] = pairs[0];
        a.usedBy = lot.id;
        b.usedBy = lot.id;
        updates.push({
          id: lot.id,
          bb_deposit_id: a.id,
          bb_deposit_id_2: b.id,
          diff: (a.amount + b.amount) - lot.valor_liquido,
        });
        matchedSplit++;
      } else if (pairs.length > 1) {
        ambiguous.push(`Lote ${lot.numero_reembolso} R$${lot.valor_liquido.toFixed(2)}: ${pairs.length} pares de depósitos possíveis`);
      }
    }

    // Pass C: 2 lotes → 1 depósito (par de lotes cuja soma == dep.amount)
    for (const dep of depPool) {
      if (dep.usedBy) continue;
      const taken = new Set(updates.map(u => u.id));
      const free = pendingLots.filter(l => !taken.has(l.id));
      const window = new Set(businessDayWindow(dep.deposit_date, WINDOW_DAYS));
      const candidates = free.filter(l => window.has(l.data_credito));

      const pairs: [PendingLot, PendingLot][] = [];
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const a = candidates[i];
          const b = candidates[j];
          if (Math.abs((a.valor_liquido + b.valor_liquido) - dep.amount) <= TOLERANCE) {
            pairs.push([a, b]);
          }
        }
      }
      if (pairs.length === 1) {
        const [a, b] = pairs[0];
        dep.usedBy = `${a.id},${b.id}`;
        updates.push({ id: a.id, bb_deposit_id: dep.id, diff: 0 });
        updates.push({ id: b.id, bb_deposit_id: dep.id, diff: 0 });
        matchedPair++;
      } else if (pairs.length > 1) {
        ambiguous.push(`Depósito #${fmtBRDate(dep.deposit_date)} R$${dep.amount.toFixed(2)}: ${pairs.length} pares de lotes possíveis`);
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
      matched_split: matchedSplit,
      matched: matchedSingle + matchedPair * 2 + matchedSplit,
      ambiguous: ambiguous.slice(0, 20),
      message: `${matchedSingle} 1-pra-1 + ${matchedPair} 2 lotes→1 dep + ${matchedSplit} 1 lote→2 deps${ambiguous.length > 0 ? ` (${ambiguous.length} ambíguos)` : ''}`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('match-vouchers error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
