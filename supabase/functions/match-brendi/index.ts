// @ts-nocheck
// Match Brendi (estágio 3). 3 passes:
// 1. Cross-check Saipos × Brendi (1-pra-1 por order_id_parceiro). Detecta:
//    - missing_in_brendi: Saipos viu pedido online mas Brendi não declarou (cobrável)
//    - value_mismatch: |saipos.total - brendi.total| > 2,00 (tolera mixed-payment + cashback)
//    - ok: caso restante
// 2. Calcular audit_brendi_daily KEYED POR SALE_DATE (não ECD): cada PIX BB
//    Brendi tem detail "DD/MM" que é a data do batch (= sale_date + 1
//    calendar). Agrega vendas por sale_date e PIX por sale_date_origin
//    (= prefix - 1d). 1 sale_date = 1 daily row = 1 PIX → match limpo.
//    Antes agregávamos por expected_credit_date (D+1 útil), o que misturava
//    Sex+Sáb+Dom no daily Mon e gerava ruído (diff_pct estourava mesmo com
//    cada PIX individual fechando direitinho).
// 3. Mensalidade: max abs(diff_liquido) por mês em [R$150, R$500] → marca
//    como mensalidade_descontada.
//
// Mensalidade Brendi (~R$ 250-300): UMA cobrança/mês embedada em algum PIX.
// Detecta o dia com maior excedente além da taxa-base 2% (range 200-400).
// Marca exatamente UM daily/mês como 'mensalidade_descontada'.

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

// Modelo de taxa Brendi (declarado em https://brendi.com.br/configuracoes/pagamentos):
// - Pix Online: 0,5% do total + R$ 0,40 fixo por pedido
// - Crédito Online D+0 (mesmo dia útil): 3,99% + 1,7% adiantamento = 5,69%
// - Crédito Online D+30: 3,99% (não usamos — repasses caem D+1 útil = D+0 efetivo)
const FEE_PIX_PCT = 0.005;
const FEE_PIX_FIXED = 0.40;
const FEE_CREDITO_D0_PCT = 0.0569; // 3.99% + 1.7%

function brendiFeePerPedido(forma: string, total: number): number {
  const f = (forma || '').normalize('NFC').trim().toLowerCase();
  if (f === 'pix online') return total * FEE_PIX_PCT + FEE_PIX_FIXED;
  if (f === 'crédito online') return total * FEE_CREDITO_D0_PCT;
  return 0;
}

// Mensalidade Brendi: ~R$250-300 deduzida UMA vez por mês de algum repasse
// PIX. Como expected_liquido já desconta as taxas declaradas, o diff_liquido
// fica próximo de zero exceto no dia da mensalidade. Pegamos a maior queda
// do mês em [R$150, R$500] como mensalidade.
const MENSALIDADE_MIN = 150;
const MENSALIDADE_MAX = 500;

// Parse "DD/MM " no início do detail BB → data do batch Brendi (= sale_date+1).
// Ex: "31/01 06:01 BRENDI SERV" → "2026-01-31" (batch run em 31/01, contém
// sales de 30/01). Sem ano explícito, usa ano do fallbackDate.
function parseBatchDate(detail: string, fallbackDate: string): string | null {
  const m = (detail || '').match(/^(\d{2})\/(\d{2})\s/);
  if (!m) return null;
  // Wraparound jan/dez: se prefix é jan e fallback é dez, ano-1; vice-versa.
  const prefMonth = Number(m[2]);
  const fallbackMonth = Number(fallbackDate.slice(5, 7));
  let year = Number(fallbackDate.slice(0, 4));
  if (prefMonth === 12 && fallbackMonth === 1) year -= 1;
  else if (prefMonth === 1 && fallbackMonth === 12) year += 1;
  return `${year}-${m[2]}-${m[1]}`;
}

