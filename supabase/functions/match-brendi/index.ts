// @ts-nocheck
// Match Brendi (estágio 3). 3 passes:
// 1. Cross-check Saipos × Brendi (1-pra-1 por order_id_parceiro). Detecta:
//    - missing_in_brendi: Saipos viu pedido online mas Brendi não declarou (cobrável)
//    - value_mismatch: |saipos.total - brendi.total| > 2,00
//    - ok: caso restante
// 2. Calcular audit_brendi_daily (agrega Brendi por sale_date, computa expected_credit_date
//    via D+1 útil, agrupa dias consecutivos quando crédito cai no mesmo dia útil
//    (sex+sáb+dom → seg). Match com PIX BB Brendi por valor, marca diff_pct>5% como
//    pending_manual.
// 3. Adjacência: PIX BB com origem em mês ant ou post conta como adjacente
//    (não entra no expected do mês corrente).
//
// Mensalidade Brendi (~R$ 250-300): detectada quando received < expected E
// gap diff cai entre 200-350 e diff_pct > 5%. Marca status='mensalidade_descontada'.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { nextBusinessDay, isBusinessDay } from '../_shared/calendar.ts';
import { fetchAllPaginated } from '../_shared/pagination.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const VALUE_TOLERANCE_CROSSCHECK = 2.00; // R$ 2 entre Saipos e Brendi
const DIFF_PCT_THRESHOLD = 0.05;          // 5% pra marcar manual
const MENSALIDADE_MIN = 200;
const MENSALIDADE_MAX = 350;

