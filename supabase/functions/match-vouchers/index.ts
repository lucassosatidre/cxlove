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

    let matched = 0;
    const updates: Array<{ id: string; bb_deposit_id: string; diff: number }> = [];
    const ambiguous: string[] = [];

    for (const lot of lots) {
      // Skip lotes que JÁ têm bb_deposit_id (manual ou pre-existing match)
      if (lot.bb_deposit_id) continue;
      const liq = Number(lot.valor_liquido);
      const window = new Set(businessDayWindow(lot.data_credito, WINDOW_DAYS));
      // Candidatos: depósitos não-usados, dentro da janela, valor bate
      const candidates = depPool.filter(d =>
        !d.usedBy && window.has(d.deposit_date) && Math.abs(d.amount - liq) <= TOLERANCE
      );
      if (candidates.length === 1) {
        const c = candidates[0];
        c.usedBy = lot.id;
        updates.push({ id: lot.id, bb_deposit_id: c.id, diff: c.amount - liq });
        matched++;
      } else if (candidates.length > 1) {
        // Ambíguo — escolhe o de data exata; senão, deixa pendente pra resolução manual
        const exact = candidates.filter(c => c.deposit_date === lot.data_credito);
        if (exact.length === 1) {
          const c = exact[0];
          c.usedBy = lot.id;
          updates.push({ id: lot.id, bb_deposit_id: c.id, diff: c.amount - liq });
          matched++;
        } else {
          ambiguous.push(`Lote ${lot.numero_reembolso}: ${candidates.length} depósitos candidatos (mesmo valor R$${liq.toFixed(2)})`);
        }
      }
    }

    // Aplica updates em batch (1 update por lote)
    for (const u of updates) {
      await supabase
        .from('audit_voucher_lots')
        .update({ bb_deposit_id: u.bb_deposit_id, diff: u.diff, status: 'matched' })
        .eq('id', u.id);
    }

    return new Response(JSON.stringify({
      success: true,
      total_lots: lots.length,
      matched,
      ambiguous: ambiguous.slice(0, 20),
      message: `${matched} lotes pareados automaticamente${ambiguous.length > 0 ? ` (${ambiguous.length} ambíguos pra resolver manualmente)` : ''}`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('match-vouchers error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
