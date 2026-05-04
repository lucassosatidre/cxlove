// @ts-nocheck
// Match Brendi (estágio 3). 3 passes:
// 1. Cross-check Saipos × Brendi (1-pra-1 por order_id_parceiro). Detecta:
//    - missing_in_brendi: Saipos viu pedido online mas Brendi não declarou (cobrável)
//    - value_mismatch: |saipos.total - brendi.total| > 2,00 (tolera mixed-payment + cashback)
//    - ok: caso restante
// 2. Calcular audit_brendi_daily KEYED POR BB_CREDIT_DATE (data REAL do
//    extrato BB). Cada PIX Brendi tem prefix DD/MM = sale_date + 1 calendar.
//    Mapeamos cada sale_date pro bb_credit_date REAL via essa relação. Janela
//    de crédito BB agrupa múltiplas sale_dates (Sex+Sáb+Dom → Mon, ou
//    pré-carnaval Sex+Sáb+Dom+Seg+Ter → Qua). Match e diff_pct calculados
//    por janela de crédito → fecha limpo. Antes (v2) keyamos por sale_date
//    1:1 com PIX prefix, mas Brendi tem cutoff de batch ~06:00 BRT que
//    desalinha pedidos late-night vs sale_date BRT-calendário. v3 (esta)
//    resolve agrupando por janela real do BB credit.
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
const DIFF_ABS_THRESHOLD = 150;           // R$ 150 absoluto (baixo volume)
// Window cumulativa: se cumulative_diff_pct ≤ 5% até esse dia, promove
// pending_manual → matched_window. Brendi tem cutoff ~horário não-meia-noite,
// causa flutuação dia-a-dia (+R$500 num dia, -R$300 no seguinte). Cumulative
// fecha — o "ruído" é apenas timing entre PIX consecutivos.
const CUMULATIVE_DIFF_PCT_THRESHOLD = 0.05;

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
    // CLEANUP DEFENSIVO em 3 camadas. Pedidos que viraram lixo são removidos
    // de audit_brendi_orders ANTES do match — Brendi não repassa eles.
    //
    // Camada 1: status_remote != 'entregue' (case-insensitive) — expired,
    //   Recusado, Cancelado.
    // Camada 2: forma_pagamento fora de [Pix Online, Crédito Online] —
    //   pedidos offline (Crédito de máquina, Débito, Dinheiro, VR, etc) que
    //   por engano vazaram aqui.
    // Camada 3: order_id existe em Saipos com cancelado=true. Brendi report
    //   marca como Entregue mesmo quando o PDV cancelou pós-fato (cliente
    //   não pagou, expired, recusou no checkout). Saipos é fonte da verdade.
    // ─────────────────────────────────────────────────────────────────────
    const { data: junkRows } = await supabase
      .from('audit_brendi_orders')
      .select('id, order_id, status_remote, forma_pagamento')
      .eq('audit_period_id', audit_period_id);

    // Camada 3 prep: order_ids que Saipos diz que estão cancelados
    const saiposCanceledRows = await fetchAllPaginated<any>(
      supabase
        .from('audit_saipos_orders')
        .select('order_id_parceiro')
        .eq('audit_period_id', audit_period_id)
        .eq('canal_venda', 'Brendi')
        .eq('cancelado', true),
    );
    const saiposCanceledIds = new Set(
      (saiposCanceledRows ?? []).map(s => s.order_id_parceiro).filter(Boolean),
    );

    let junkDeleted = 0;
    const junkSamples: any = { statuses: {}, formas: {}, saipos_cancelados: 0 };
    if (junkRows && junkRows.length) {
      const idsToDelete: string[] = [];
      for (const r of junkRows) {
        const stat = (r.status_remote ?? '').normalize('NFC').trim().toLowerCase();
        const forma = (r.forma_pagamento ?? '').normalize('NFC').trim().toLowerCase();
        const isEntregue = stat === 'entregue';
        const isOnlineForma = forma === 'pix online' || forma === 'crédito online';
        const isSaiposCanceled = saiposCanceledIds.has(r.order_id);
        if (!isEntregue || !isOnlineForma || isSaiposCanceled) {
          idsToDelete.push(r.id);
          if (!isEntregue) junkSamples.statuses[r.status_remote ?? '<null>'] =
            (junkSamples.statuses[r.status_remote ?? '<null>'] ?? 0) + 1;
          if (!isOnlineForma) junkSamples.formas[r.forma_pagamento ?? '<null>'] =
            (junkSamples.formas[r.forma_pagamento ?? '<null>'] ?? 0) + 1;
          if (isSaiposCanceled) junkSamples.saipos_cancelados++;
        }
      }
      if (idsToDelete.length > 0) {
        const CHUNK = 200;
        for (let i = 0; i < idsToDelete.length; i += CHUNK) {
          const chunk = idsToDelete.slice(i, i + CHUNK);
          await supabase.from('audit_brendi_orders').delete().in('id', chunk);
        }
        junkDeleted = idsToDelete.length;
      }
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
    // Cross-check só do MÊS DE COMPETÊNCIA. Estágio 3 importa 3 meses
    // (ant+comp+post) pra cobrir D+1 entre meses, mas o cross-check de
    // jan/mar não importa pra auditoria de fev — polui a UI.
    const periodMonthStart = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
    const periodNextMonthStart = period.month === 12
      ? `${period.year + 1}-01-01`
      : `${period.year}-${String(period.month + 1).padStart(2, '0')}-01`;

    const saiposRows = await fetchAllPaginated<any>(
      supabase
        .from('audit_saipos_orders')
        .select('order_id_parceiro, pagamento, cancelado, total, data_venda, sale_date')
        .eq('audit_period_id', audit_period_id)
        .eq('canal_venda', 'Brendi')
        .eq('cancelado', false)
        .gte('sale_date', periodMonthStart)
        .lt('sale_date', periodNextMonthStart)
        .or('pagamento.ilike.%Pix Online Brendi%,pagamento.ilike.%Pago Online - Cartão de crédito%'),
    );

    const brendiRows = await fetchAllPaginated<any>(
      supabase
        .from('audit_brendi_orders')
        .select('order_id, forma_pagamento, total, cashback_usado, status_remote, created_at_remote, sale_date')
        .eq('audit_period_id', audit_period_id)
        .ilike('status_remote', 'entregue')
        .gte('sale_date', periodMonthStart)
        .lt('sale_date', periodNextMonthStart)
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
        .ilike('status_remote', 'entregue')
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

    // Pra cada sale_date, descobre seu bb_credit_date REAL (do extrato BB):
    // - se tem PIX com prefix (sale_date+1): bb_credit_date = deposit_date do PIX
    // - senão (sem_deposito): fallback nextBusinessDay(sale_date)
    function resolveCreditDate(sd: string): string {
      const pix = bbBySaleDate.get(sd);
      if (pix && pix.length > 0) {
        // Se múltiplos PIX (estorno fragmentou), pega data mais cedo.
        return pix.reduce((min, p) => p.deposit_date < min ? p.deposit_date : min, pix[0].deposit_date);
      }
      return nextBusinessDay(sd);
    }

    // Agrupa sale_dates por bb_credit_date REAL. Cada PIX Brendi tem prefix
    // que aponta pra UMA sale_date (= prefix - 1 calendar). Mapeamos sales
    // → bb_credit_date via essa relação. Janela de crédito BB casa com janela
    // de crédito BB → match limpo, fecha em soma e em UI por dia útil.
    const dailyByCreditDate = new Map<string, {
      sale_dates: Set<string>;
      pedidos_count: number;
      expected_bruto: number;
      expected_liquido: number;
      taxa_calculada: number;
      received: number;
      pix_ids: Set<string>;
    }>();

    const allSaleDates = new Set<string>([
      ...brendiBySaleDate.keys(),
      ...bbBySaleDate.keys(),
    ]);

    for (const sd of allSaleDates) {
      const sales = brendiBySaleDate.get(sd) ?? { count: 0, total: 0, taxa: 0 };
      const pix = bbBySaleDate.get(sd) ?? [];
      const cd = resolveCreditDate(sd);
      const cur = dailyByCreditDate.get(cd) ?? {
        sale_dates: new Set<string>(),
        pedidos_count: 0,
        expected_bruto: 0,
        expected_liquido: 0,
        taxa_calculada: 0,
        received: 0,
        pix_ids: new Set<string>(),
      };
      cur.sale_dates.add(sd);
      cur.pedidos_count += sales.count;
      cur.expected_bruto += sales.total;
      cur.taxa_calculada += sales.taxa;
      cur.expected_liquido += (sales.total - sales.taxa);
      for (const p of pix) {
        if (!cur.pix_ids.has(p.id)) {
          cur.received += p.amount;
          cur.pix_ids.add(p.id);
        }
      }
      dailyByCreditDate.set(cd, cur);
    }

    // PIX órfãos (prefix não parseável) — adiciona ao daily do deposit_date
    // como received extra, sem expected.
    for (const op of orphanPix) {
      const cd = op.deposit_date;
      const cur = dailyByCreditDate.get(cd) ?? {
        sale_dates: new Set<string>(),
        pedidos_count: 0, expected_bruto: 0, expected_liquido: 0,
        taxa_calculada: 0, received: 0, pix_ids: new Set<string>(),
      };
      if (!cur.pix_ids.has(op.id)) {
        cur.received += op.amount;
        cur.pix_ids.add(op.id);
      }
      dailyByCreditDate.set(cd, cur);
    }

    // Filtra pra mês de competência usando bb_credit_date.
    const periodYM = `${period.year}-${String(period.month).padStart(2, '0')}`;
    const adjacent = { count: 0, expected: 0, received: 0 };
    const dailyRows: any[] = [];

    for (const [cd, agg] of dailyByCreditDate.entries()) {
      const received = agg.received;
      const expectedLiquido = agg.expected_liquido;

      if (!cd.startsWith(periodYM)) {
        adjacent.count += agg.sale_dates.size;
        adjacent.expected += expectedLiquido;
        adjacent.received += received;
        continue;
      }

      const diff = received - expectedLiquido;
      const diffPct = expectedLiquido > 0 ? Math.abs(diff) / expectedLiquido : 0;

      let status: string;
      if (agg.pix_ids.size === 0) {
        status = 'sem_deposito';
      } else if (agg.pedidos_count === 0) {
        status = 'pending_manual'; // PIX órfão sem vendas
      } else if (diffPct <= DIFF_PCT_THRESHOLD || Math.abs(diff) <= DIFF_ABS_THRESHOLD) {
        // matched: pct OU absoluto baixo. Em dias de baixo volume (R$300),
        // 5% = R$15 que é apertado demais — R$150 absoluto absorve flutuação.
        status = 'matched';
      } else {
        status = 'pending_manual';
      }

      dailyRows.push({
        audit_period_id,
        bb_credit_date: cd,
        sale_dates: Array.from(agg.sale_dates).sort(),
        expected_credit_date: cd, // mantém retrocompat (informativo)
        pedidos_count: agg.pedidos_count,
        expected_amount: Math.round(agg.expected_bruto * 100) / 100,
        expected_liquido: Math.round(expectedLiquido * 100) / 100,
        taxa_calculada: Math.round(agg.taxa_calculada * 100) / 100,
        received_amount: Math.round(received * 100) / 100,
        bb_deposit_ids: Array.from(agg.pix_ids),
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

    // Pass 4: cumulative window matching. Brendi tem cutoff de batch ~horário
    // não-meia-noite, causando flutuação dia-a-dia (+R$580 num dia, -R$237
    // no seguinte) que se compensa em 1-2 dias. A SOMA cumulativa fecha. Se
    // até o dia X o |cumulative_diff| / cumulative_expected ≤ 5%, marca rows
    // pending_manual como matched_window — está dentro do esperado em janela.
    // Pula linhas com mensalidade_descontada (já tratadas).
    dailyRows.sort((a, b) => a.bb_credit_date.localeCompare(b.bb_credit_date));
    let cumDiff = 0;
    let cumExpected = 0;
    for (const d of dailyRows) {
      cumDiff += d.diff;
      cumExpected += d.expected_liquido;
      const cumPct = cumExpected > 0 ? Math.abs(cumDiff) / cumExpected : 0;
      d.cumulative_diff = Math.round(cumDiff * 100) / 100;
      d.cumulative_diff_pct = Math.round(cumPct * 10000) / 10000;
      if (
        d.status === 'pending_manual' &&
        cumPct <= CUMULATIVE_DIFF_PCT_THRESHOLD
      ) {
        d.status = 'matched_window';
      }
    }

    // Upsert dailyRows
    if (dailyRows.length > 0) {
      const { error: upErr } = await supabase
        .from('audit_brendi_daily')
        .upsert(dailyRows, { onConflict: 'audit_period_id,bb_credit_date' });
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
      cleanup: {
        junk_deleted: junkDeleted,
        statuses_dropped: junkSamples.statuses,
        formas_dropped: junkSamples.formas,
      },
      message: `${dailyRows.length} dias · ${crosscheck.ok} ok / ${crosscheck.missing_in_brendi.length} sem Brendi / ${crosscheck.value_mismatch.length} valor diff${junkDeleted > 0 ? ` · 🧹 ${junkDeleted} pedido(s) lixo removido(s)` : ''}.`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('match-brendi error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
