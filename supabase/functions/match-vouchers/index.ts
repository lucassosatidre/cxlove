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
const TOLERANCE = 0.02; // R$0,02
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

    // Reset matches automáticos (manual=false) se solicitado
    if (reset) {
      await supabase
        .from('audit_voucher_lots')
        .update({ bb_deposit_id: null, status: 'pending', diff: null })
        .eq('audit_period_id', audit_period_id)
        .eq('operadora', operadora)
        .eq('manual', false);
    }

    // Carrega lotes pendentes (sem bb_deposit_id e não-manuais)
    const { data: lots } = await supabase
      .from('audit_voucher_lots')
      .select('id, numero_reembolso, valor_liquido, data_credito, bb_deposit_id, manual')
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

    // Marca depósitos já usados por lotes manuais (sem reset)
    const { data: alreadyMatched } = await supabase
      .from('audit_voucher_lots')
      .select('id, bb_deposit_id')
      .eq('audit_period_id', audit_period_id)
      .eq('operadora', operadora)
      .not('bb_deposit_id', 'is', null);
    const usedIds = new Set((alreadyMatched ?? []).map(r => r.bb_deposit_id as string));
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
    let matchedPair = 0;
    const updates: Array<{ id: string; bb_deposit_id: string; diff: number }> = [];
    const ambiguous: string[] = [];

    // Itera POR DEPÓSITO (não por lote), pq um depósito pode pagar 2 lotes
    // somados (caso real: BB 23/03 R$226,57 = lote 422809580 R$141,74 + lote
    // 424272823 R$84,83). Tentamos:
    //   1) Match 1-pra-1 (valor exato)
    //   2) Combinação de 2 lotes (ambos com data_credito na janela do depósito)
    for (const dep of depPool) {
      if (dep.usedBy) continue;
      // Lotes ainda livres (que não foram empareados em iterações anteriores)
      const taken = new Set(updates.map(u => u.id));
      const free = pendingLots.filter(l => !taken.has(l.id));
      // Janela: data_credito_lote precisa estar em [dep.deposit_date ± 2 úteis]
      const window = new Set(businessDayWindow(dep.deposit_date, WINDOW_DAYS));
      const candidates = free.filter(l => window.has(l.data_credito));

      // 1) Match 1-pra-1
      const exactSingles = candidates.filter(l => Math.abs(l.valor_liquido - dep.amount) <= TOLERANCE);
      if (exactSingles.length === 1) {
        const l = exactSingles[0];
        dep.usedBy = l.id;
        updates.push({ id: l.id, bb_deposit_id: dep.id, diff: dep.amount - l.valor_liquido });
        matchedSingle++;
        continue;
      }
      if (exactSingles.length > 1) {
        ambiguous.push(`Depósito #${fmtBRDate(dep.deposit_date)} R$${dep.amount.toFixed(2)}: ${exactSingles.length} lotes com valor exato`);
        continue;
      }

      // 2) Combinação de 2 lotes (par cuja soma bate)
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
        // Diff total do depósito; cada lote recebe metade proporcional? Mais simples:
        // marcamos diff=0 pra cada lote (o "total a receber" do par bate certinho).
        updates.push({ id: a.id, bb_deposit_id: dep.id, diff: 0 });
        updates.push({ id: b.id, bb_deposit_id: dep.id, diff: 0 });
        matchedPair++;
        continue;
      }
      if (pairs.length > 1) {
        ambiguous.push(`Depósito #${fmtBRDate(dep.deposit_date)} R$${dep.amount.toFixed(2)}: ${pairs.length} pares de lotes possíveis`);
      }
    }

    for (const u of updates) {
      await supabase
        .from('audit_voucher_lots')
        .update({ bb_deposit_id: u.bb_deposit_id, diff: u.diff, status: 'matched' })
        .eq('id', u.id);
    }

    return new Response(JSON.stringify({
      success: true,
      total_lots: lots.length,
      matched_single: matchedSingle,
      matched_pair: matchedPair,
      matched: matchedSingle + matchedPair * 2,
      ambiguous: ambiguous.slice(0, 20),
      message: `${matchedSingle} lote(s) 1-pra-1 + ${matchedPair} par(es) somados${ambiguous.length > 0 ? ` (${ambiguous.length} ambíguos pra resolver manualmente)` : ''}`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('match-vouchers error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
