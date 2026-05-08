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
  qtd: number;
  vendido: number;
  recebido: number;
  custo: number;
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
  taxa_declarada: number;          // taxa transacional (Pix 0,5% + R$0,40 · Cr.Online 5,69%)
  taxa_pct: number;                // % sobre bruto
  esperado_liquido: number;
  recebido_bb: number;             // recebido real (líquido)
  dias_uteis: number;
  custo_oculto: number;            // mensalidade + diferenças (aprox R$309 fev/26)
  custo_total: number;             // taxa_declarada + custo_oculto
  mensalidade: number;
  mensalidade_count: number;
};

export type ContabilIfood = {
  vendido_bruto: number;            // SOMENTE online (transacionado pelo iFood)
  vendido_online: number;           // alias
  recebido_direto: number;          // pgto direto na loja (informativo, não soma)
  liquido_esperado: number;
  recebido_repasse: number;         // total caído no iFood Pago (antes da antecipação)
  liquido_efetivo: number;          // recebido APÓS taxa antecipação (líquido final)
  repasses_count: number;
  pedidos_count: number;
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
  promocoes_loja: number;
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

function pageTitle(doc: jsPDF, title: string, subtitle: string, periodLabel: string, withCnpj: boolean = false, emittedBy?: string) {
  header(doc, periodLabel);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ORANGE);
  doc.setFontSize(16);
  doc.text(title, 14, 28);

  doc.setTextColor(...BLACK);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(subtitle, 14, 34);

  if (withCnpj && emittedBy) {
    const now = new Date();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('CNPJ: 00.939.190/0001-07', 14, 41);
    doc.text(
      `Emitido em: ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} por ${emittedBy}`,
      14, 46,
    );
    return 52;
  }
  return 40;
}

// ─────────────────────────────────────────────────────────────────────────
// Página 1 — Resumo Consolidado
// ─────────────────────────────────────────────────────────────────────────
function page1Consolidado(doc: jsPDF, data: ContabilPdfData) {
  const startY = pageTitle(doc, 'CONTROLE DE TAXAS', data.periodLabel.toUpperCase(), data.periodLabel, true, data.emittedBy);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...ORANGE);
  doc.text('RESUMO CONSOLIDADO', 14, startY + 4);

  const rows: any[] = [];
  for (const cat of CATEGORIAS_ORDEM) {
    if (cat === 'brendi') {
      if (data.brendi) {
        const b = data.brendi;
        const pct = b.vendido_bruto > 0 ? (b.custo_total / b.vendido_bruto) * 100 : 0;
        rows.push([
          'Brendi (online)',
          String(b.pedidos_count_mes),
          fmtNum(b.vendido_bruto),
          fmtNum(b.recebido_bb),
          fmtNum(b.custo_total),
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
      fmtNum(r.custo),
      fmtPct(pct),
    ]);
  }

  if (data.ifood) {
    const i = data.ifood;
    const pct = i.vendido_bruto > 0 ? (i.custo_total / i.vendido_bruto) * 100 : 0;
    rows.push([
      'iFood Marketplace',
      String(i.pedidos_count),
      fmtNum(i.vendido_bruto),
      fmtNum(i.liquido_efetivo),
      fmtNum(i.custo_total),
      fmtPct(pct),
    ]);
  }

  const baseSum = data.resumoPorCategoria.reduce((acc, r) => ({
    qtd: acc.qtd + r.qtd,
    vendido: acc.vendido + r.vendido,
    recebido: acc.recebido + r.recebido,
    custo: acc.custo + r.custo,
  }), { qtd: 0, vendido: 0, recebido: 0, custo: 0 });
  const brSum = data.brendi ? {
    qtd: data.brendi.pedidos_count_mes,
    vendido: data.brendi.vendido_bruto,
    recebido: data.brendi.recebido_bb,
    custo: data.brendi.custo_total,
  } : { qtd: 0, vendido: 0, recebido: 0, custo: 0 };
  const ifSum = data.ifood ? {
    qtd: data.ifood.pedidos_count,
    vendido: data.ifood.vendido_bruto,
    recebido: data.ifood.liquido_efetivo,
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
    startY: startY + 8,
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
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  const obsLines = doc.splitTextToSize(
    'Vendido = bruto na competência. Recebido = efetivamente creditado em conta (após custos). '
    + 'Custo = total de cobranças (taxa transação, antecipação, comissão, frete, ADS, mensalidade, etc). '
    + 'Páginas seguintes detalham por adquirente: Maquinona, Vouchers, Brendi e iFood Marketplace.',
    doc.internal.pageSize.getWidth() - 28,
  );
  doc.text(obsLines, 14, y);
}

// ─────────────────────────────────────────────────────────────────────────
// Página 2 — Maquinona iFood (Crédito / Débito / Pix)
// ─────────────────────────────────────────────────────────────────────────
function page2Maquinona(doc: jsPDF, data: ContabilPdfData) {
  doc.addPage();
  const startY = pageTitle(doc, 'MAQUINONA iFOOD', 'Crédito · Débito · Pix', data.periodLabel);

  const rows: any[] = [];
  let totalQtd = 0, totalVendido = 0, totalRecebido = 0, totalCusto = 0;
  for (const cat of ['credito', 'debito', 'pix'] as ContabilCategoria[]) {
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r) continue;
    const pct = r.vendido > 0 ? (r.custo / r.vendido) * 100 : 0;
    rows.push([
      CATEGORIA_LABELS[cat],
      String(r.qtd),
      fmtNum(r.vendido),
      fmtNum(r.recebido),
      fmtNum(r.custo),
      fmtPct(pct),
    ]);
    totalQtd += r.qtd; totalVendido += r.vendido; totalRecebido += r.recebido; totalCusto += r.custo;
  }
  const totalPct = totalVendido > 0 ? (totalCusto / totalVendido) * 100 : 0;
  rows.push([
    'TOTAL',
    String(totalQtd),
    fmtNum(totalVendido),
    fmtNum(totalRecebido),
    fmtNum(totalCusto),
    fmtPct(totalPct),
  ]);

  autoTable(doc, {
    startY: startY + 4,
    head: [['Categoria', 'Qtd', 'Vendido', 'Recebido', 'Custo', '%']],
    body: rows,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 3, textColor: BLACK },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 50 },
      1: { halign: 'right', cellWidth: 25 },
      2: { halign: 'right', cellWidth: 35 },
      3: { halign: 'right', cellWidth: 35 },
      4: { halign: 'right', cellWidth: 30 },
      5: { halign: 'right', cellWidth: 22 },
    },
    didParseCell: (h) => {
      if (h.section === 'body' && h.row.index === rows.length - 1) {
        h.cell.styles.fillColor = LIGHT_GRAY;
        h.cell.styles.fontStyle = 'bold';
      }
    },
  });

  let y = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  const obs = doc.splitTextToSize(
    'Custo = vendido (bruto) − recebido (creditado em conta Cresol). Engloba taxa de transação, '
    + 'taxa de antecipação automática, promoções absorvidas pela loja, e custos de conciliação não '
    + 'detalhados pela Maquinona (alocados no Pix por convenção).',
    doc.internal.pageSize.getWidth() - 28,
  );
  doc.text(obs, 14, y);
}

