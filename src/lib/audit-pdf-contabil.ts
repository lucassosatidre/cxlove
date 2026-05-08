import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const ORANGE: [number, number, number] = [249, 115, 22];
const BLACK: [number, number, number] = [26, 26, 26];
const GRAY: [number, number, number] = [120, 120, 120];
const LIGHT_GRAY: [number, number, number] = [240, 240, 240];

export type ContabilCategoria =
  | 'credito' | 'debito' | 'pix' | 'brendi'
  | 'alelo' | 'ticket' | 'vr' | 'pluxee';

export const CATEGORIAS_ORDEM: ContabilCategoria[] = [
  'credito', 'debito', 'pix', 'brendi', 'alelo', 'ticket', 'vr', 'pluxee',
];

export const CATEGORIA_LABELS: Record<ContabilCategoria, string> = {
  credito: 'Crédito',
  debito: 'Débito',
  pix: 'Pix',
  brendi: 'Brendi (marketplace)',
  alelo: 'Alelo',
  ticket: 'Ticket',
  vr: 'Vale Refeição',
  pluxee: 'Pluxee',
};

export type ContabilResumoRow = {
  categoria: ContabilCategoria;
  nome: string;
  qtd: number;          // Maquinona: nº txs · Vouchers: nº vendas · Brendi: pedidos
  vendido: number;      // bruto vendido na competência
  recebido: number;     // efetivamente creditado
  custo: number;        // vendido - recebido (engloba taxa + antecip + promo + desconto oculto)
};

export type ContabilDiaRow = {
  dia: number;
  qtd: number;
  vendido: number;
  recebido: number;
  custo: number;
};

export type ContabilDetalhamento = {
  categoria: ContabilCategoria;
  dias: ContabilDiaRow[];
};

export type ContabilBrendi = {
  vendido_bruto: number;
  pedidos_count_mes: number;
  pedidos_importados_3meses: number;
  taxa_declarada: number;          // valor R$ (taxa Brendi)
  taxa_pct: number;                // % sobre bruto
  esperado_liquido: number;
  recebido_bb: number;             // efetivamente caiu no banco
  dias_uteis: number;
  custo_oculto: number;            // diferença entre esperado e recebido (faltou/sobrou)
  custo_total: number;             // taxa_declarada + custo_oculto (consolidado)
  mensalidade: number;
  mensalidade_count: number;
};

export type ContabilIfood = {
  // Header
  vendido_bruto: number;            // SOMENTE online (transacionado pelo iFood) — sem pgto direto loja
  vendido_online: number;           // alias de vendido_bruto
  recebido_direto: number;          // dinheiro/maquinininha recebido em mãos (informativo)
  liquido_esperado: number;
  recebido_repasse: number;
  repasses_count: number;
  pedidos_count: number;            // qtd de pedidos iFood concluídos no mês
  custo_total: number;
  taxa_efetiva_pct: number;
  // Taxas
  comissao: number;
  taxa_transacao: number;
  taxa_antecipacao: number;
  taxa_conveniencia: number;
  mensalidade: number;
  // Logística
  frete: number;
  taxa_entrega_ret: number;
  taxa_servico_sob_demanda: number;
  // Marketing
  ads: number;
  promocoes_loja: number;           // informativo
  // Informativo
  cancel_total: number;
  cancel_parcial: number;
  reembolsos: number;
  ressarc: number;
  promo_ifood: number;
  taxa_servico_cliente: number;
};

export type ContabilPdfData = {
  periodLabel: string;
  periodFileTag: string;
  monthDays: number;
  emittedBy: string;
  resumoPorCategoria: ContabilResumoRow[];
  detalhamentoDiario?: ContabilDetalhamento[];
  brendi?: ContabilBrendi;
  ifood?: ContabilIfood;
};

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number, decimals = 2) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const fmtPct = (v: number) => `${fmtNum(v)}%`;