// Sale_date que originou aquele PIX = batch_date - 1 calendar day
function batchDateToSaleDate(batchIso: string): string {
  const d = new Date(batchIso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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
    // Usa fetchAllPaginated pra evitar limite default 1000 rows do PostgREST.
    // Filtra status_remote='Entregue' + forma in escopo como defesa em
    // profundidade — caso lixo de imports antigos (antes do fix de status)
    // tenha sobrado no DB, não polui o cross-check ou daily.
    //
    // Saipos exporta `pagamento` como string com múltiplos métodos separados
    // por vírgula (ex: "Débito, Pix Online Brendi") quando o cliente paga em
    // partes. Por isso usamos `ilike` em vez de `in` — captura a substring
    // independente de método extra. Filtra Saipos com forma online no DB,
    // depois revalida tudo no JS.
    // ─────────────────────────────────────────────────────────────────────
    const saiposRows = await fetchAllPaginated<any>(
      supabase
        .from('audit_saipos_orders')
        .select('order_id_parceiro, pagamento, cancelado, total, data_venda')
        .eq('audit_period_id', audit_period_id)
        .eq('canal_venda', 'Brendi')
        .eq('cancelado', false)
        .or('pagamento.ilike.%Pix Online Brendi%,pagamento.ilike.%Pago Online - Cartão de crédito%'),
    );

    const brendiRows = await fetchAllPaginated<any>(
      supabase
        .from('audit_brendi_orders')
        .select('order_id, forma_pagamento, total, cashback_usado, status_remote, created_at_remote')
        .eq('audit_period_id', audit_period_id)
        .eq('status_remote', 'Entregue')
        .in('forma_pagamento', ['Pix Online', 'Crédito Online']),
    );

    const saiposMap = new Map<string, { pagamento: string; total: number; data_venda: string }>();
    for (const s of saiposRows ?? []) {
      saiposMap.set(s.order_id_parceiro, {
        pagamento: s.pagamento,
        total: Number(s.total),
        data_venda: s.data_venda,
      });
    }
    const brendiMap = new Map<string, { forma: string; total: number; cashback: number; created_at_remote: string }>();
    for (const b of brendiRows ?? []) {
      brendiMap.set(b.order_id, {
        forma: b.forma_pagamento,
        total: Number(b.total),
        cashback: Number(b.cashback_usado ?? 0),
        created_at_remote: b.created_at_remote,
      });
    }

    const crosscheck = {
      ok: 0,
      missing_in_brendi: [] as Array<{ order_id: string; saipos_total: number; pagamento: string; data_venda: string }>,
      missing_in_saipos: [] as Array<{ order_id: string; brendi_total: number; forma: string; created_at_remote: string }>,
      value_mismatch: [] as Array<{ order_id: string; saipos_total: number; brendi_total: number; diff: number; data: string }>,
    };

    const allOrderIds = new Set([...saiposMap.keys(), ...brendiMap.keys()]);
    for (const oid of allOrderIds) {
      const s = saiposMap.get(oid);
      const b = brendiMap.get(oid);
      if (s && !b) {
        crosscheck.missing_in_brendi.push({
          order_id: oid, saipos_total: s.total, pagamento: s.pagamento, data_venda: s.data_venda,
        });
      } else if (!s && b) {
        crosscheck.missing_in_saipos.push({
          order_id: oid, brendi_total: b.total, forma: b.forma, created_at_remote: b.created_at_remote,
        });
      } else if (s && b) {
        // 3 fontes de divergência legítima (não flagar):
        // 1. Pagamento misto Saipos ("Débito, Pix Online Brendi"): Saipos.total
        //    é o pedido inteiro, Brendi.total só a parcela online — Saipos>=Brendi.
        // 2. Cashback usado: cliente paga só uma fração com Pix Online; Brendi.total
        //    já vem líquido de cashback (col L), Saipos.total é o pedido cheio.
        //    Diff esperado ≈ b.cashback. Tolera diff dentro de cashback ± R$2.
        // 3. Caso normal: tolerância simétrica R$2.
        const isMixedPayment = (s.pagamento || '').includes(',');
        const diff = s.total - b.total;
        const cashbackExplains = b.cashback > 0 && Math.abs(diff - b.cashback) <= VALUE_TOLERANCE_CROSSCHECK;
        const isOk = isMixedPayment
          ? diff >= -VALUE_TOLERANCE_CROSSCHECK
          : cashbackExplains
            ? true
            : Math.abs(diff) <= VALUE_TOLERANCE_CROSSCHECK;
        if (!isOk) {
          crosscheck.value_mismatch.push({
            order_id: oid, saipos_total: s.total, brendi_total: b.total, diff: Math.abs(diff),
            data: s.data_venda ?? b.created_at_remote,
          });
        } else {
          crosscheck.ok++;
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pass 2: audit_brendi_daily — agregação D+1 útil
    // Aplica modelo de taxa por pedido (forma-dependente) pra calcular
    // expected_liquido. Antes usávamos só sum(total) (bruto) — agora também
    // descontamos a taxa declarada Brendi (Pix 0.5%+R$0.40, Crédito Online 5.69%).
    // ─────────────────────────────────────────────────────────────────────
    const brendiFull = await fetchAllPaginated<any>(
      supabase
        .from('audit_brendi_orders')
        .select('sale_date, total, forma_pagamento')
        .eq('audit_period_id', audit_period_id)
        .eq('status_remote', 'Entregue')
        .in('forma_pagamento', ['Pix Online', 'Crédito Online']),
    );

    // Aggrega vendas Brendi por sale_date, com fee por pedido (forma-dependente).
    const brendiBySaleDate = new Map<string, { count: number; total: number; taxa: number }>();
    for (const b of brendiFull ?? []) {
      const key = b.sale_date;
      if (!key) continue;
      const total = Number(b.total);
      const cur = brendiBySaleDate.get(key) ?? { count: 0, total: 0, taxa: 0 };
      cur.count++;
      cur.total += total;
      cur.taxa += brendiFeePerPedido(b.forma_pagamento, total);
      brendiBySaleDate.set(key, cur);
    }

    // Pega depósitos BB Brendi.
    const { data: bbDeps } = await supabase
      .from('audit_bank_deposits')
      .select('id, deposit_date, detail, amount')
      .eq('audit_period_id', audit_period_id)
      .eq('bank', 'bb')
      .eq('category', 'brendi')
      .order('deposit_date', { ascending: true });

    // Re-indexa BB por SALE_DATE de origem (= prefix DD/MM - 1 calendar day).
    // Cada PIX Brendi tem detail tipo "31/01 06:01 ..." — esse "31/01" é o dia
    // em que o batch rodou (= sale_date + 1). O sale_date real é prefix - 1.
    // Ex: PIX prefix "01/02" → batch Sun 01/02 → contém vendas Sat 31/01.
    // Esse model elimina o problema de Sex+Sáb+Dom serem todos creditados na
    // Mon e ficarem aglomerados num daily só (gerando ruído).
    const bbBySaleDate = new Map<string, Array<{
      id: string; amount: number; detail: string; deposit_date: string;
    }>>();
    const orphanPix: Array<{ id: string; amount: number; detail: string; deposit_date: string }> = [];
    for (const d of bbDeps ?? []) {
      const batchDate = parseBatchDate(d.detail || '', d.deposit_date);
      if (!batchDate) {
        orphanPix.push({ id: d.id, amount: Number(d.amount), detail: d.detail || '', deposit_date: d.deposit_date });
        continue;
      }
      const sd = batchDateToSaleDate(batchDate);
      const arr = bbBySaleDate.get(sd) ?? [];
      arr.push({ id: d.id, amount: Number(d.amount), detail: d.detail || '', deposit_date: d.deposit_date });
      bbBySaleDate.set(sd, arr);
    }

    // Daily = união de sale_dates (com vendas) + sale_dates derivadas de PIX.
    const allSaleDates = new Set<string>([
      ...brendiBySaleDate.keys(),
      ...bbBySaleDate.keys(),
    ]);

    // Filtra pra mês de competência. Sale_dates dos meses adjacentes ficam
    // contados separadamente.
    const periodYM = `${period.year}-${String(period.month).padStart(2, '0')}`;
    const adjacent = { count: 0, expected: 0, received: 0 };
    const dailyRows: any[] = [];

    for (const sd of allSaleDates) {
      const sales = brendiBySaleDate.get(sd) ?? { count: 0, total: 0, taxa: 0 };
      const pix = bbBySaleDate.get(sd) ?? [];
      const received = pix.reduce((s, p) => s + p.amount, 0);
      const expectedLiquido = sales.total - sales.taxa;

      if (!sd.startsWith(periodYM)) {
        adjacent.count++;
        adjacent.expected += expectedLiquido;
        adjacent.received += received;
        continue;
      }

      const diff = received - expectedLiquido;
      const diffPct = expectedLiquido > 0 ? Math.abs(diff) / expectedLiquido : 0;

      let status: string;
      if (pix.length === 0) {
        status = 'sem_deposito';
      } else if (sales.count === 0) {
        status = 'pending_manual'; // PIX órfão sem vendas (estorno?)
      } else if (diffPct <= DIFF_PCT_THRESHOLD) {
        status = 'matched';
      } else {
        status = 'pending_manual';
      }

      // expected_credit_date = nextBusinessDay(sale_date) — informativo, NÃO
      // mais usado pro match. bb_credit_date = data real em que o PIX caiu
      // (deposit_date do PIX, primeiro se vários). Se não há PIX, fica null.
      const ecd = nextBusinessDay(sd);
      const bbCreditDate = pix.length > 0 ? pix[0].deposit_date : null;

      dailyRows.push({
        audit_period_id,
        sale_date: sd,
        expected_credit_date: ecd,
        bb_credit_date: bbCreditDate,
        pedidos_count: sales.count,
        expected_amount: Math.round(sales.total * 100) / 100,
        expected_liquido: Math.round(expectedLiquido * 100) / 100,
        taxa_calculada: Math.round(sales.taxa * 100) / 100,
        received_amount: Math.round(received * 100) / 100,
        bb_deposit_ids: pix.map(p => p.id),
        diff: Math.round(diff * 100) / 100,
        diff_pct: Math.round(diffPct * 10000) / 10000,
        status,
      });
    }

    // Pass 3: detecta UMA mensalidade no mês inteiro. Pra cada daily com diff
    // negativo, calcula o "excedente" além da taxa-base esperada (2% do
    // expected). Se o maior excedente do mês cair em [200, 400], esse daily
    // ganha status 'mensalidade_descontada' e os outros mantêm o status do
    // pass 2 (matched/pending_manual). Como diff é contra expected_LIQUIDO,
    // usamos abs(diff) direto (sem subtrair baseline — taxa já descontada).
    let mensalidadeIdx = -1;
    let mensalidadeAmount = 0;
    for (let i = 0; i < dailyRows.length; i++) {
      const d = dailyRows[i];
      if (d.diff >= 0) continue;
      const absDiff = Math.abs(d.diff);
      if (
        absDiff >= MENSALIDADE_MIN &&
        absDiff <= MENSALIDADE_MAX &&
        absDiff > mensalidadeAmount
      ) {
        mensalidadeIdx = i;
        mensalidadeAmount = absDiff;
      }
    }
    if (mensalidadeIdx >= 0) {
      dailyRows[mensalidadeIdx].status = 'mensalidade_descontada';
    }

    // Upsert dailyRows
    if (dailyRows.length > 0) {
      const { error: upErr } = await supabase
        .from('audit_brendi_daily')
        .upsert(dailyRows, { onConflict: 'audit_period_id,sale_date' });
      if (upErr) {
        console.error('upsert audit_brendi_daily error', upErr);
        return new Response(JSON.stringify({ error: `Erro ao gravar daily: ${upErr.message}` }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // KPIs consolidados
    const totalExpectedBruto = dailyRows.reduce((s, d) => s + d.expected_amount, 0);
    const totalExpectedLiquido = dailyRows.reduce((s, d) => s + d.expected_liquido, 0);
    const totalTaxa = dailyRows.reduce((s, d) => s + d.taxa_calculada, 0);
    const totalReceived = dailyRows.reduce((s, d) => s + d.received_amount, 0);
    const taxaEfetiva = totalExpectedBruto > 0 ? ((totalExpectedBruto - totalReceived) / totalExpectedBruto) * 100 : 0;
    const taxaDeclarada = totalExpectedBruto > 0 ? (totalTaxa / totalExpectedBruto) * 100 : 0;
    const custoOculto = totalExpectedLiquido - totalReceived; // diferença não explicada pelas taxas declaradas
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
        total_expected: Math.round(totalExpectedBruto * 100) / 100,
        total_expected_liquido: Math.round(totalExpectedLiquido * 100) / 100,
        total_taxa_declarada: Math.round(totalTaxa * 100) / 100,
        total_received: Math.round(totalReceived * 100) / 100,
        taxa_efetiva_pct: Math.round(taxaEfetiva * 100) / 100,
        taxa_declarada_pct: Math.round(taxaDeclarada * 100) / 100,
        custo_oculto: Math.round(custoOculto * 100) / 100,
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