// ─────────────────────────────────────────────────────────────────────────
// Página 3 — Vouchers
// ─────────────────────────────────────────────────────────────────────────
function page3Vouchers(doc: jsPDF, data: ContabilPdfData) {
  doc.addPage();
  const startY = pageTitle(doc, 'VOUCHERS', 'Alelo · Ticket · Vale Refeição · Pluxee', data.periodLabel);

  const rows: any[] = [];
  let totalQtd = 0, totalVendido = 0, totalRecebido = 0, totalCusto = 0;
  for (const cat of ['alelo', 'ticket', 'vr', 'pluxee'] as ContabilCategoria[]) {
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r) continue;
    const pct = r.vendido > 0 ? (r.custo / r.vendido) * 100 : 0;
    rows.push([
      CATEGORIA_LABELS[cat],
      String(r.qtd),
      fmtNum(r.vendido),
      fmtNum(r.recebido),
      fmtNum(r.custo),
      fmtPct(pct),
    ]);
    totalQtd += r.qtd; totalVendido += r.vendido; totalRecebido += r.recebido; totalCusto += r.custo;
  }
  const totalPct = totalVendido > 0 ? (totalCusto / totalVendido) * 100 : 0;
  rows.push([
    'TOTAL',
    String(totalQtd),
    fmtNum(totalVendido),
    fmtNum(totalRecebido),
    fmtNum(totalCusto),
    fmtPct(totalPct),
  ]);

  autoTable(doc, {
    startY: startY + 4,
    head: [['Operadora', 'Qtd Vendas', 'Vendido', 'Recebido', 'Custo', '%']],
    body: rows,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 3, textColor: BLACK },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 50 },
      1: { halign: 'right', cellWidth: 30 },
      2: { halign: 'right', cellWidth: 35 },
      3: { halign: 'right', cellWidth: 35 },
      4: { halign: 'right', cellWidth: 30 },
      5: { halign: 'right', cellWidth: 22 },
    },
    didParseCell: (h) => {
      if (h.section === 'body' && h.row.index === rows.length - 1) {
        h.cell.styles.fillColor = LIGHT_GRAY;
        h.cell.styles.fontStyle = 'bold';
      }
    },
  });

  let y = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  const obs = doc.splitTextToSize(
    'Vendas filtradas pelo mês de competência (data_transacao do voucher cai no mês). '
    + 'Lotes parciais (vendas espalhadas em mais de um mês) usam override manual de taxa quando aplicável.',
    doc.internal.pageSize.getWidth() - 28,
  );
  doc.text(obs, 14, y);
}