function header(doc: jsPDF, periodLabel: string) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ORANGE);
  doc.setFontSize(10);
  doc.text('PIZZARIA ESTRELA DA ILHA', 14, 12);
  doc.setTextColor(...BLACK);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Controle de Taxas — ${periodLabel}`, pageW - 14, 12, { align: 'right' });
  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.4);
  doc.line(14, 15, pageW - 14, 15);
}

function footer(doc: jsPDF) {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(220);
    doc.line(14, pageH - 14, pageW - 14, pageH - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text('Pizzaria Estrela da Ilha — Relatório Contábil gerado automaticamente.', 14, pageH - 9);
    doc.text(`Pág ${i} de ${total}`, pageW - 14, pageH - 9, { align: 'right' });
  }
}

function coverPage(doc: jsPDF, data: ContabilPdfData) {
  header(doc, data.periodLabel);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ORANGE);
  doc.setFontSize(18);
  doc.text('CONTROLE DE TAXAS', 14, 28);

  doc.setTextColor(...BLACK);
  doc.setFontSize(12);
  doc.text(data.periodLabel.toUpperCase(), 14, 35);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const now = new Date();
  doc.text('CNPJ: 00.939.190/0001-07', 14, 41);
  doc.text(
    `Emitido em: ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} por ${data.emittedBy}`,
    14, 46,
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...ORANGE);
  doc.text('RESUMO CONSOLIDADO', 14, 56);

  // Build resumo body — Brendi e iFood preenchidos com dados reais
  // Nova estrutura: Categoria | Qtd | Vendido | Recebido | Custo | %
  // - Vendido = bruto vendido na competência
  // - Recebido = efetivamente creditado (line-of-truth: extrato/banco)
  // - Custo = vendido - recebido (engloba taxa de transação + antecipação + promo + desconto oculto)
  const rows: any[] = [];
  for (const cat of CATEGORIAS_ORDEM) {
    if (cat === 'brendi') {
      // Linha Brendi puxa do data.brendi (custo = declarado + oculto consolidado)
      if (data.brendi) {
        const b = data.brendi;
        const pct = b.vendido_bruto > 0 ? (b.custo_total / b.vendido_bruto) * 100 : 0;
        rows.push([
          'Brendi (online)',
          String(b.pedidos_count_mes),
          fmtNum(b.vendido_bruto),
          fmtNum(b.recebido_bb),
          fmtNum(Math.abs(b.custo_total)),
          fmtPct(pct),
        ]);
      } else {
        rows.push(['Brendi (online)', '0', '0,00', '0,00', '0,00', '0,00%']);
      }
      continue;
    }
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r) {
      rows.push([CATEGORIA_LABELS[cat], '0', '0,00', '0,00', '0,00', '0,00%']);
      continue;
    }
    const pct = r.vendido > 0 ? (r.custo / r.vendido) * 100 : 0;
    rows.push([
      CATEGORIA_LABELS[cat],
      String(r.qtd),
      fmtNum(r.vendido),
      fmtNum(r.recebido),
      fmtNum(Math.abs(r.custo)),
      fmtPct(pct),
    ]);
  }

  // Adiciona linha iFood Marketplace (recebido = vendido - custo, todo dinheiro repassado online)
  if (data.ifood) {
    const i = data.ifood;
    const recebidoIfood = i.vendido_bruto - i.custo_total;
    const pct = i.vendido_bruto > 0 ? (i.custo_total / i.vendido_bruto) * 100 : 0;
    rows.push([
      'iFood Marketplace',
      String(i.pedidos_count),
      fmtNum(i.vendido_bruto),
      fmtNum(recebidoIfood),
      fmtNum(i.custo_total),
      fmtPct(pct),
    ]);
  }

  const baseSum = data.resumoPorCategoria.reduce((acc, r) => ({
    qtd: acc.qtd + r.qtd,
    vendido: acc.vendido + r.vendido,
    recebido: acc.recebido + r.recebido,
    custo: acc.custo + Math.abs(r.custo),
  }), { qtd: 0, vendido: 0, recebido: 0, custo: 0 });
  const brSum = data.brendi ? {
    qtd: data.brendi.pedidos_count_mes,
    vendido: data.brendi.vendido_bruto,
    recebido: data.brendi.recebido_bb,
    custo: Math.abs(data.brendi.custo_total),
  } : { qtd: 0, vendido: 0, recebido: 0, custo: 0 };
  const ifSum = data.ifood ? {
    qtd: data.ifood.pedidos_count,
    vendido: data.ifood.vendido_bruto,
    recebido: data.ifood.vendido_bruto - data.ifood.custo_total,
    custo: data.ifood.custo_total,
  } : { qtd: 0, vendido: 0, recebido: 0, custo: 0 };
  const totQtd = baseSum.qtd + brSum.qtd + ifSum.qtd;
  const totVendido = baseSum.vendido + brSum.vendido + ifSum.vendido;
  const totRecebido = baseSum.recebido + brSum.recebido + ifSum.recebido;
  const totCusto = baseSum.custo + brSum.custo + ifSum.custo;
  const totPct = totVendido > 0 ? (totCusto / totVendido) * 100 : 0;

  rows.push([
    'TOTAL',
    String(totQtd),
    fmtNum(totVendido),
    fmtNum(totRecebido),
    fmtNum(totCusto),
    fmtPct(totPct),
  ]);

  autoTable(doc, {
    startY: 60,
    head: [['Categoria', 'Qtd', 'Vendido', 'Recebido', 'Custo', '%']],
    body: rows,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5, textColor: BLACK },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 50 },
      1: { halign: 'right', cellWidth: 22 },
      2: { halign: 'right', cellWidth: 32 },
      3: { halign: 'right', cellWidth: 32 },
      4: { halign: 'right', cellWidth: 28 },
      5: { halign: 'right', cellWidth: 22 },
    },
    didParseCell: (h) => {
      if (h.section === 'body' && h.row.index === rows.length - 1) {
        h.cell.styles.fillColor = LIGHT_GRAY;
        h.cell.styles.fontStyle = 'bold';
      }
    },
  });

  let y = (doc as any).lastAutoTable.finalY + 10;

  // Resumo de taxas
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...ORANGE);
  doc.text('RESUMO DE TAXAS', 14, y);
  y += 5;

  const taxaCredito = data.resumoPorCategoria.find(r => r.categoria === 'credito')?.custo ?? 0;
  const taxaDebito = data.resumoPorCategoria.find(r => r.categoria === 'debito')?.custo ?? 0;
  const taxaPix = data.resumoPorCategoria.find(r => r.categoria === 'pix')?.custo ?? 0;
  const taxaAlelo = data.resumoPorCategoria.find(r => r.categoria === 'alelo')?.custo ?? 0;
  const taxaTicket = data.resumoPorCategoria.find(r => r.categoria === 'ticket')?.custo ?? 0;
  const taxaVR = data.resumoPorCategoria.find(r => r.categoria === 'vr')?.custo ?? 0;
  const taxaPluxee = data.resumoPorCategoria.find(r => r.categoria === 'pluxee')?.custo ?? 0;
  const taxaVoucher = taxaAlelo + taxaTicket + taxaVR + taxaPluxee;

  // iFood Marketplace breakdown
  const ifd = data.ifood;
  const taxaComissaoIfood = ifd ? Math.abs(ifd.comissao) : 0;
  const taxaTransacaoIfood = ifd ? Math.abs(ifd.taxa_transacao) : 0;
  const taxaAntecipIfood = ifd ? Math.abs(ifd.taxa_antecipacao) : 0;
  const taxaConvenienciaIfood = ifd ? Math.abs(ifd.taxa_conveniencia) : 0;
  const mensalidadeIfood = ifd ? Math.abs(ifd.mensalidade) : 0;
  const freteIfood = ifd ? Math.abs(ifd.frete) : 0;
  const taxaEntregaIfood = ifd ? Math.abs(ifd.taxa_entrega_ret) : 0;
  const taxaSobDemanda = ifd ? Math.abs(ifd.taxa_servico_sob_demanda) : 0;
  const adsIfood = ifd ? Math.abs(ifd.ads) : 0;
  const totalIfood = ifd ? Math.abs(ifd.custo_total) : 0;

  // Brendi: custo total = declarada + oculto (já consolidado em ContabilBrendi.custo_total)
  const taxaBrendi = data.brendi ? Math.abs(data.brendi.taxa_declarada) : 0;
  const custoOcultoBrendi = data.brendi ? Math.abs(data.brendi.custo_oculto) : 0;
  const custoBrendiTotal = data.brendi ? Math.abs(data.brendi.custo_total) : (taxaBrendi + custoOcultoBrendi);

  const totalApurado = Math.abs(taxaCredito) + Math.abs(taxaDebito) + Math.abs(taxaPix)
    + Math.abs(taxaVoucher) + totalIfood + custoBrendiTotal;

  const taxaRows: Array<[string, string]> = [
    ['— Maquinona (iFood) —', ''],
    ['Custo Crédito (taxa + antecip + outros embutidos)', fmtBRL(Math.abs(taxaCredito))],
    ['Custo Débito (taxa + antecip + outros embutidos)', fmtBRL(Math.abs(taxaDebito))],
    ['Custo Pix (Maquinona)', fmtBRL(Math.abs(taxaPix))],
    ['— Vouchers —', ''],
    ['Alelo', fmtBRL(Math.abs(taxaAlelo))],
    ['Ticket', fmtBRL(Math.abs(taxaTicket))],
    ['Vale Refeição (VR)', fmtBRL(Math.abs(taxaVR))],
    ['Pluxee', fmtBRL(Math.abs(taxaPluxee))],
    ['— iFood Marketplace —', ''],
    ['Comissão iFood', fmtBRL(taxaComissaoIfood)],
    ['Taxa de transação iFood', fmtBRL(taxaTransacaoIfood)],
    ['Taxa de antecipação iFood', fmtBRL(taxaAntecipIfood)],
    ['Taxa conveniência parcelado iFood', fmtBRL(taxaConvenienciaIfood)],
    ['Mensalidade iFood', fmtBRL(mensalidadeIfood)],
    ['Frete iFood', fmtBRL(freteIfood)],
    ['Taxa entrega retenção iFood', fmtBRL(taxaEntregaIfood)],
    ['Taxa serviço Sob Demanda Off iFood', fmtBRL(taxaSobDemanda)],
    ['ADS iFood (anúncios)', fmtBRL(adsIfood)],
    ['— Brendi —', ''],
    ['Taxa Brendi (declarada)', fmtBRL(taxaBrendi)],
    ['Custo oculto Brendi', fmtBRL(custoOcultoBrendi)],
    ['Subtotal Brendi (declarada + oculto)', fmtBRL(custoBrendiTotal)],
  ];

  autoTable(doc, {
    startY: y,
    body: taxaRows,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 1.8, textColor: BLACK },
    columnStyles: {
      0: { cellWidth: 90 },
      1: { halign: 'right' },
    },
  });

  y = (doc as any).lastAutoTable.finalY + 2;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.3);
  doc.line(14, y, 14 + 130, y);
  y += 5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...BLACK);
  doc.text('TOTAL DE CUSTOS APURADOS', 14, y);
  doc.text(fmtBRL(totalApurado), 14 + 130, y, { align: 'right' });

  y += 9;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  const obsLines = doc.splitTextToSize(
    'Vendido = bruto vendido na competência (mês). Recebido = efetivamente creditado em conta. Custo = Vendido − Recebido (engloba taxa de transação, antecipação, promoções absorvidas, custos embutidos). Cobertura: Maquinona (Crédito/Débito/Pix), Vouchers (Alelo/Ticket/VR/Pluxee, lotes filtrados pelo mês de competência), iFood Marketplace (comissão + transação + antecipação + frete + ADS + mensalidade + ajustes), Brendi (taxa declarada + custo oculto). Pgto direto loja iFood (dinheiro/Pix/maquinininha) não soma — já contabilizado em outras categorias.',
    doc.internal.pageSize.getWidth() - 28,
  );
  doc.text(obsLines, 14, y);
}

function buildCategoriaTable(
  doc: jsPDF,
  categoria: ContabilCategoria,
  dias: ContabilDiaRow[],
  monthDays: number,
  startX: number,
  startY: number,
  width: number,
) {
  const byDay = new Map(dias.map(d => [d.dia, d]));
  const body: any[] = [];
  let totQtd = 0, totVendido = 0, totRecebido = 0, totCusto = 0;

  for (let d = 1; d <= monthDays; d++) {
    const row = byDay.get(d);
    const qtd = row?.qtd ?? 0;
    const vendido = row?.vendido ?? 0;
    const recebido = row?.recebido ?? 0;
    const custo = Math.abs(row?.custo ?? 0);
    totQtd += qtd; totVendido += vendido; totRecebido += recebido; totCusto += custo;
    body.push([String(d), String(qtd), fmtNum(vendido), fmtNum(custo)]);
  }
  body.push(['TOTAL', String(totQtd), fmtNum(totVendido), fmtNum(totCusto)]);

  // Title above table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...ORANGE);
  doc.text(CATEGORIA_LABELS[categoria].toUpperCase(), startX, startY - 2);

  autoTable(doc, {
    startY,
    margin: { left: startX, right: doc.internal.pageSize.getWidth() - startX - width },
    tableWidth: width,
    head: [['Dia', 'Qtd', 'Vendido', 'Custo']],
    body,
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.4, textColor: BLACK },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { halign: 'right', cellWidth: 14 },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
    didParseCell: (h) => {
      if (h.section === 'body' && h.row.index === body.length - 1) {
        h.cell.styles.fillColor = LIGHT_GRAY;
        h.cell.styles.fontStyle = 'bold';
      }
    },
  });
}

function detalhamentoPages(doc: jsPDF, data: ContabilPdfData) {
  const detalhe = data.detalhamentoDiario ?? [];

  // Filter: only categorias with any movement; brendi handled separately
  const ativas = CATEGORIAS_ORDEM.filter(cat => {
    if (cat === 'brendi') return false;
    const d = detalhe.find(x => x.categoria === cat);
    if (!d) return false;
    return d.dias.some(r => r.qtd > 0 || r.bruto > 0);
  });

  // Render in pairs (landscape, two side-by-side)
  for (let i = 0; i < ativas.length; i += 2) {
    doc.addPage('a4', 'landscape');
    header(doc, data.periodLabel);

    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    const gap = 10;
    const colWidth = (pageW - margin * 2 - gap) / 2;

    const cat1 = ativas[i];
    const cat2 = ativas[i + 1];

    const dias1 = detalhe.find(x => x.categoria === cat1)?.dias ?? [];
    buildCategoriaTable(doc, cat1, dias1, data.monthDays, margin, 28, colWidth);

    if (cat2) {
      const dias2 = detalhe.find(x => x.categoria === cat2)?.dias ?? [];
      buildCategoriaTable(doc, cat2, dias2, data.monthDays, margin + colWidth + gap, 28, colWidth);
    }
  }

  // Brendi page (real data)
  if (data.brendi) renderBrendiPage(doc, data);

  // iFood Marketplace page (real data)
  if (data.ifood) renderIfoodPage(doc, data);
}

function renderBrendiPage(doc: jsPDF, data: ContabilPdfData) {
  const b = data.brendi!;
  doc.addPage('a4', 'portrait');
  header(doc, data.periodLabel);
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...ORANGE);
  doc.text('BRENDI (vendas online)', 14, 28);

  // KPIs
  const kpis: Array<[string, string, string]> = [
    ['Vendido bruto (Brendi online)', fmtBRL(b.vendido_bruto),
      `${b.pedidos_count_mes} pedidos no mês · ${b.pedidos_importados_3meses} importados (3 meses)`],
    ['Taxa declarada Brendi', `${fmtNum(b.taxa_pct)}%`,
      `${fmtBRL(b.taxa_declarada)} (Pix 0,5% + R$0,40 · Cr.Online 5,69%)`],
    ['Esperado líquido', fmtBRL(b.esperado_liquido),
      `Recebido BB: ${fmtBRL(b.recebido_bb)} (${b.dias_uteis} dias úteis)`],
    ['Custo oculto', fmtBRL(Math.abs(b.custo_oculto)),
      `${b.custo_oculto > 0 ? 'Faltou' : 'Sobrou'} vs esperado · Mensalidade: ${fmtBRL(b.mensalidade)} (${b.mensalidade_count}x)`],
  ];

  let y = 38;
  for (const [title, value, hint] of kpis) {
    doc.setDrawColor(220);
    doc.setLineWidth(0.2);
    doc.roundedRect(14, y, pageW - 28, 18, 1.5, 1.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(title.toUpperCase(), 18, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...BLACK);
    doc.text(value, 18, y + 12);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(hint, 18, y + 16);
    y += 22;
  }
}

function renderIfoodPage(doc: jsPDF, data: ContabilPdfData) {
  const i = data.ifood!;
  doc.addPage('a4', 'portrait');
  header(doc, data.periodLabel);
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...ORANGE);
  doc.text('iFOOD MARKETPLACE', 14, 28);

  // KPI superiores (4 cards em grid)
  const recebidoIfood = i.vendido_bruto - i.custo_total;
  const kpiData: Array<[string, string, string]> = [
    ['Vendido pelo iFood (online)', fmtBRL(i.vendido_bruto),
      `${i.pedidos_count} pedidos no mês · transacionado pela plataforma`],
    ['Recebido (vendido − custo)', fmtBRL(recebidoIfood),
      `${i.repasses_count} repasses · efetivo em conta ${fmtBRL(i.recebido_repasse)}`],
    ['Custo total iFood', fmtBRL(i.custo_total),
      `Taxa efetiva: ${fmtNum(i.taxa_efetiva_pct)}% sobre o vendido`],
    ['Pgto direto loja (informativo)', fmtBRL(i.recebido_direto),
      'Dinheiro/Pix/Maquinininha — não passa pelo iFood Pago'],
  ];

  let y = 32;
  const colW = (pageW - 28 - 4) / 2;
  for (let k = 0; k < kpiData.length; k++) {
    const col = k % 2;
    const row = Math.floor(k / 2);
    const x = 14 + col * (colW + 4);
    const yy = y + row * 22;
    const [title, value, hint] = kpiData[k];
    doc.setDrawColor(220);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, yy, colW, 19, 1.5, 1.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(title.toUpperCase(), x + 3, yy + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...BLACK);
    doc.text(value, x + 3, yy + 11);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    const hintLines = doc.splitTextToSize(hint, colW - 6);
    doc.text(hintLines, x + 3, yy + 16);
  }
  y += 48;

  // Detalhamento Taxas / Logística / Marketing (3 grupos)
  const taxasRows: Array<[string, string]> = [
    ['Comissão iFood', fmtBRL(Math.abs(i.comissao))],
    ['Taxa de transação', fmtBRL(Math.abs(i.taxa_transacao))],
    ['Taxa de antecipação', fmtBRL(Math.abs(i.taxa_antecipacao))],
    ['Taxa conveniência parcelado', fmtBRL(Math.abs(i.taxa_conveniencia))],
    ['Mensalidade', fmtBRL(Math.abs(i.mensalidade))],
  ];
  const subtotalTaxas = Math.abs(i.comissao) + Math.abs(i.taxa_transacao)
    + Math.abs(i.taxa_antecipacao) + Math.abs(i.taxa_conveniencia) + Math.abs(i.mensalidade);

  const logisticaRows: Array<[string, string]> = [
    ['Frete iFood', fmtBRL(Math.abs(i.frete))],
    ['Taxa entrega retenção', fmtBRL(Math.abs(i.taxa_entrega_ret))],
    ['Taxa serviço Sob Demanda Off', fmtBRL(Math.abs(i.taxa_servico_sob_demanda))],
  ];
  const subtotalLogistica = Math.abs(i.frete) + Math.abs(i.taxa_entrega_ret) + Math.abs(i.taxa_servico_sob_demanda);

  const marketingRows: Array<[string, string]> = [
    ['ADS (anúncios)', fmtBRL(Math.abs(i.ads))],
    ['Promoções loja (informativo, não soma)', fmtBRL(Math.abs(i.promocoes_loja))],
  ];
  const subtotalMarketing = Math.abs(i.ads);

  const informativoRows: Array<[string, string]> = [
    ['Cancelamentos (total)', fmtBRL(Math.abs(i.cancel_total))],
    ['Cancelamentos (parcial)', fmtBRL(Math.abs(i.cancel_parcial))],
    ['Reembolsos pra loja', fmtBRL(i.reembolsos)],
    ['Ressarcimentos', fmtBRL(i.ressarc)],
    ['Promo iFood (devolução)', fmtBRL(i.promo_ifood)],
    ['Taxa serviço cliente (retido pelo iFood)', fmtBRL(Math.abs(i.taxa_servico_cliente))],
  ];

  // Renderiza 4 boxes
  const renderBox = (title: string, rows: Array<[string, string]>, subtotal: number | null, yStart: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...ORANGE);
    doc.text(title.toUpperCase(), 14, yStart);
    autoTable(doc, {
      startY: yStart + 2,
      body: subtotal != null
        ? [...rows, ['SUBTOTAL', fmtBRL(subtotal)]]
        : rows,
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.5, textColor: BLACK },
      columnStyles: {
        0: { cellWidth: 110 },
        1: { halign: 'right' },
      },
      didParseCell: (h) => {
        if (subtotal != null && h.section === 'body' && h.row.index === rows.length) {
          h.cell.styles.fillColor = LIGHT_GRAY;
          h.cell.styles.fontStyle = 'bold';
        }
      },
    });
    return (doc as any).lastAutoTable.finalY + 4;
  };

  y = renderBox('Taxas', taxasRows, subtotalTaxas, y);
  y = renderBox('Logística', logisticaRows, subtotalLogistica, y);
  y = renderBox('Marketing', marketingRows, subtotalMarketing, y);
  y = renderBox('Informativo (não soma no custo)', informativoRows, null, y);
}

export function generateContabilPdf(
  mode: 'resumido' | 'detalhado',
  data: ContabilPdfData,
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  coverPage(doc, data);

  if (mode === 'detalhado') {
    detalhamentoPages(doc, data);
  }

  footer(doc);

  const fileName = `controle-taxas-${data.periodFileTag}-${mode}.pdf`;
  doc.save(fileName);
}