// Parse "DD/MM " no início do detail BB pra obter data origem do PIX
function parseBBPixOrigin(detail: string, fallbackDate: string): string {
  const m = (detail || '').match(/^(\d{2})\/(\d{2})\s/);
  if (m) {
    // Sem ano explícito — usa ano da fallbackDate
    const year = fallbackDate.slice(0, 4);
    return `${year}-${m[2]}-${m[1]}`;
  }
  return fallbackDate;
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
    const userId = userData.user.id;
    const { data: roleData } = await supabase
      .from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin').maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Acesso restrito a admin' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { audit_period_id, reset } = body || {};
    if (!audit_period_id) {
      return new Response(JSON.stringify({ error: 'audit_period_id obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: period } = await supabase
      .from('audit_periods').select('id,month,year,status').eq('id', audit_period_id).maybeSingle();
    if (!period) {
      return new Response(JSON.stringify({ error: 'Período não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Reset: limpa daily anterior pra recalcular
    if (reset) {
      await supabase.from('audit_brendi_daily').delete().eq('audit_period_id', audit_period_id);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pass 1: Cross-check Saipos × Brendi
    // Usa fetchAllPaginated pra evitar limite default 1000 rows do PostgREST
    // — em meses com Brendi/Saipos > 1000 pedidos, o cross-check truncava
    // gerando falsos missing_in_brendi e missing_in_saipos.
    // ─────────────────────────────────────────────────────────────────────
    const saiposRows = await fetchAllPaginated<any>(
      supabase
        .from('audit_saipos_orders')
        .select('order_id_parceiro, pagamento, cancelado, total')
        .eq('audit_period_id', audit_period_id)
        .eq('canal_venda', 'Brendi')
        .eq('cancelado', false)
        .in('pagamento', ['Pix Online Brendi', 'Pago Online - Cartão de crédito']),
    );

    const brendiRows = await fetchAllPaginated<any>(
      supabase
        .from('audit_brendi_orders')
        .select('order_id, forma_pagamento, total')
        .eq('audit_period_id', audit_period_id),
    );

    const saiposMap = new Map<string, { pagamento: string; total: number }>();
    for (const s of saiposRows ?? []) {
      saiposMap.set(s.order_id_parceiro, { pagamento: s.pagamento, total: Number(s.total) });
    }
    const brendiMap = new Map<string, { forma: string; total: number }>();
    for (const b of brendiRows ?? []) {
      brendiMap.set(b.order_id, { forma: b.forma_pagamento, total: Number(b.total) });
    }

    const crosscheck = {
      ok: 0,
      missing_in_brendi: [] as Array<{ order_id: string; saipos_total: number; pagamento: string }>,
      missing_in_saipos: [] as Array<{ order_id: string; brendi_total: number; forma: string }>,
      value_mismatch: [] as Array<{ order_id: string; saipos_total: number; brendi_total: number; diff: number }>,
    };

    const allOrderIds = new Set([...saiposMap.keys(), ...brendiMap.keys()]);
    for (const oid of allOrderIds) {
      const s = saiposMap.get(oid);
      const b = brendiMap.get(oid);
      if (s && !b) {
        crosscheck.missing_in_brendi.push({ order_id: oid, saipos_total: s.total, pagamento: s.pagamento });
      } else if (!s && b) {
        crosscheck.missing_in_saipos.push({ order_id: oid, brendi_total: b.total, forma: b.forma });
      } else if (s && b) {
        const diff = Math.abs(s.total - b.total);
        if (diff > VALUE_TOLERANCE_CROSSCHECK) {
          crosscheck.value_mismatch.push({ order_id: oid, saipos_total: s.total, brendi_total: b.total, diff });
        } else {
          crosscheck.ok++;
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pass 2: audit_brendi_daily — agregação D+1 útil
    // ─────────────────────────────────────────────────────────────────────
    // Agrupa Brendi por sale_date
    const brendiBySaleDate = new Map<string, { count: number; total: number }>();
    for (const b of brendiRows ?? []) {
      const key = (b as any).sale_date ?? null;
      // sale_date não veio na select acima — refetch com sale_date
    }
    // Refetch com sale_date (paginado pra evitar limite 1000 do PostgREST)
    const brendiFull = await fetchAllPaginated<any>(
      supabase
        .from('audit_brendi_orders')
        .select('sale_date, total')
        .eq('audit_period_id', audit_period_id),
    );

    for (const b of brendiFull ?? []) {
      const key = b.sale_date;
      if (!key) continue;
      const cur = brendiBySaleDate.get(key) ?? { count: 0, total: 0 };
      cur.count++;
      cur.total += Number(b.total);
      brendiBySaleDate.set(key, cur);
    }

    // Pra cada sale_date, calcula expected_credit_date via nextBusinessDay
    // Agrupa por expected_credit_date (sex+sáb+dom → seg, todos com expected_credit = seg)
    const dailyMap = new Map<string, { sale_dates: string[]; pedidos_count: number; expected_amount: number }>();
    for (const [saleDate, agg] of brendiBySaleDate.entries()) {
      const expectedCredit = nextBusinessDay(saleDate);
      const cur = dailyMap.get(expectedCredit) ?? { sale_dates: [], pedidos_count: 0, expected_amount: 0 };
      cur.sale_dates.push(saleDate);
      cur.pedidos_count += agg.count;
      cur.expected_amount += agg.total;
      dailyMap.set(expectedCredit, cur);
    }

    // Pega depósitos BB Brendi pra fazer match
    const { data: bbDeps } = await supabase
      .from('audit_bank_deposits')
      .select('id, deposit_date, detail, amount')
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'bb')
      .eq('category', 'brendi')
      .order('deposit_date', { ascending: true });

    // Indexa BB por deposit_date
    const bbByDate = new Map<string, Array<{ id: string; amount: number; detail: string; pix_origin: string }>>();
    for (const d of bbDeps ?? []) {
      const arr = bbByDate.get(d.deposit_date) ?? [];
      arr.push({
        id: d.id,
        amount: Number(d.amount),
        detail: d.detail || '',
        pix_origin: parseBBPixOrigin(d.detail || '', d.deposit_date),
      });
      bbByDate.set(d.deposit_date, arr);
    }

    // Filtra daily pra MÊS DE COMPETÊNCIA do período. Vendas dos 3 meses
    // (ant + comp + post) ficam em audit_brendi_orders pra contexto, mas o KPI
    // expected/received do period.month entra só no daily — a auditoria é
    // mensal. Adjacentes ficam contados separadamente pra referência.
    const periodYM = `${period.year}-${String(period.month).padStart(2, '0')}`;
    const adjacent = { count: 0, expected: 0, received: 0 };

    // Match cada daily com depósito(s) do dia
    const dailyRows: any[] = [];
    for (const [expectedCredit, agg] of dailyMap.entries()) {
      const deps = bbByDate.get(expectedCredit) ?? [];
      const received = deps.reduce((s, d) => s + d.amount, 0);
      // Se o crédito esperado cai fora do mês de competência, conta como adjacente
      if (!expectedCredit.startsWith(periodYM)) {
        adjacent.count++;
        adjacent.expected += agg.expected_amount;
        adjacent.received += received;
        continue;
      }
      const diff = received - agg.expected_amount;
      const diffPct = agg.expected_amount > 0 ? Math.abs(diff) / agg.expected_amount : 0;

      let status: string;
      if (deps.length === 0) {
        status = 'sem_deposito';
      } else if (diffPct <= DIFF_PCT_THRESHOLD) {
        status = 'matched';
      } else if (
        diff < 0 &&
        Math.abs(diff) >= MENSALIDADE_MIN &&
        Math.abs(diff) <= MENSALIDADE_MAX
      ) {
        status = 'mensalidade_descontada';
      } else {
        status = 'pending_manual';
      }

      dailyRows.push({
        audit_period_id,
        expected_credit_date: expectedCredit,
        sale_dates: agg.sale_dates.sort(),
        pedidos_count: agg.pedidos_count,
        expected_amount: Math.round(agg.expected_amount * 100) / 100,
        received_amount: Math.round(received * 100) / 100,
        bb_deposit_ids: deps.map(d => d.id),
        diff: Math.round(diff * 100) / 100,
        diff_pct: Math.round(diffPct * 10000) / 10000,
        status,
      });
    }

    // Upsert dailyRows
    if (dailyRows.length > 0) {
      const { error: upErr } = await supabase
        .from('audit_brendi_daily')
        .upsert(dailyRows, { onConflict: 'audit_period_id,expected_credit_date' });
      if (upErr) {
        console.error('upsert audit_brendi_daily error', upErr);
        return new Response(JSON.stringify({ error: `Erro ao gravar daily: ${upErr.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // KPIs consolidados
    const totalExpected = dailyRows.reduce((s, d) => s + d.expected_amount, 0);
    const totalReceived = dailyRows.reduce((s, d) => s + d.received_amount, 0);
    const taxaEfetiva = totalExpected > 0 ? ((totalExpected - totalReceived) / totalExpected) * 100 : 0;
    const byStatus: Record<string, number> = {};
    for (const d of dailyRows) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;

    return new Response(JSON.stringify({
      success: true,
      crosscheck: {
        ok: crosscheck.ok,
        missing_in_brendi_count: crosscheck.missing_in_brendi.length,
        missing_in_brendi: crosscheck.missing_in_brendi.slice(0, 50),
        missing_in_saipos_count: crosscheck.missing_in_saipos.length,
        missing_in_saipos: crosscheck.missing_in_saipos.slice(0, 50),
        value_mismatch_count: crosscheck.value_mismatch.length,
        value_mismatch: crosscheck.value_mismatch.slice(0, 50),
      },
      daily: {
        rows: dailyRows.length,
        by_status: byStatus,
        total_expected: Math.round(totalExpected * 100) / 100,
        total_received: Math.round(totalReceived * 100) / 100,
        taxa_efetiva_pct: Math.round(taxaEfetiva * 100) / 100,
      },
      adjacent: {
        count: adjacent.count,
        expected: Math.round(adjacent.expected * 100) / 100,
        received: Math.round(adjacent.received * 100) / 100,
      },
      message: `${dailyRows.length} dias processados. ${crosscheck.ok} ok / ${crosscheck.missing_in_brendi.length} missing in brendi / ${crosscheck.value_mismatch.length} value mismatch.`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('match-brendi error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
