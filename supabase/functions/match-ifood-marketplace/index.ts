// @ts-nocheck
// match-ifood-marketplace v2.6 (2026-05-08) — tolerancia R$100 (cobre realocacao de ciclo)
// match-ifood-marketplace v2 — 3 passes:
//
// Pass 1: Cross-check Saipos × audit_ifood_orders por order_id
//   Saipos (canal=iFood, ILIKE '%Online Ifood%', cancelado=false)
//   × audit_ifood_orders (status='CONCLUIDO')
//   Match único, agnóstico de loja. Tolerance R$2.
//   Detecta missing_in_ifood / missing_in_saipos / value_mismatch.
//
// Pass 2: Match repasse esperado × antecipação CSV (conta iFood Pago)
//   Soma audit_ifood_repasses por (period, data_repasse_esperada) das 2 lojas.
//   data_repasse_esperada agora é a data EFETIVA (D+3 quarta após corte
//   domingo, ou D+4 após sábado fim do mês), não mais o nominal D+24.
//   Pra cada audit_ifood_conta_movimentos[categoria='repasse']:
//     procura data_esperada onde:
//       data_csv == data_esperada AND
//       valor_csv ≈ soma_repasses_esperados_dessa_data (±R$1 tolerance)
//   Match exato → status='matched'. Aprox → 'matched_aprox'.
//   Antecipação sem match (provavelmente outra comp) → 'unmatched_outra_comp'.
//   Repasse esperado sem antecipação → 'sem_repasse'.
//
// Pass 3: Calcula taxa de antecipação por repasse matched
//   Pra cada taxa_antecip do CSV, busca antecipação MATCHED do mesmo dia onde
//     valor_taxa ≈ subtotal × 1,99% (±R$1).
//   Se 2 lojas matched no mesmo dia, rateia taxa por proporção do subtotal.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
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
const ANTECIP_RATE = 0.0199;
const ANTECIP_TOLERANCE = 5.0;
const REPASSE_TOLERANCE_EXATO = 0.10;
// Tolerância "aproximada" subiu pra R$100 porque há diferenças naturais
// entre o liquido_esperado (extrato detalhado iFood) e o PIX que cai na conta:
//   - pedido em domingo de corte cuja contabilização iFood realocou pro
//     ciclo seguinte (constatado fev/26: R$59,57 entre 25/02 e 04/03)
//   - reembolsos/ressarcimentos pós-fechamento que entram em outro ciclo
//   - taxa serviço cliente retida que ajusta o líquido
//   - arredondamentos somados em centenas de pedidos
// R$100 ainda é segurança boa: PIX de outra comp difere em MILHARES,
// não centenas — false positive é improvável.
const REPASSE_TOLERANCE_APROX = 100.0;

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
      // Reset apenas as colunas de match nos repasses (preserva agregação)
      await supabase
        .from('audit_ifood_repasses')
        .update({
          conta_recebido: null, conta_data_recebimento: null,
          conta_taxa_antecip: null, liquido_efetivo: null,
          conta_movimento_id: null, status: 'pending',
          diff: null,
        })
        .eq('audit_period_id', audit_period_id);
      await supabase
        .from('audit_ifood_conta_movimentos')
        .update({ status: 'pending', match_repasse_ids: [] })
        .eq('audit_period_id', audit_period_id);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pass 1: Cross-check Saipos × audit_ifood_orders
    // ─────────────────────────────────────────────────────────────────────
    // Filtra Saipos por mês de competência. Saipos importa 3 meses (jan+fev+mar
    // pra suportar cross-month do Brendi), mas o cross-check iFood deve casar
    // só com o relatório de pedidos do mês comp. Sem o filtro, pedidos Saipos
    // de jan/mar viram falsos positivos "missing_in_ifood".
    const monthStart = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
    const nextMonthStart = period.month === 12
      ? `${period.year + 1}-01-01`
      : `${period.year}-${String(period.month + 1).padStart(2, '0')}-01`;

    // Cruza TODOS pedidos canal=iFood do Saipos (não apenas "Online Ifood").
    // O relatório iFood lista pedidos pgto-na-entrega/dinheiro/cartão físico
    // também — sem este universo amplo, ~560 pedidos viram falsos positivos
    // missing_in_saipos.
    const saiposRows = await fetchAllPaginated<any>(
      supabase
        .from('audit_saipos_orders')
        .select('order_id_parceiro, pagamento, cancelado, total, data_venda, total_taxa_servico')
        .eq('audit_period_id', audit_period_id)
        .eq('canal_venda', 'iFood')
        .eq('cancelado', false)
        .gte('data_venda', monthStart)
        .lt('data_venda', nextMonthStart),
    );

    const ifoodRows = await fetchAllPaginated<any>(
      supabase
        .from('audit_ifood_orders')
        .select('order_id, status_pedido, total_pago_cliente, valor_liquido, taxa_servico, sale_date, data_pedido, store_id_curto')
        .eq('audit_period_id', audit_period_id)
        .eq('status_pedido', 'CONCLUIDO'),
    );

    const saiposMap = new Map<string, { pagamento: string; total: number; data_venda: string; total_taxa_servico: number }>();
    for (const s of saiposRows ?? []) {
      saiposMap.set(s.order_id_parceiro, {
        pagamento: s.pagamento,
        total: Number(s.total),
        data_venda: s.data_venda,
        total_taxa_servico: Number(s.total_taxa_servico ?? 0),
      });
    }
    const ifoodMap = new Map<string, { total_pago: number; liquido: number; taxa_servico: number; data_pedido: string; sale_date: string; store_id_curto: string }>();
    for (const o of ifoodRows ?? []) {
      ifoodMap.set(o.order_id, {
        total_pago: Number(o.total_pago_cliente),
        liquido: Number(o.valor_liquido),
        taxa_servico: Number(o.taxa_servico ?? 0),
        data_pedido: o.data_pedido,
        sale_date: o.sale_date,
        store_id_curto: o.store_id_curto,
      });
    }

    const crosscheck = {
      ok: 0,
      missing_in_ifood: [] as Array<any>,
      missing_in_saipos: [] as Array<any>,
      // Pedidos com valor_liquido<0 no relatório iFood são ajustes pós-fato
      // (cancelamento/reembolso) reaparecendo num mês diferente. Não são
      // pedidos novos faltando no Saipos — segregados pra não inflar o ruído.
      missing_in_saipos_adjustments: [] as Array<any>,
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
        const bucket = f.liquido < 0
          ? crosscheck.missing_in_saipos_adjustments
          : crosscheck.missing_in_saipos;
        bucket.push({
          order_id: oid, ifood_total_pago: f.total_pago, ifood_liquido: f.liquido,
          data_pedido: f.data_pedido, store_id_curto: f.store_id_curto,
        });
      } else if (s && f) {
        // Diferença esperada Saipos × iFood é a taxa de serviço cliente que
        // o iFood retém (não vai pra loja, fica com iFood). Saipos.total não
        // inclui essa taxa; iFood.total_pago_cliente inclui. Logo:
        //   iFood.total_pago_cliente - iFood.taxa_servico ≈ Saipos.total
        // Tolerância: 2,00 absoluta + ajuste pgto misto Saipos.
        const isMixedPayment = (s.pagamento || '').includes(',');
        const diffSimple = s.total - f.total_pago;
        const diffAdjusted = s.total - (f.total_pago - f.taxa_servico);
        const isOk = isMixedPayment
          ? (diffSimple >= -VALUE_TOLERANCE_CROSSCHECK || Math.abs(diffAdjusted) <= VALUE_TOLERANCE_CROSSCHECK)
          : (Math.abs(diffSimple) <= VALUE_TOLERANCE_CROSSCHECK || Math.abs(diffAdjusted) <= VALUE_TOLERANCE_CROSSCHECK);
        if (!isOk) {
          crosscheck.value_mismatch.push({
            order_id: oid, saipos_total: s.total, ifood_total_pago: f.total_pago,
            ifood_taxa_servico: f.taxa_servico,
            diff: Math.abs(diffSimple),
            diff_sem_taxa_servico: Math.abs(diffAdjusted),
            data: s.data_venda ?? f.data_pedido,
            pagamento_saipos: s.pagamento,
            store_id_curto: f.store_id_curto,
          });
        } else {
          crosscheck.ok++;
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pass 2: Match repasse esperado × antecipação CSV
    // ─────────────────────────────────────────────────────────────────────
    const repasses = await fetchAllPaginated<any>(
      supabase
        .from('audit_ifood_repasses')
        .select('id, store_id_curto, data_repasse_esperada, liquido_esperado')
        .eq('audit_period_id', audit_period_id),
    );

    const conta = await fetchAllPaginated<any>(
      supabase
        .from('audit_ifood_conta_movimentos')
        .select('id, data, descricao, valor, categoria')
        .eq('audit_period_id', audit_period_id),
    );

    // Soma repasses por data (todas lojas) — pra antecipação que vem somada
    const expectedByDate = new Map<string, { soma: number; ids: string[] }>();
    for (const r of repasses ?? []) {
      const cur = expectedByDate.get(r.data_repasse_esperada) ?? { soma: 0, ids: [] };
      cur.soma += Number(r.liquido_esperado || 0);
      cur.ids.push(r.id);
      expectedByDate.set(r.data_repasse_esperada, cur);
    }

    const repassesById = new Map<string, any>();
    for (const r of repasses ?? []) repassesById.set(r.id, r);

    // Pass 2: itera antecipações ordenadas por data, tenta match exato com soma esperada
    const antecipacoes = (conta ?? []).filter(c => c.categoria === 'repasse').sort((a, b) => a.data.localeCompare(b.data));
    const taxas = (conta ?? []).filter(c => c.categoria === 'taxa_antecip').sort((a, b) => a.data.localeCompare(b.data));

    const matchedDataSet = new Set<string>(); // datas esperadas já matched
    const matchedAntecipIds = new Set<string>(); // ids de antecipações que casaram (pra Pass 3)
    const repasseUpdates: Array<{ id: string; payload: any }> = [];
    const movimentoUpdates: Array<{ id: string; payload: any }> = [];
    // Diagnóstico: registro por antecipação do que aconteceu
    const antecipDiag: Array<{
      data: string; valor: number; status: string;
      esperado_soma: number; diff: number; razao: string;
    }> = [];

    for (const a of antecipacoes) {
      // data_repasse_esperada agora é a data EFETIVA do recebimento (D+3/D+4),
      // que é a mesma data em que cai a antecipação no CSV iFood Pago.
      const dataEsperada = a.data;
      const exp = expectedByDate.get(dataEsperada);
      if (!exp) {
        movimentoUpdates.push({ id: a.id, payload: { status: 'unmatched_outra_comp', match_repasse_ids: [] } });
        antecipDiag.push({ data: a.data, valor: Number(a.valor), status: 'unmatched_outra_comp', esperado_soma: 0, diff: 0, razao: 'sem repasse esperado nesta data' });
        continue;
      }
      if (matchedDataSet.has(dataEsperada)) {
        movimentoUpdates.push({ id: a.id, payload: { status: 'unmatched_outra_comp', match_repasse_ids: [] } });
        antecipDiag.push({ data: a.data, valor: Number(a.valor), status: 'unmatched_outra_comp', esperado_soma: exp.soma, diff: 0, razao: 'data ja matched por outra antecipacao' });
        continue;
      }
      const diff = Math.abs(Number(a.valor) - exp.soma);
      let matchType: 'matched' | 'matched_aprox' | null = null;
      if (diff <= REPASSE_TOLERANCE_EXATO) matchType = 'matched';
      else if (diff <= REPASSE_TOLERANCE_APROX) matchType = 'matched_aprox';

      if (!matchType) {
        movimentoUpdates.push({ id: a.id, payload: { status: 'unmatched_outra_comp', match_repasse_ids: [] } });
        antecipDiag.push({ data: a.data, valor: Number(a.valor), status: 'unmatched_outra_comp', esperado_soma: exp.soma, diff: Math.round(diff * 100) / 100, razao: `diff > tolerancia ${REPASSE_TOLERANCE_APROX}` });
        continue;
      }
      antecipDiag.push({ data: a.data, valor: Number(a.valor), status: matchType, esperado_soma: exp.soma, diff: Math.round(diff * 100) / 100, razao: 'ok' });

      matchedDataSet.add(dataEsperada);
      matchedAntecipIds.add(a.id);
      movimentoUpdates.push({
        id: a.id,
        payload: { status: 'matched', match_repasse_ids: exp.ids },
      });

      // Pra cada repasse dessa data: rateia conta_recebido por proporção do subtotal
      for (const repId of exp.ids) {
        const rep = repassesById.get(repId);
        if (!rep) continue;
        const proporcao = exp.soma > 0 ? Number(rep.liquido_esperado) / exp.soma : 0;
        const recebidoLoja = Math.round(Number(a.valor) * proporcao * 100) / 100;
        const diffLoja = Number(rep.liquido_esperado) - recebidoLoja;
        repasseUpdates.push({
          id: repId,
          payload: {
            conta_recebido: recebidoLoja,
            conta_data_recebimento: a.data,
            conta_movimento_id: a.id,
            status: matchType,
            diff: Math.round(diffLoja * 100) / 100,
          },
        });
      }
    }

    // Marca repasses sem antecipação como sem_repasse
    for (const [dataEsp, exp] of expectedByDate) {
      if (matchedDataSet.has(dataEsp)) continue;
      for (const repId of exp.ids) {
        repasseUpdates.push({
          id: repId,
          payload: { status: 'sem_repasse', diff: Number(repassesById.get(repId)?.liquido_esperado ?? 0) },
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Pass 3: Calcula taxa de antecipação por repasse matched
    // Pra cada taxa, busca a antecipação no mesmo dia que tem valor ≈ taxa/0.0199.
    // Se encontrar, propaga rateando entre repasses dessa antecipação.
    // ─────────────────────────────────────────────────────────────────────
    const taxasUsadas = new Set<string>();
    const taxaPorRepasse = new Map<string, number>();
    for (const t of taxas) {
      const subtotalEsperado = Number(t.valor) / ANTECIP_RATE;
      // Procura antecipação MATCHED do mesmo dia com valor próximo. Filtrar
      // por matched é crítico: se a antecipação é de outra competência (ex:
      // jan/26 paga em fev/26 mas não importamos jan), a taxa associada não
      // deve entrar no rateio do mês comp.
      const candidatos = antecipacoes.filter(a =>
        a.data === t.data &&
        matchedAntecipIds.has(a.id) &&
        Math.abs(Number(a.valor) - subtotalEsperado) <= ANTECIP_TOLERANCE * 1.5
      );
      if (candidatos.length === 0) continue;
      // Pega o que tem valor mais próximo
      candidatos.sort((x, y) => Math.abs(Number(x.valor) - subtotalEsperado) - Math.abs(Number(y.valor) - subtotalEsperado));
      const a = candidatos[0];
      if (taxasUsadas.has(t.id)) continue;
      taxasUsadas.add(t.id);

      const dataEsperada = a.data;
      const exp = expectedByDate.get(dataEsperada);
      if (!exp) continue;
      // rateia taxa por proporção do subtotal de cada loja
      for (const repId of exp.ids) {
        const rep = repassesById.get(repId);
        if (!rep) continue;
        const proporcao = exp.soma > 0 ? Number(rep.liquido_esperado) / exp.soma : 0;
        const taxaLoja = Math.round(Number(t.valor) * proporcao * 100) / 100;
        taxaPorRepasse.set(repId, (taxaPorRepasse.get(repId) ?? 0) + taxaLoja);
      }
    }

    // Atualiza repasse com taxa_antecip + liquido_efetivo
    for (const [repId, taxa] of taxaPorRepasse) {
      const existing = repasseUpdates.find(u => u.id === repId);
      const recebido = Number(existing?.payload?.conta_recebido ?? 0);
      const liqEfetivo = Math.round((recebido - taxa) * 100) / 100;
      if (existing) {
        existing.payload.conta_taxa_antecip = taxa;
        existing.payload.liquido_efetivo = liqEfetivo;
      } else {
        repasseUpdates.push({ id: repId, payload: { conta_taxa_antecip: taxa, liquido_efetivo: liqEfetivo } });
      }
    }

    // Persiste updates
    for (const u of repasseUpdates) {
      const { error } = await supabase
        .from('audit_ifood_repasses')
        .update({ ...u.payload, updated_at: new Date().toISOString() })
        .eq('id', u.id);
      if (error) console.error('update repasse', u.id, error);
    }
    for (const u of movimentoUpdates) {
      const { error } = await supabase
        .from('audit_ifood_conta_movimentos')
        .update(u.payload)
        .eq('id', u.id);
      if (error) console.error('update movimento', u.id, error);
    }

    // Resumo
    const finalRepasses = await fetchAllPaginated<any>(
      supabase
        .from('audit_ifood_repasses')
        .select('status, liquido_esperado, conta_recebido, conta_taxa_antecip')
        .eq('audit_period_id', audit_period_id),
    );
    const byStatus: Record<string, number> = {};
    let totalEsperado = 0, totalRecebido = 0, totalTaxa = 0;
    for (const r of finalRepasses ?? []) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      totalEsperado += Number(r.liquido_esperado || 0);
      totalRecebido += Number(r.conta_recebido || 0);
      totalTaxa += Number(r.conta_taxa_antecip || 0);
    }

    return new Response(JSON.stringify({
      success: true,
      edge_version: 'v2.7-2026-05-08-segrega-ajustes',
      crosscheck: {
        ok: crosscheck.ok,
        missing_in_ifood_count: crosscheck.missing_in_ifood.length,
        missing_in_ifood: crosscheck.missing_in_ifood.slice(0, 100),
        missing_in_saipos_count: crosscheck.missing_in_saipos.length,
        missing_in_saipos: crosscheck.missing_in_saipos.slice(0, 100),
        missing_in_saipos_adjustments_count: crosscheck.missing_in_saipos_adjustments.length,
        missing_in_saipos_adjustments: crosscheck.missing_in_saipos_adjustments.slice(0, 100),
        value_mismatch_count: crosscheck.value_mismatch.length,
        value_mismatch: crosscheck.value_mismatch.slice(0, 100),
      },
      repasses: {
        total: finalRepasses?.length ?? 0,
        by_status: byStatus,
        total_liquido_esperado: Math.round(totalEsperado * 100) / 100,
        total_conta_recebido: Math.round(totalRecebido * 100) / 100,
        total_taxa_antecip: Math.round(totalTaxa * 100) / 100,
      },
      antecipacoes_csv: {
        total: antecipacoes.length,
        matched: antecipacoes.length - movimentoUpdates.filter(m => m.payload.status === 'unmatched_outra_comp').length,
        unmatched_outra_comp: movimentoUpdates.filter(m => m.payload.status === 'unmatched_outra_comp').length,
      },
      // Diagnóstico: pra cada antecipação do CSV, o que aconteceu
      antecip_details: antecipDiag,
      // Diagnóstico: pra cada data esperada, soma + status
      esperado_details: Array.from(expectedByDate.entries()).map(([data, e]) => ({
        data,
        esperado_soma: Math.round(e.soma * 100) / 100,
        repasses_count: e.ids.length,
        matched: matchedDataSet.has(data),
      })),
      message: `${crosscheck.ok} cross-check OK · ${finalRepasses?.length} repasses · esperado R$ ${totalEsperado.toFixed(2)} · recebido R$ ${totalRecebido.toFixed(2)} · taxa antecip R$ ${totalTaxa.toFixed(2)}`,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('match-ifood-marketplace error', e);
    return new Response(JSON.stringify({ error: e?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
