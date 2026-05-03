// @ts-nocheck
// Match iFood Marketplace (estágio 4). 3 passes:
// 1. Cross-check Saipos × iFood (1-pra-1 por order_id). Saipos.canal_venda='iFood'
//    AND pagamento ILIKE '%Online Ifood%'. Detecta missing/value_mismatch igual
//    estágio Brendi.
// 2. Agrega audit_ifood_marketplace_orders por sale_date → popula bruto_calc/
//    liquido_calc/pedidos_count em audit_ifood_marketplace_daily.
// 3. Match daily com depósitos Cresol (bank='cresol', category='ifood'). iFood
//    credita diariamente em PIX múltiplos por dia (vendas + entregas + ajustes).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { nextBusinessDay } from '../_shared/calendar.ts';
import { fetchAllPaginated } from '../_shared/pagination.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const VALUE_TOLERANCE_CROSSCHECK = 2.00;
const DIFF_PCT_THRESHOLD = 0.05;

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

    if (reset) {
      // Limpa só os campos calc/cresol/diff/status — preserva ifood_declarado_*
      // (que vêm do CSV de Auditoria iFood importado separadamente).
      await supabase
        .from('audit_ifood_marketplace_daily')
        .update({
          pedidos_count: 0, bruto_calc: 0, liquido_calc: 0,
          cresol_received: 0, cresol_deposit_ids: [],
          diff: 0, diff_pct: 0, status: 'pending',
        })
        .eq('audit_period_id', audit_period_id);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pass 1: Cross-check Saipos × iFood
    // Saipos pagamento contém "Online Ifood" (ex: "(PAGO) Online Ifood",
    // "Pgto via APP - PIX, Online Ifood", etc). Usa ILIKE substring.
    // ─────────────────────────────────────────────────────────────────────
    const saiposRows = await fetchAllPaginated<any>(
      supabase
        .from('audit_saipos_orders')
        .select('order_id_parceiro, pagamento, cancelado, total, data_venda')
        .eq('audit_period_id', audit_period_id)
        .eq('canal_venda', 'iFood')
        .eq('cancelado', false)
        .ilike('pagamento', '%Online Ifood%'),
    );

    const ifoodRows = await fetchAllPaginated<any>(
      supabase
        .from('audit_ifood_marketplace_orders')
        .select('order_id, status_pedido, total_pago_cliente, valor_liquido, sale_date, data_pedido')
        .eq('audit_period_id', audit_period_id)
        .eq('status_pedido', 'CONCLUIDO'),
    );

    const saiposMap = new Map<string, { pagamento: string; total: number; data_venda: string }>();
    for (const s of saiposRows ?? []) {
      saiposMap.set(s.order_id_parceiro, {
        pagamento: s.pagamento,
        total: Number(s.total),
        data_venda: s.data_venda,
      });
    }
    const ifoodMap = new Map<string, { total_pago: number; liquido: number; data_pedido: string; sale_date: string }>();
    for (const o of ifoodRows ?? []) {
      ifoodMap.set(o.order_id, {
        total_pago: Number(o.total_pago_cliente),
        liquido: Number(o.valor_liquido),
        data_pedido: o.data_pedido,
        sale_date: o.sale_date,
      });
    }

    const crosscheck = {
      ok: 0,
      missing_in_ifood: [] as Array<any>,
      missing_in_saipos: [] as Array<any>,
      value_mismatch: [] as Array<any>,
    };

    const allOrderIds = new Set([...saiposMap.keys(), ...ifoodMap.keys()]);
    for (const oid of allOrderIds) {
      const s = saiposMap.get(oid);
      const f = ifoodMap.get(oid);
      if (s && !f) {
        crosscheck.missing_in_ifood.push({
          order_id: oid, saipos_total: s.total, pagamento: s.pagamento, data_venda: s.data_venda,
        });
      } else if (!s && f) {
        crosscheck.missing_in_saipos.push({
          order_id: oid, ifood_total_pago: f.total_pago, ifood_liquido: f.liquido,
          data_pedido: f.data_pedido,
        });
      } else if (s && f) {
        // iFood total_pago_cliente = bruto pago pelo cliente (= Saipos.total
        // pra pedidos Online Ifood puros). Pagamento misto Saipos: total maior.
        const isMixedPayment = (s.pagamento || '').includes(',');
        const diff = s.total - f.total_pago;
        const isOk = isMixedPayment
          ? diff >= -VALUE_TOLERANCE_CROSSCHECK
          : Math.abs(diff) <= VALUE_TOLERANCE_CROSSCHECK;
        if (!isOk) {
          crosscheck.value_mismatch.push({
            order_id: oid, saipos_total: s.total, ifood_total_pago: f.total_pago,
            diff: Math.abs(diff), data: s.data_venda ?? f.data_pedido,
          });
        } else {
          crosscheck.ok++;
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pass 2: Agrega iFood orders por sale_date — popula bruto_calc/liquido_calc.
    // Filtra pelo mês de competência (sale_date dentro do mês).
    // ─────────────────────────────────────────────────────────────────────
    const periodYM = `${period.year}-${String(period.month).padStart(2, '0')}`;
    const bySaleDate = new Map<string, { count: number; bruto: number; liquido: number }>();
    for (const o of ifoodRows ?? []) {
      const sd = o.sale_date as string;
      if (!sd?.startsWith(periodYM)) continue;
      const cur = bySaleDate.get(sd) ?? { count: 0, bruto: 0, liquido: 0 };
      cur.count++;
      cur.bruto += Number(o.total_pago_cliente);
      cur.liquido += Number(o.valor_liquido);
      bySaleDate.set(sd, cur);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pass 3: Cresol depósitos Brendi/iFood agrupados por deposit_date.
    // Categoria 'ifood' já vem do import-cresol (regex /ifood/i).
    // ─────────────────────────────────────────────────────────────────────
    const { data: cresolDeps } = await supabase
      .from('audit_bank_deposits')
      .select('id, deposit_date, amount')
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'cresol')
      .eq('category', 'ifood');

    const cresolByDate = new Map<string, { ids: string[]; amount: number }>();
    for (const d of cresolDeps ?? []) {
      const cur = cresolByDate.get(d.deposit_date) ?? { ids: [], amount: 0 };
      cur.ids.push(d.id);
      cur.amount += Number(d.amount);
      cresolByDate.set(d.deposit_date, cur);
    }

    // Calcula daily rows. Usa union de sale_dates (do iFood orders) + datas de
    // Cresol que caem no mês — um daily por sale_date no mês.
    const allSaleDates = new Set<string>();
    for (const sd of bySaleDate.keys()) allSaleDates.add(sd);
    // iFood marketplace credita ~D+0 (mesmo dia ou próximo dia útil), então
    // aproximamos sale_date = deposit_date pra simplificar. Quem tem
    // "Depositado" do CSV declarado já confirma essa relação.
    for (const dd of cresolByDate.keys()) {
      if (dd?.startsWith(periodYM)) allSaleDates.add(dd);
    }

    const dailyRows: any[] = [];
    for (const sd of allSaleDates) {
      const agg = bySaleDate.get(sd) ?? { count: 0, bruto: 0, liquido: 0 };
      const dep = cresolByDate.get(sd) ?? { ids: [], amount: 0 };
      const diff = dep.amount - agg.liquido;
      const diffPct = agg.liquido > 0 ? Math.abs(diff) / agg.liquido : 0;

      let status: string;
      if (dep.amount === 0 && agg.liquido === 0) {
        status = 'pending';
      } else if (dep.amount === 0) {
        status = 'sem_deposito';
      } else if (diffPct <= DIFF_PCT_THRESHOLD) {
        status = 'matched';
      } else {
        status = 'pending_manual';
      }

      dailyRows.push({
        audit_period_id,
        sale_date: sd,
        expected_credit_date: nextBusinessDay(sd),
        pedidos_count: agg.count,
        bruto_calc: Math.round(agg.bruto * 100) / 100,
        liquido_calc: Math.round(agg.liquido * 100) / 100,
        cresol_received: Math.round(dep.amount * 100) / 100,
        cresol_deposit_ids: dep.ids,
        diff: Math.round(diff * 100) / 100,
        diff_pct: Math.round(diffPct * 10000) / 10000,
        status,
      });
    }

    if (dailyRows.length > 0) {
      // Upsert: NÃO sobrescreve ifood_declarado_* (que veio do CSV via
      // import-ifood-daily). Lista explícita de colunas pra preservar.
      const { error: upErr } = await supabase
        .from('audit_ifood_marketplace_daily')
        .upsert(dailyRows, { onConflict: 'audit_period_id,sale_date' });
      if (upErr) {
        console.error('upsert audit_ifood_marketplace_daily', upErr);
        return new Response(JSON.stringify({ error: `Erro ao gravar daily: ${upErr.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const totalLiquido = dailyRows.reduce((s, d) => s + d.liquido_calc, 0);
    const totalRecebido = dailyRows.reduce((s, d) => s + d.cresol_received, 0);
    const taxaEfetiva = dailyRows.reduce((s, d) => s + d.bruto_calc, 0) > 0
      ? ((dailyRows.reduce((s, d) => s + d.bruto_calc, 0) - totalLiquido) / dailyRows.reduce((s, d) => s + d.bruto_calc, 0)) * 100
      : 0;
    const byStatus: Record<string, number> = {};
    for (const d of dailyRows) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;

    return new Response(JSON.stringify({
      success: true,
      crosscheck: {
        ok: crosscheck.ok,
        missing_in_ifood_count: crosscheck.missing_in_ifood.length,
        missing_in_ifood: crosscheck.missing_in_ifood.slice(0, 50),
        missing_in_saipos_count: crosscheck.missing_in_saipos.length,
        missing_in_saipos: crosscheck.missing_in_saipos.slice(0, 50),
        value_mismatch_count: crosscheck.value_mismatch.length,
        value_mismatch: crosscheck.value_mismatch.slice(0, 50),
      },
      daily: {
        rows: dailyRows.length,
        by_status: byStatus,
        total_liquido_calc: Math.round(totalLiquido * 100) / 100,
        total_cresol_received: Math.round(totalRecebido * 100) / 100,
        taxa_efetiva_pct: Math.round(taxaEfetiva * 100) / 100,
      },
      message: `${dailyRows.length} dias · ${crosscheck.ok} ok / ${crosscheck.missing_in_ifood.length} sem iFood / ${crosscheck.value_mismatch.length} valor diff`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('match-ifood-marketplace error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
