// Constrói os dados do relatório contábil e gera o PDF.
// Centraliza toda a lógica de query + agregação + geração do PDF que
// antes vivia no AuditDashboard.handleExportContabil.

import { supabase } from '@/integrations/supabase/client';
import { fetchAllPaginated } from '@/lib/supabase-pagination';
import {
  generateContabilPdf,
  CATEGORIAS_ORDEM,
  CATEGORIA_LABELS,
  type ContabilCategoria,
  type ContabilResumoRow,
  type ContabilDetalhamento,
  type ContabilPdfData,
} from '@/lib/audit-pdf-contabil';
import { periodFileTag, periodLabel as makePeriodLabel } from '@/lib/audit-pdf';

export type GenerateContabilParams = {
  periodId: string;
  month: number;
  year: number;
  emittedBy: string;
  mode: 'resumido' | 'detalhado';
};

/**
 * Constrói os dados consolidados do relatório contábil sem gerar PDF.
 * Usado tanto pra exportar PDF quanto pra renderizar inline na tela.
 */
export async function buildContabilData(params: GenerateContabilParams): Promise<ContabilPdfData> {
  const { periodId, month, year, emittedBy, mode } = params;

  // ─── Maquinona — audit_card_transactions ─────────────────────────────────
  // Custo = gross - net (engloba taxa transação + antecipação + promoção).
  const cardTxs: any[] = await fetchAllPaginated<any>(
    supabase
      .from('audit_card_transactions')
      .select('payment_method, sale_date, gross_amount, net_amount')
      .eq('audit_period_id', periodId),
  );

  // ─── Custo oculto Maquinona ─ audit_daily_matches.difference ────────────
  // run-audit-match grava por sale_date a diff entre líq Maquinona e Cresol.
  // Diff negativa = custo oculto (Cresol pagou MENOS que esperado).
  const periodYM = `${year}-${String(month).padStart(2, '0')}`;
  const monthStart = `${periodYM}-01`;
  const nextMonth = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const dailyMatches: any[] = await fetchAllPaginated<any>(
    (supabase as any)
      .from('audit_daily_matches')
      .select('match_date, difference, status')
      .eq('audit_period_id', periodId)
      .gte('match_date', monthStart)
      .lt('match_date', nextMonth),
  );
  const custoOcultoMaquinona = (dailyMatches ?? [])
    .filter((d: any) => d.status === 'matched' || d.status === 'partial')
    .reduce((s: number, d: any) => s + Number(d.difference ?? 0), 0);

  // ─── Vouchers — audit_voucher_lots + items + overrides ──────────────────
  const voucherLots: any[] = await fetchAllPaginated<any>(
    supabase
      .from('audit_voucher_lots')
      .select('id, operadora, total_descontos, valor_liquido, subtotal_vendas, data_corte')
      .eq('audit_period_id', periodId),
  );
  const voucherLotIds = (voucherLots ?? []).map((l: any) => l.id);
  const voucherItems: any[] = voucherLotIds.length > 0
    ? await fetchAllPaginated<any>(
        (supabase as any)
          .from('audit_voucher_lot_items')
          .select('lot_id, data_transacao, valor')
          .in('lot_id', voucherLotIds),
      )
    : [];
  const voucherOverrides: any[] = voucherLotIds.length > 0
    ? await fetchAllPaginated<any>(
        (supabase as any)
          .from('audit_voucher_lot_competencia_overrides')
          .select('lot_id, year, month, taxa_competencia')
          .eq('year', year)
          .eq('month', month)
          .in('lot_id', voucherLotIds),
      )
    : [];

  const monthDays = new Date(year, month, 0).getDate();
  const competenciaIni = monthStart;
  const competenciaFim = nextMonth;

  const mapMaquinonaCat = (pm: string): ContabilCategoria | null => {
    const u = (pm || '').toUpperCase();
    if (u.includes('CREDIT') || u === 'CREDITO') return 'credito';
    if (u.includes('DEBIT') || u === 'DEBITO') return 'debito';
    if (u === 'PIX') return 'pix';
    return null;
  };
  const mapVoucherCat = (op: string): ContabilCategoria | null => {
    const u = (op || '').toUpperCase();
    if (u.includes('ALELO')) return 'alelo';
    if (u.includes('TICKET')) return 'ticket';
    if (u.includes('VR') || u.includes('VALE')) return 'vr';
    if (u.includes('PLUXEE') || u.includes('SODEX')) return 'pluxee';
    return null;
  };

  type Agg = { qtd: number; vendido: number; recebido: number; custo: number };
  const resumoMap = new Map<ContabilCategoria, Agg>();
  const detMap = new Map<ContabilCategoria, Map<number, Agg>>();
  const ensureAgg = (m: Map<ContabilCategoria, Agg>, k: ContabilCategoria): Agg => {
    if (!m.has(k)) m.set(k, { qtd: 0, vendido: 0, recebido: 0, custo: 0 });
    return m.get(k)!;
  };
  const ensureDayAgg = (cat: ContabilCategoria, dia: number): Agg => {
    if (!detMap.has(cat)) detMap.set(cat, new Map());
    const m = detMap.get(cat)!;
    if (!m.has(dia)) m.set(dia, { qtd: 0, vendido: 0, recebido: 0, custo: 0 });
    return m.get(dia)!;
  };

  // Agrega Maquinona por mês comp via sale_date
  const txMonth = (sd: any): string | null => {
    if (sd == null) return null;
    const s = String(sd);
    const slice = s.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(slice)) return slice;
    const d = new Date(s);
    if (isNaN(d.getTime())) return null;
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  for (const t of (cardTxs ?? []) as any[]) {
    const ym = txMonth(t.sale_date);
    if (ym !== periodYM) continue;
    const cat = mapMaquinonaCat(t.payment_method);
    if (!cat) continue;
    const gross = Number(t.gross_amount ?? 0);
    const net = Number(t.net_amount ?? 0);
    const r = ensureAgg(resumoMap, cat);
    r.qtd += 1;
    r.vendido += gross;
    r.recebido += net;
    r.custo += Math.abs(gross - net);
    if (mode === 'detalhado') {
      const dStr = String(t.sale_date).slice(0, 10).split('-')[2];
      const d = Number(dStr);
      if (d >= 1 && d <= monthDays) {
        const dr = ensureDayAgg(cat, d);
        dr.qtd += 1;
        dr.vendido += gross;
        dr.recebido += net;
        dr.custo += Math.abs(gross - net);
      }
    }
  }

  // Ajuste Cresol → Pix (custo oculto Maquinona vai pro Pix por convenção)
  const ajustePix = -custoOcultoMaquinona;
  if (Math.abs(ajustePix) > 0.01) {
    const pix = ensureAgg(resumoMap, 'pix');
    pix.recebido -= ajustePix;
    pix.custo += ajustePix;

    // Modo detalhado: distribui o ajuste pelos dias proporcionalmente ao vendido
    // de cada dia. Mantém a tabela diária fidedigna ao consolidado e ao extrato
    // bancário Cresol (sem o ajuste, o detalhado mostraria custo Pix < real).
    if (mode === 'detalhado') {
      const pixDays = detMap.get('pix');
      if (pixDays && pix.vendido > 0) {
        for (const dayAgg of pixDays.values()) {
          const proporcao = dayAgg.vendido / pix.vendido;
          const ajusteDia = ajustePix * proporcao;
          dayAgg.recebido -= ajusteDia;
          dayAgg.custo += ajusteDia;
        }
      }
    }
  }

  // Agrega Vouchers (espelha lógica de competência do AuditVouchers)
  const itemsByLot = new Map<string, any[]>();
  for (const it of (voucherItems ?? []) as any[]) {
    const arr = itemsByLot.get(it.lot_id) ?? [];
    arr.push(it);
    itemsByLot.set(it.lot_id, arr);
  }
  const overrideByLot = new Map<string, any>();
  for (const o of (voucherOverrides ?? []) as any[]) overrideByLot.set(o.lot_id, o);

  for (const lot of (voucherLots ?? []) as any[]) {
    const cat = mapVoucherCat(lot.operadora);
    if (!cat) continue;
    const items = itemsByLot.get(lot.id) ?? [];
    let compCount = 0;
    let compValor = 0;
    const compItemDays: number[] = [];
    for (const it of items) {
      if (it.data_transacao >= competenciaIni && it.data_transacao < competenciaFim) {
        compCount += 1;
        compValor += Number(it.valor ?? 0);
        const d = Number(String(it.data_transacao).slice(8, 10));
        if (d >= 1 && d <= monthDays) compItemDays.push(d);
      }
    }
    // Fallback pra lote sem items (caso real fev/26: 21 lotes VR sem items
    // porque user só uploadou reembolsos.xls, não vendas.xls): se data_corte
    // está no mês de competência, trata como lote 100% no mês usando os
    // totais declarados. Sem isso, VR sumia inteiro do relatório.
    const corteNoMes = lot.data_corte != null
      && lot.data_corte >= competenciaIni
      && lot.data_corte < competenciaFim;
    if (items.length === 0) {
      if (!corteNoMes) continue;
    } else if (compCount === 0) {
      continue;
    }
    const isParcial = items.length > 0 && items.length > compCount;
    const lotSubtotalDeclarado = Number(lot.subtotal_vendas ?? 0);
    const lotDescDeclarado = Math.abs(Number(lot.total_descontos ?? 0));
    const lotLiquidoDeclarado = Number(lot.valor_liquido ?? 0);
    let vendidoLote = compValor;     // default: soma items no mês
    let custoLote = 0;
    let recebidoLote = 0;
    if (items.length === 0) {
      // Sem items vinculados (ex: user só uploadou reembolsos.xls): usa os
      // declarados do lote inteiro. Estima qtd como 1 pra não zerar.
      vendidoLote = lotSubtotalDeclarado;
      custoLote = lotDescDeclarado;
      recebidoLote = lotLiquidoDeclarado;
      compCount = 1;
    } else if (!isParcial) {
      // Lote 100% no mês: usa items_sum como vendido (bate com Maquinona/POS).
      // Custo e líquido proporcionalizam pelo gap entre items_sum e subtotal
      // declarado. Caso real fev/26: lote 695394978 declara R$ 552,58 mas
      // só 1 item de R$ 95,81 está em fev (resto = vendas de jan que estão
      // no mesmo ciclo de reembolso). Sem proporção, vendido inflava em
      // R$ 676,77 vs Maquinona.
      vendidoLote = compValor;
      const proporcao = lotSubtotalDeclarado > 0
        ? compValor / lotSubtotalDeclarado
        : 1;
      custoLote = lotDescDeclarado * proporcao;
      recebidoLote = lotLiquidoDeclarado * proporcao;
    } else {
      const ovr = overrideByLot.get(lot.id);
      if (!ovr) continue;
      custoLote = Math.abs(Number(ovr.taxa_competencia ?? 0));
      recebidoLote = compValor - custoLote;
    }
    const r = ensureAgg(resumoMap, cat);
    r.qtd += compCount;
    r.vendido += vendidoLote;
    r.recebido += recebidoLote;
    r.custo += custoLote;

    if (mode === 'detalhado' && compItemDays.length > 0) {
      const custoPorDia = custoLote / compItemDays.length;
      const recebidoPorDia = recebidoLote / compItemDays.length;
      for (const it of items) {
        if (it.data_transacao < competenciaIni || it.data_transacao >= competenciaFim) continue;
        const d = Number(String(it.data_transacao).slice(8, 10));
        if (d < 1 || d > monthDays) continue;
        const dr = ensureDayAgg(cat, d);
        dr.qtd += 1;
        dr.vendido += Number(it.valor ?? 0);
        dr.recebido += recebidoPorDia;
        dr.custo += custoPorDia;
      }
    }
  }

  // Força a equação contábil: custo = vendido - recebido. Garante que
  // sum(vendido) = sum(recebido) + sum(custo) na tabela consolidada.
  // Diferenças vs valor declarado (ex: portal VR declarou R$469 mas banco
  // entregou R$121 a mais) viram parte do custo apurado real.
  const resumoPorCategoria: ContabilResumoRow[] = CATEGORIAS_ORDEM
    .filter(c => c !== 'brendi')
    .map(c => {
      const a = resumoMap.get(c);
      const vendido = a?.vendido ?? 0;
      const recebido = a?.recebido ?? 0;
      return {
        categoria: c, nome: CATEGORIA_LABELS[c],
        qtd: a?.qtd ?? 0, vendido, recebido,
        custo: Math.max(0, vendido - recebido),
      };
    });

  let detalhamentoDiario: ContabilDetalhamento[] | undefined;
  if (mode === 'detalhado') {
    detalhamentoDiario = CATEGORIAS_ORDEM
      .filter(c => c !== 'brendi')
      .map(cat => ({
        categoria: cat,
        dias: Array.from({ length: monthDays }, (_, i) => {
          const d = i + 1;
          const v = detMap.get(cat)?.get(d);
          return { dia: d, qtd: v?.qtd ?? 0, vendido: v?.vendido ?? 0, recebido: v?.recebido ?? 0, custo: v?.custo ?? 0 };
        }),
      }));
  }

  // Brendi + iFood Marketplace
  const sb: any = supabase;
  const [
    { data: brendiDaily },
    { count: brendiCountMes },
    { count: brendiCount3m },
    { data: ifoodRepasses },
    { count: ifoodOrdersCount },
  ] = await Promise.all([
    sb.from('audit_brendi_daily')
      .select('expected_amount, expected_liquido, taxa_calculada, received_amount, diff, status')
      .eq('audit_period_id', periodId),
    sb.from('audit_brendi_orders')
      .select('id', { count: 'exact', head: true })
      .eq('audit_period_id', periodId)
      .gte('sale_date', monthStart)
      .lt('sale_date', nextMonth),
    sb.from('audit_brendi_orders')
      .select('id', { count: 'exact', head: true })
      .eq('audit_period_id', periodId),
    sb.from('audit_ifood_repasses')
      .select('*')
      .eq('audit_period_id', periodId),
    sb.from('audit_ifood_orders')
      .select('id', { count: 'exact', head: true })
      .eq('audit_period_id', periodId)
      .gte('sale_date', monthStart)
      .lt('sale_date', nextMonth)
      .neq('status_pedido', 'CANCELADO'),
  ]);

  // Soma valor_itens + taxa_entrega_cliente paginado pra contornar o limite
  // default 1000 rows do PostgREST. Caso real fev/26: 2.645 pedidos não cabem
  // em 1 página — sem paginação a soma fica truncada (134k em vez de 356k).
  let valorVendasPortal = 0;
  let pageOffset = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data: chunk } = await sb.from('audit_ifood_orders')
      .select('valor_itens, taxa_entrega_cliente')
      .eq('audit_period_id', periodId)
      .gte('sale_date', monthStart)
      .lt('sale_date', nextMonth)
      .neq('status_pedido', 'CANCELADO')
      .range(pageOffset, pageOffset + PAGE_SIZE - 1);
    const rows = (chunk ?? []) as Array<{ valor_itens: number | null; taxa_entrega_cliente: number | null }>;
    for (const r of rows) {
      valorVendasPortal += Number(r.valor_itens ?? 0) + Number(r.taxa_entrega_cliente ?? 0);
    }
    if (rows.length < PAGE_SIZE) break;
    pageOffset += PAGE_SIZE;
  }

  const bd = (brendiDaily ?? []) as any[];
  const sumB = (k: string) => bd.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const brendiVendido = sumB('expected_amount');
  const brendiTaxaDeclarada = sumB('taxa_calculada');
  const brendiEsperado = sumB('expected_liquido');
  const brendiRecebido = sumB('received_amount');
  const brendiCustoOculto = brendiEsperado - brendiRecebido;
  const brendiCustoTotal = brendiVendido - brendiRecebido;
  const brendiData = bd.length > 0 ? {
    vendido_bruto: brendiVendido,
    pedidos_count_mes: brendiCountMes ?? 0,
    pedidos_importados_3meses: brendiCount3m ?? 0,
    taxa_declarada: brendiTaxaDeclarada,
    taxa_pct: brendiVendido > 0 ? (brendiTaxaDeclarada / brendiVendido) * 100 : 0,
    esperado_liquido: brendiEsperado,
    recebido_bb: brendiRecebido,
    dias_uteis: bd.length,
    custo_oculto: brendiCustoOculto,
    custo_total: brendiCustoTotal,
    mensalidade: bd.filter(r => r.status === 'mensalidade_descontada')
      .reduce((s, r) => s + Math.abs(Number(r.diff ?? 0)), 0),
    mensalidade_count: bd.filter(r => r.status === 'mensalidade_descontada').length,
  } : undefined;

  const ifoodRows = (ifoodRepasses ?? []) as any[];
  const sumI = (k: string) => ifoodRows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const brutoVenda = sumI('bruto_venda');
  const pgtoDireto = sumI('pgto_direto_loja');
  const comissao = Math.abs(sumI('comissao'));
  const taxaTrans = Math.abs(sumI('taxa_transacao'));
  const taxaAntecip = Math.abs(sumI('conta_taxa_antecip'));
  const taxaConv = Math.abs(sumI('taxa_conveniencia'));
  const mens = Math.abs(sumI('mensalidade'));
  const frete = Math.abs(sumI('frete_ifood'));
  const taxaEntrega = Math.abs(sumI('taxa_entrega_ret'));
  const taxaSob = Math.abs(sumI('taxa_servico_sob_demanda'));
  const ads = Math.abs(sumI('ads'));
  const freteGarantido = Math.abs(sumI('frete_garantido'));
  const outrosAvulsos = Math.abs(sumI('outros_avulsos'));
  const custoTotal = comissao + taxaTrans + taxaAntecip + taxaConv + mens
    + frete + taxaEntrega + taxaSob + freteGarantido + ads + outrosAvulsos;
  const liquidoEfetivoTotal = ifoodRows.reduce(
    (s, r) => s + Number(r.liquido_efetivo ?? r.conta_recebido ?? 0),
    0,
  );
  // Custo real iFood = vendido (online) - liquido efetivo (após antecipação).
  // Garante que tabela consolidada feche matematicamente. Esse valor reflete
  // o que efetivamente saiu da loja: taxas brutas (custoTotal) menos ajustes
  // positivos (reembolsos/ressarc/promo iFood) mais taxa antecipação.
  const custoRealIfood = Math.max(0, brutoVenda - liquidoEfetivoTotal);
  const ifoodData = ifoodRows.length > 0 ? {
    vendido_bruto: brutoVenda,
    vendido_online: brutoVenda,
    valor_vendas_portal: valorVendasPortal,
    recebido_direto: pgtoDireto,
    liquido_esperado: sumI('liquido_esperado'),
    recebido_repasse: sumI('conta_recebido'),
    liquido_efetivo: liquidoEfetivoTotal,
    repasses_count: ifoodRows.length,
    pedidos_count: ifoodOrdersCount ?? 0,
    custo_total: custoRealIfood,
    // Taxa efetiva = custo real / faturamento total iFood (online + direto loja).
    taxa_efetiva_pct: (brutoVenda + pgtoDireto) > 0
      ? (custoRealIfood / (brutoVenda + pgtoDireto)) * 100
      : 0,
    comissao,
    taxa_transacao: taxaTrans,
    taxa_antecipacao: taxaAntecip,
    taxa_conveniencia: taxaConv,
    mensalidade: mens,
    frete,
    taxa_entrega_ret: taxaEntrega,
    taxa_servico_sob_demanda: taxaSob,
    frete_garantido: freteGarantido,
    ads,
    outros_avulsos: outrosAvulsos,
    promocoes_loja: Math.abs(sumI('promo_loja')),
    cancel_total: Math.abs(sumI('cancel_total')),
    cancel_parcial: Math.abs(sumI('cancel_parcial')),
    reembolsos: sumI('reembolsos'),
    ressarc: sumI('ressarc'),
    promo_ifood: sumI('promo_ifood'),
    taxa_servico_cliente: Math.abs(sumI('taxa_servico_cliente')),
  } : undefined;

  return {
    periodLabel: makePeriodLabel(month, year),
    periodFileTag: periodFileTag(month, year),
    monthDays,
    emittedBy,
    resumoPorCategoria,
    detalhamentoDiario,
    brendi: brendiData,
    ifood: ifoodData,
  };
}

/**
 * Carrega os dados e dispara o download do PDF contábil.
 */
export async function generateContabilReport(params: GenerateContabilParams): Promise<void> {
  const data = await buildContabilData(params);
  generateContabilPdf(params.mode, data);
}