// ─────────────────────────────────────────────────────────────────────────
// Página 4 — Brendi (mensalidade vs taxas transacionais)
// ─────────────────────────────────────────────────────────────────────────
function page4Brendi(doc: jsPDF, data: ContabilPdfData) {
  if (!data.brendi) return;
  const b = data.brendi;
  doc.addPage();
  const startY = pageTitle(doc, 'BRENDI', 'Marketplace de pedidos online (PIX direto BB)', data.periodLabel);

  // Quadro 1: KPIs (3 valores principais)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...ORANGE);
  doc.text('VISÃO GERAL', 14, startY + 4);

  const pctTotal = b.vendido_bruto > 0 ? (b.custo_total / b.vendido_bruto) * 100 : 0;
  const kpis: Array<[string, string]> = [
    ['Total Bruto', fmtBRL(b.vendido_bruto)],
    ['Total Líquido (recebido BB)', fmtBRL(b.recebido_bb)],
    ['Custo Total', `${fmtBRL(b.custo_total)} (${fmtPct(pctTotal)})`],
  ];
  autoTable(doc, {
    startY: startY + 8,
    body: kpis,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 11, cellPadding: 3, textColor: BLACK },
    columnStyles: {
      0: { cellWidth: 80, fontStyle: 'bold' },
      1: { halign: 'right' },
    },
  });

  // Quadro 2: breakdown
  let y = (doc as any).lastAutoTable.finalY + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...ORANGE);
  doc.text('DETALHAMENTO DE CUSTOS', 14, y);
  y += 4;

  const breakdownRows: any[] = [
    ['Taxas transacionais (Pix 0,5%+R$0,40 · Crédito Online 5,69%)', fmtBRL(b.taxa_declarada)],
    ['Mensalidade Brendi', fmtBRL(b.custo_oculto)],
    ['TOTAL', fmtBRL(b.custo_total)],
  ];
  autoTable(doc, {
    startY: y,
    head: [['Tipo de cobrança', 'Valor']],
    body: breakdownRows,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 3, textColor: BLACK },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 130 },
      1: { halign: 'right' },
    },
    didParseCell: (h) => {
      if (h.section === 'body' && h.row.index === breakdownRows.length - 1) {
        h.cell.styles.fillColor = LIGHT_GRAY;
        h.cell.styles.fontStyle = 'bold';
      }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  const obs = doc.splitTextToSize(
    `${b.pedidos_count_mes} pedidos no mês · ${b.dias_uteis} dias úteis com depósito BB. `
    + 'Taxas transacionais = soma das taxas declaradas pela Brendi por venda. '
    + 'Mensalidade = diferença entre o esperado (bruto - taxa declarada) e o efetivamente recebido no banco.',
    doc.internal.pageSize.getWidth() - 28,
  );
  doc.text(obs, 14, y);
}

// ─────────────────────────────────────────────────────────────────────────
// Página 5 — iFood Marketplace
// ─────────────────────────────────────────────────────────────────────────
function page5Ifood(doc: jsPDF, data: ContabilPdfData) {
  if (!data.ifood) return;
  const i = data.ifood;
  doc.addPage();
  const startY = pageTitle(doc, 'iFOOD MARKETPLACE', 'Vendas online · Repasses semanais via iFood Pago', data.periodLabel);

  // Quadro 1: KPIs
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...ORANGE);
  doc.text('VISÃO GERAL', 14, startY + 4);

  const kpis: Array<[string, string]> = [
    ['Total Bruto (vendido online)', fmtBRL(i.vendido_bruto)],
    ['Total Líquido (recebido após antecipação)', fmtBRL(i.liquido_efetivo)],
    ['Custo Total', `${fmtBRL(i.custo_total)} (${fmtPct(i.taxa_efetiva_pct)})`],
  ];
  autoTable(doc, {
    startY: startY + 8,
    body: kpis,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 11, cellPadding: 3, textColor: BLACK },
    columnStyles: {
      0: { cellWidth: 110, fontStyle: 'bold' },
      1: { halign: 'right' },
    },
  });

  // Quadro 2: breakdown de custos
  let y = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...ORANGE);
  doc.text('DETALHAMENTO DE CUSTOS', 14, y);
  y += 4;

  const breakdown: Array<[string, string]> = [
    ['Comissão iFood', fmtBRL(Math.abs(i.comissao))],
    ['Taxa de transação', fmtBRL(Math.abs(i.taxa_transacao))],
    ['Taxa de antecipação', fmtBRL(Math.abs(i.taxa_antecipacao))],
    ['Taxa conveniência parcelado', fmtBRL(Math.abs(i.taxa_conveniencia))],
    ['Mensalidade', fmtBRL(Math.abs(i.mensalidade))],
    ['Frete iFood', fmtBRL(Math.abs(i.frete))],
    ['Taxa entrega retenção', fmtBRL(Math.abs(i.taxa_entrega_ret))],
    ['Taxa serviço Sob Demanda Off', fmtBRL(Math.abs(i.taxa_servico_sob_demanda))],
    ['ADS (anúncios)', fmtBRL(Math.abs(i.ads))],
    ['TOTAL', fmtBRL(i.custo_total)],
  ];
  autoTable(doc, {
    startY: y,
    head: [['Tipo de cobrança', 'Valor']],
    body: breakdown,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 3, textColor: BLACK },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
    columnStyles: {
      0: { cellWidth: 130 },
      1: { halign: 'right' },
    },
    didParseCell: (h) => {
      if (h.section === 'body' && h.row.index === breakdown.length - 1) {
        h.cell.styles.fillColor = LIGHT_GRAY;
        h.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // Quadro 3: informativo
  y = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...ORANGE);
  doc.text('INFORMATIVO (não soma no custo)', 14, y);
  y += 3;

  const informativo: Array<[string, string]> = [
    ['Cancelamentos (total)', fmtBRL(Math.abs(i.cancel_total))],
    ['Cancelamentos (parcial)', fmtBRL(Math.abs(i.cancel_parcial))],
    ['Reembolsos pra loja', fmtBRL(i.reembolsos)],
    ['Ressarcimentos', fmtBRL(i.ressarc)],
    ['Promo iFood (devolução)', fmtBRL(i.promo_ifood)],
    ['Taxa serviço cliente (retido pelo iFood)', fmtBRL(Math.abs(i.taxa_servico_cliente))],
    ['Promoções loja (subsídio absorvido — informativo)', fmtBRL(Math.abs(i.promocoes_loja))],
    ['Pgto direto loja (dinheiro/maquinininha — informativo)', fmtBRL(i.recebido_direto)],
  ];
  autoTable(doc, {
    startY: y,
    body: informativo,
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.5, textColor: BLACK },
    columnStyles: {
      0: { cellWidth: 130 },
      1: { halign: 'right' },
    },
  });

  y = (doc as any).lastAutoTable.finalY + 6;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  const obs = doc.splitTextToSize(
    `${i.pedidos_count} pedidos · ${i.repasses_count} repasses (1 PIX por ciclo, soma das lojas). `
    + 'Total Líquido = recebido na conta iFood Pago menos a taxa de antecipação cobrada. '
    + `Diferença entre custo total (${fmtBRL(i.custo_total)}) e (Bruto − Líquido) reflete ajustes positivos do iFood (cancelamentos como estorno, reembolsos, ressarcimentos).`,
    doc.internal.pageSize.getWidth() - 28,
  );
  doc.text(obs, 14, y);
}

// ─────────────────────────────────────────────────────────────────────────
// Daily detalhamento (modo detalhado) — mantém renderização anterior
// ─────────────────────────────────────────────────────────────────────────
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
  const ativas = CATEGORIAS_ORDEM.filter(cat => {
    if (cat === 'brendi') return false;
    const d = detalhe.find(x => x.categoria === cat);
    if (!d) return false;
    return d.dias.some(r => r.qtd > 0 || r.vendido > 0);
  });

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
}

export function generateContabilPdf(
  mode: 'resumido' | 'detalhado',
  data: ContabilPdfData,
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  // Página 1: Resumo Consolidado
  page1Consolidado(doc, data);
  // Página 2: Maquinona iFood
  page2Maquinona(doc, data);
  // Página 3: Vouchers
  page3Vouchers(doc, data);
  // Página 4: Brendi
  page4Brendi(doc, data);
  // Página 5: iFood Marketplace
  page5Ifood(doc, data);

  // Modo detalhado: anexa páginas com detalhamento diário (landscape)
  if (mode === 'detalhado') {
    detalhamentoPages(doc, data);
  }

  footer(doc);

  const fileName = `controle-taxas-${data.periodFileTag}-${mode}.pdf`;
  doc.save(fileName);
}
