import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ═══ Paleta corporativa ════════════════════════════════════════════════════
const PRIMARY: [number, number, number] = [234, 88, 12];           // laranja queimado (mais corporativo que F97316)
const PRIMARY_DARK: [number, number, number] = [194, 65, 12];      // laranja escuro pra acentos
const INK: [number, number, number] = [17, 24, 39];                // cinza-azulado quase preto (texto principal)
const INK_SECONDARY: [number, number, number] = [75, 85, 99];      // cinza médio (subtítulos)
const INK_MUTED: [number, number, number] = [156, 163, 175];       // cinza claro (legendas, hint)
const RULE: [number, number, number] = [229, 231, 235];            // linha divisória sutil
const RULE_DARK: [number, number, number] = [55, 65, 81];          // linha divisória forte
const SUBTLE_BG: [number, number, number] = [249, 250, 251];       // fundo sutil pra zebra
const TOTAL_BG: [number, number, number] = [243, 244, 246];        // fundo da linha TOTAL
const POSITIVE: [number, number, number] = [5, 150, 105];          // verde
const NEGATIVE: [number, number, number] = [220, 38, 38];          // vermelho
const WHITE: [number, number, number] = [255, 255, 255];

// Tipografia
const FONT = 'helvetica';

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
  taxa_declarada: number;
  taxa_pct: number;
  esperado_liquido: number;
  recebido_bb: number;
  dias_uteis: number;
  custo_oculto: number;
  custo_total: number;
  mensalidade: number;
  mensalidade_count: number;
};

export type ContabilIfood = {
  vendido_bruto: number;
  vendido_online: number;
  recebido_direto: number;
  liquido_esperado: number;
  recebido_repasse: number;
  liquido_efetivo: number;
  repasses_count: number;
  pedidos_count: number;
  custo_total: number;
  taxa_efetiva_pct: number;
  comissao: number;
  taxa_transacao: number;
  taxa_antecipacao: number;
  taxa_conveniencia: number;
  mensalidade: number;
  frete: number;
  taxa_entrega_ret: number;
  taxa_servico_sob_demanda: number;
  ads: number;
  promocoes_loja: number;
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

// ═══ Helpers ═══════════════════════════════════════════════════════════════
const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number, decimals = 2) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const fmtPct = (v: number) => `${fmtNum(v)}%`;
const fmtInt = (v: number) => v.toLocaleString('pt-BR');

const PAGE_MARGIN = 18;

// ═══ Header / Footer corporativo ═══════════════════════════════════════════
function pageHeader(doc: jsPDF, sectionLabel: string, pageNumber: number) {
  const pageW = doc.internal.pageSize.getWidth();
  // Faixa fina laranja no topo
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, pageW, 2.5, 'F');

  // Cabeçalho com nome empresa à esquerda, seção centralizada, número direita
  doc.setFont(FONT, 'bold');
  doc.setTextColor(...INK);
  doc.setFontSize(8.5);
  doc.text('PIZZARIA ESTRELA DA ILHA', PAGE_MARGIN, 11);

  doc.setFont(FONT, 'normal');
  doc.setTextColor(...INK_SECONDARY);
  doc.setFontSize(8);
  doc.text(sectionLabel, pageW / 2, 11, { align: 'center' });

  doc.setFont(FONT, 'normal');
  doc.setTextColor(...INK_MUTED);
  doc.setFontSize(8);
  doc.text(`p. ${pageNumber}`, pageW - PAGE_MARGIN, 11, { align: 'right' });

  // Linha divisória
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  doc.line(PAGE_MARGIN, 14, pageW - PAGE_MARGIN, 14);
}

function pageFooter(doc: jsPDF, totalPages: number) {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    if (i === 1) continue; // capa não tem footer
    // Linha divisória inferior
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(PAGE_MARGIN, pageH - 13, pageW - PAGE_MARGIN, pageH - 13);

    doc.setFont(FONT, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...INK_MUTED);
    doc.text('Pizzaria Estrela da Ilha · CNPJ 00.939.190/0001-07', PAGE_MARGIN, pageH - 8);
    doc.text(`${i} / ${totalPages}`, pageW - PAGE_MARGIN, pageH - 8, { align: 'right' });
  }
}

// Título de seção: linha laranja + título grande
function sectionTitle(doc: jsPDF, eyebrow: string, title: string, y: number) {
  // Eyebrow (pequeno texto laranja acima)
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PRIMARY);
  doc.text(eyebrow.toUpperCase(), PAGE_MARGIN, y);

  // Título principal
  doc.setFont(FONT, 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text(title, PAGE_MARGIN, y + 9);

  // Linha laranja decorativa
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.8);
  doc.line(PAGE_MARGIN, y + 12.5, PAGE_MARGIN + 14, y + 12.5);

  return y + 17;
}

// Rótulo de seção secundária (H3)
function subTitle(doc: jsPDF, label: string, y: number) {
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(label.toUpperCase(), PAGE_MARGIN, y);
  // Linha sutil abaixo
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  const textW = doc.getTextWidth(label.toUpperCase());
  doc.line(PAGE_MARGIN, y + 1.5, PAGE_MARGIN + textW, y + 1.5);
  return y + 5;
}

// KPI box elegante
function kpiBox(
  doc: jsPDF,
  x: number, y: number, w: number, h: number,
  eyebrow: string, value: string, hint: string,
  highlightColor?: [number, number, number],
) {
  // Borda fina
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, w, h, 1, 1, 'S');

  // Barra lateral colorida (3pt)
  doc.setFillColor(...(highlightColor ?? PRIMARY));
  doc.rect(x, y, 1, h, 'F');

  // Eyebrow
  doc.setFont(FONT, 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...INK_MUTED);
  doc.text(eyebrow.toUpperCase(), x + 4, y + 5);

  // Valor principal — grande e bold
  doc.setFont(FONT, 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text(value, x + 4, y + 13);

  // Hint
  if (hint) {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...INK_MUTED);
    const lines = doc.splitTextToSize(hint, w - 6);
    doc.text(lines, x + 4, y + 18);
  }
}

// ═══ Página 1: Capa ════════════════════════════════════════════════════════
function coverPage(doc: jsPDF, data: ContabilPdfData) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Faixa laranja superior larga
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, pageW, 65, 'F');

  // Texto branco sobre o laranja
  doc.setFont(FONT, 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...WHITE);
  doc.text('PIZZARIA ESTRELA DA ILHA', PAGE_MARGIN, 22);

  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.text('CNPJ 00.939.190/0001-07', PAGE_MARGIN, 28);

  // Eyebrow centralizado embaixo da faixa
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...WHITE);
  doc.text('RELATÓRIO CONTÁBIL', PAGE_MARGIN, 50);

  // Título principal grande
  doc.setFont(FONT, 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...WHITE);
  doc.text('Controle de Taxas', PAGE_MARGIN, 60);

  // Período em destaque (fora da faixa)
  doc.setFont(FONT, 'bold');
  doc.setFontSize(36);
  doc.setTextColor(...INK);
  doc.text(data.periodLabel, PAGE_MARGIN, 95);

  // Linha decorativa abaixo do período
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(1.5);
  doc.line(PAGE_MARGIN, 100, PAGE_MARGIN + 30, 100);

  // Sumário do documento
  const sumarioY = 125;
  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PRIMARY);
  doc.text('SUMÁRIO', PAGE_MARGIN, sumarioY);

  const items = [
    ['1', 'Resumo Consolidado', '2'],
    ['2', 'Maquinona iFood', '3'],
    ['3', 'Vouchers', '4'],
    ['4', 'Brendi', '5'],
    ['5', 'iFood Marketplace', '6'],
  ];
  let y = sumarioY + 7;
  for (const [num, label, pg] of items) {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...PRIMARY);
    doc.text(num, PAGE_MARGIN, y);

    doc.setFont(FONT, 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text(label, PAGE_MARGIN + 8, y);

    // Pontilhado entre label e número de página
    doc.setDrawColor(...RULE);
    doc.setLineDashPattern([0.5, 1], 0);
    doc.line(PAGE_MARGIN + 8 + doc.getTextWidth(label) + 2, y - 1, pageW - PAGE_MARGIN - 10, y - 1);
    doc.setLineDashPattern([], 0);

    doc.setFont(FONT, 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK_MUTED);
    doc.text(pg, pageW - PAGE_MARGIN, y, { align: 'right' });

    y += 8;
  }

  // Bloco inferior com metadata
  const metaY = pageH - 50;
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(PAGE_MARGIN, metaY, pageW - PAGE_MARGIN, metaY);

  const now = new Date();
  doc.setFont(FONT, 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...INK_MUTED);
  doc.text('EMITIDO EM', PAGE_MARGIN, metaY + 8);
  doc.text('EMITIDO POR', PAGE_MARGIN + 60, metaY + 8);
  doc.text('TIPO', PAGE_MARGIN + 120, metaY + 8);

  doc.setFont(FONT, 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(
    `${now.toLocaleDateString('pt-BR')} · ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
    PAGE_MARGIN, metaY + 14,
  );
  doc.text(data.emittedBy, PAGE_MARGIN + 60, metaY + 14);
  doc.text('Auditoria mensal', PAGE_MARGIN + 120, metaY + 14);

  // Footer da capa (sem número, com tagline)
  doc.setFont(FONT, 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(...INK_MUTED);
  doc.text(
    'Documento gerado automaticamente pelo sistema de auditoria. '
    + 'Consolida todos os custos por adquirente/operadora no período de competência.',
    PAGE_MARGIN, pageH - 20,
  );
}

// ═══ Página 2: Resumo Consolidado ══════════════════════════════════════════
function pageResumoConsolidado(doc: jsPDF, data: ContabilPdfData) {
  doc.addPage();
  pageHeader(doc, 'Resumo Consolidado', 2);
  let y = sectionTitle(doc, 'Seção 1', 'Resumo Consolidado', 22);

  // Calcular totais
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

  // 3 KPIs no topo
  const pageW = doc.internal.pageSize.getWidth();
  const kpiW = (pageW - PAGE_MARGIN * 2 - 8) / 3;
  kpiBox(doc, PAGE_MARGIN, y, kpiW, 24, 'Faturamento bruto', fmtBRL(totVendido), `${fmtInt(totQtd)} transações no período`);
  kpiBox(doc, PAGE_MARGIN + kpiW + 4, y, kpiW, 24, 'Líquido efetivo', fmtBRL(totRecebido), `Após custos e antecipações`, POSITIVE);
  kpiBox(doc, PAGE_MARGIN + (kpiW + 4) * 2, y, kpiW, 24, 'Custo total', `${fmtBRL(totCusto)}  ·  ${fmtPct(totPct)}`, 'Taxa efetiva sobre faturamento bruto', NEGATIVE);
  y += 32;

  // Tabela detalhada
  y = subTitle(doc, 'Detalhamento por categoria', y);

  const rows: any[] = [];
  for (const cat of CATEGORIAS_ORDEM) {
    if (cat === 'brendi') {
      if (data.brendi) {
        const b = data.brendi;
        const pct = b.vendido_bruto > 0 ? (b.custo_total / b.vendido_bruto) * 100 : 0;
        rows.push([
          'Brendi (online)',
          fmtInt(b.pedidos_count_mes),
          fmtNum(b.vendido_bruto),
          fmtNum(b.recebido_bb),
          fmtNum(b.custo_total),
          fmtPct(pct),
        ]);
      }
      continue;
    }
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r || (r.vendido === 0 && r.qtd === 0)) continue;
    const pct = r.vendido > 0 ? (r.custo / r.vendido) * 100 : 0;
    rows.push([
      CATEGORIA_LABELS[cat],
      fmtInt(r.qtd),
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
      fmtInt(i.pedidos_count),
      fmtNum(i.vendido_bruto),
      fmtNum(i.liquido_efetivo),
      fmtNum(i.custo_total),
      fmtPct(pct),
    ]);
  }
  rows.push([
    'TOTAL',
    fmtInt(totQtd),
    fmtNum(totVendido),
    fmtNum(totRecebido),
    fmtNum(totCusto),
    fmtPct(totPct),
  ]);

  styledTable(doc, y, ['Categoria', 'Qtd', 'Vendido', 'Recebido', 'Custo', '% s/vendido'], rows, [50, 22, 32, 32, 28, 22]);

  // Nota de rodapé da seção
  const notaY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont(FONT, 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(...INK_MUTED);
  doc.text(
    'Vendido = bruto na competência (mês). Recebido = efetivamente creditado em conta. '
    + 'Custo = total de cobranças por adquirente/operadora.',
    PAGE_MARGIN, notaY,
  );
}

// ═══ Página 3: Maquinona iFood ═════════════════════════════════════════════
function pageMaquinona(doc: jsPDF, data: ContabilPdfData) {
  doc.addPage();
  pageHeader(doc, 'Maquinona iFood', 3);
  let y = sectionTitle(doc, 'Seção 2', 'Maquinona iFood', 22);

  // Subtítulo descritivo
  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK_SECONDARY);
  doc.text('Vendas físicas (Crédito · Débito · Pix) processadas pela Maquinona iFood, com depósito na Cresol.', PAGE_MARGIN, y);
  y += 8;

  // Calcular totais Maquinona
  const cats = ['credito', 'debito', 'pix'] as ContabilCategoria[];
  let totQtd = 0, totVendido = 0, totRecebido = 0, totCusto = 0;
  for (const cat of cats) {
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r) continue;
    totQtd += r.qtd; totVendido += r.vendido; totRecebido += r.recebido; totCusto += r.custo;
  }
  const totPct = totVendido > 0 ? (totCusto / totVendido) * 100 : 0;

  // KPIs
  const pageW = doc.internal.pageSize.getWidth();
  const kpiW = (pageW - PAGE_MARGIN * 2 - 8) / 3;
  kpiBox(doc, PAGE_MARGIN, y, kpiW, 24, 'Total vendido', fmtBRL(totVendido), `${fmtInt(totQtd)} transações`);
  kpiBox(doc, PAGE_MARGIN + kpiW + 4, y, kpiW, 24, 'Total recebido', fmtBRL(totRecebido), 'Cresol — depósitos pareados', POSITIVE);
  kpiBox(doc, PAGE_MARGIN + (kpiW + 4) * 2, y, kpiW, 24, 'Custo total', `${fmtBRL(totCusto)}  ·  ${fmtPct(totPct)}`, 'Taxa transação + antecipação + outros', NEGATIVE);
  y += 32;

  // Tabela detalhada
  y = subTitle(doc, 'Detalhamento por meio de pagamento', y);

  const rows: any[] = [];
  for (const cat of cats) {
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r) continue;
    const pct = r.vendido > 0 ? (r.custo / r.vendido) * 100 : 0;
    rows.push([
      CATEGORIA_LABELS[cat],
      fmtInt(r.qtd),
      fmtNum(r.vendido),
      fmtNum(r.recebido),
      fmtNum(r.custo),
      fmtPct(pct),
    ]);
  }
  rows.push(['TOTAL', fmtInt(totQtd), fmtNum(totVendido), fmtNum(totRecebido), fmtNum(totCusto), fmtPct(totPct)]);

  styledTable(doc, y, ['Meio de pagamento', 'Qtd', 'Vendido', 'Recebido', 'Custo', '% s/vendido'], rows, [50, 22, 32, 32, 28, 22]);

  // Nota
  const notaY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont(FONT, 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(...INK_MUTED);
  const nota = doc.splitTextToSize(
    'Custo = vendido (bruto) − recebido (creditado em conta). Engloba taxa de transação, '
    + 'taxa de antecipação automática, promoções absorvidas pela loja e custos de conciliação não detalhados '
    + 'pela Maquinona (alocados ao Pix por convenção, equivalente à diferença real Maquinona × Cresol).',
    pageW - PAGE_MARGIN * 2,
  );
  doc.text(nota, PAGE_MARGIN, notaY);
}

// ═══ Página 4: Vouchers ════════════════════════════════════════════════════
function pageVouchers(doc: jsPDF, data: ContabilPdfData) {
  doc.addPage();
  pageHeader(doc, 'Vouchers', 4);
  let y = sectionTitle(doc, 'Seção 3', 'Vouchers', 22);

  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK_SECONDARY);
  doc.text('Lotes de vouchers Alelo, Ticket, Vale Refeição e Pluxee pareados com depósitos no Banco do Brasil.', PAGE_MARGIN, y);
  y += 8;

  const cats = ['alelo', 'ticket', 'vr', 'pluxee'] as ContabilCategoria[];
  let totQtd = 0, totVendido = 0, totRecebido = 0, totCusto = 0;
  for (const cat of cats) {
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r) continue;
    totQtd += r.qtd; totVendido += r.vendido; totRecebido += r.recebido; totCusto += r.custo;
  }
  const totPct = totVendido > 0 ? (totCusto / totVendido) * 100 : 0;

  // KPIs
  const pageW = doc.internal.pageSize.getWidth();
  const kpiW = (pageW - PAGE_MARGIN * 2 - 8) / 3;
  kpiBox(doc, PAGE_MARGIN, y, kpiW, 24, 'Total vendido', fmtBRL(totVendido), `${fmtInt(totQtd)} vendas em ${cats.length} operadoras`);
  kpiBox(doc, PAGE_MARGIN + kpiW + 4, y, kpiW, 24, 'Total recebido', fmtBRL(totRecebido), 'Depósitos pareados no BB', POSITIVE);
  kpiBox(doc, PAGE_MARGIN + (kpiW + 4) * 2, y, kpiW, 24, 'Custo total', `${fmtBRL(totCusto)}  ·  ${fmtPct(totPct)}`, 'Taxa de gestão + transação + outras', NEGATIVE);
  y += 32;

  // Tabela
  y = subTitle(doc, 'Detalhamento por operadora', y);

  const rows: any[] = [];
  for (const cat of cats) {
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r || (r.vendido === 0 && r.qtd === 0)) continue;
    const pct = r.vendido > 0 ? (r.custo / r.vendido) * 100 : 0;
    rows.push([
      CATEGORIA_LABELS[cat],
      fmtInt(r.qtd),
      fmtNum(r.vendido),
      fmtNum(r.recebido),
      fmtNum(r.custo),
      fmtPct(pct),
    ]);
  }
  rows.push(['TOTAL', fmtInt(totQtd), fmtNum(totVendido), fmtNum(totRecebido), fmtNum(totCusto), fmtPct(totPct)]);

  styledTable(doc, y, ['Operadora', 'Qtd Vendas', 'Vendido', 'Recebido', 'Custo', '% s/vendido'], rows, [50, 28, 32, 32, 28, 22]);

  const notaY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont(FONT, 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(...INK_MUTED);
  doc.text(
    'Vendas filtradas pelo mês de competência (data da transação). Lotes parciais '
    + '(vendas de mais de um mês) usam override manual quando aplicável.',
    PAGE_MARGIN, notaY,
  );
}

// ═══ Página 5: Brendi ══════════════════════════════════════════════════════
function pageBrendi(doc: jsPDF, data: ContabilPdfData) {
  if (!data.brendi) return;
  const b = data.brendi;
  doc.addPage();
  pageHeader(doc, 'Brendi', 5);
  let y = sectionTitle(doc, 'Seção 4', 'Brendi', 22);

  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK_SECONDARY);
  doc.text('Marketplace de pedidos online com depósito direto via PIX no Banco do Brasil.', PAGE_MARGIN, y);
  y += 8;

  const pctTotal = b.vendido_bruto > 0 ? (b.custo_total / b.vendido_bruto) * 100 : 0;

  // KPIs
  const pageW = doc.internal.pageSize.getWidth();
  const kpiW = (pageW - PAGE_MARGIN * 2 - 8) / 3;
  kpiBox(doc, PAGE_MARGIN, y, kpiW, 24, 'Total bruto', fmtBRL(b.vendido_bruto), `${fmtInt(b.pedidos_count_mes)} pedidos no mês`);
  kpiBox(doc, PAGE_MARGIN + kpiW + 4, y, kpiW, 24, 'Total líquido', fmtBRL(b.recebido_bb), `${fmtInt(b.dias_uteis)} dias úteis com depósito`, POSITIVE);
  kpiBox(doc, PAGE_MARGIN + (kpiW + 4) * 2, y, kpiW, 24, 'Custo total', `${fmtBRL(b.custo_total)}  ·  ${fmtPct(pctTotal)}`, 'Taxas transacionais + mensalidade', NEGATIVE);
  y += 32;

  // Breakdown
  y = subTitle(doc, 'Detalhamento de cobranças', y);

  const rows: any[] = [
    ['Taxas transacionais', 'Pix 0,5% + R$ 0,40 · Crédito Online 5,69%', fmtNum(b.taxa_declarada)],
    ['Mensalidade', 'Diferença esperado vs recebido', fmtNum(b.custo_oculto)],
    ['TOTAL', '', fmtNum(b.custo_total)],
  ];

  styledTable(
    doc, y,
    ['Tipo de cobrança', 'Descrição', 'Valor (R$)'],
    rows,
    [55, 90, 35],
  );

  const notaY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont(FONT, 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(...INK_MUTED);
  doc.text(
    `Importados nos últimos 3 meses: ${fmtInt(b.pedidos_importados_3meses)} pedidos · `
    + 'Taxas transacionais = soma das taxas declaradas pela Brendi por venda. '
    + 'Mensalidade = diferença entre o esperado (bruto − taxa declarada) e o efetivamente recebido no banco.',
    PAGE_MARGIN, notaY,
  );
}

// ═══ Página 6: iFood Marketplace ═══════════════════════════════════════════
function pageIfood(doc: jsPDF, data: ContabilPdfData) {
  if (!data.ifood) return;
  const i = data.ifood;
  doc.addPage();
  pageHeader(doc, 'iFood Marketplace', 6);
  let y = sectionTitle(doc, 'Seção 5', 'iFood Marketplace', 22);

  doc.setFont(FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK_SECONDARY);
  doc.text('Vendas online via iFood com repasses semanais (PIX único somando lojas) na conta iFood Pago.', PAGE_MARGIN, y);
  y += 8;

  // KPIs
  const pageW = doc.internal.pageSize.getWidth();
  const kpiW = (pageW - PAGE_MARGIN * 2 - 8) / 3;
  kpiBox(doc, PAGE_MARGIN, y, kpiW, 24, 'Total bruto', fmtBRL(i.vendido_bruto), `${fmtInt(i.pedidos_count)} pedidos online`);
  kpiBox(doc, PAGE_MARGIN + kpiW + 4, y, kpiW, 24, 'Total líquido', fmtBRL(i.liquido_efetivo), `${i.repasses_count} repasses, após antecipação`, POSITIVE);
  kpiBox(doc, PAGE_MARGIN + (kpiW + 4) * 2, y, kpiW, 24, 'Custo total', `${fmtBRL(i.custo_total)}  ·  ${fmtPct(i.taxa_efetiva_pct)}`, 'Comissão + taxas + logística + ADS', NEGATIVE);
  y += 32;

  // Breakdown
  y = subTitle(doc, 'Detalhamento de cobranças', y);

  const breakdown: any[] = [
    ['Comissão iFood', fmtNum(Math.abs(i.comissao))],
    ['Taxa de transação', fmtNum(Math.abs(i.taxa_transacao))],
    ['Taxa de antecipação', fmtNum(Math.abs(i.taxa_antecipacao))],
    ['Taxa conveniência (parcelado)', fmtNum(Math.abs(i.taxa_conveniencia))],
    ['Mensalidade', fmtNum(Math.abs(i.mensalidade))],
    ['Frete iFood', fmtNum(Math.abs(i.frete))],
    ['Taxa entrega retenção', fmtNum(Math.abs(i.taxa_entrega_ret))],
    ['Taxa serviço Sob Demanda Off', fmtNum(Math.abs(i.taxa_servico_sob_demanda))],
    ['ADS (anúncios)', fmtNum(Math.abs(i.ads))],
    ['TOTAL', fmtNum(i.custo_total)],
  ];

  styledTable(doc, y, ['Tipo de cobrança', 'Valor (R$)'], breakdown, [130, 50]);

  // Informativo (não soma)
  y = (doc as any).lastAutoTable.finalY + 10;
  y = subTitle(doc, 'Informativo (não soma no custo)', y);

  const informativo: any[] = [
    ['Cancelamentos (total)', fmtNum(Math.abs(i.cancel_total))],
    ['Cancelamentos (parcial)', fmtNum(Math.abs(i.cancel_parcial))],
    ['Reembolsos pra loja', fmtNum(i.reembolsos)],
    ['Ressarcimentos', fmtNum(i.ressarc)],
    ['Promo iFood (devolução)', fmtNum(i.promo_ifood)],
    ['Taxa serviço cliente (retido pelo iFood)', fmtNum(Math.abs(i.taxa_servico_cliente))],
    ['Promoções loja (subsídio absorvido)', fmtNum(Math.abs(i.promocoes_loja))],
    ['Pgto direto loja (dinheiro/maquinininha)', fmtNum(i.recebido_direto)],
  ];

  autoTable(doc, {
    startY: y,
    body: informativo,
    theme: 'plain',
    styles: { font: FONT, fontSize: 8.5, cellPadding: 1.5, textColor: INK_SECONDARY },
    columnStyles: {
      0: { cellWidth: 130 },
      1: { halign: 'right' },
    },
  });
}

// ═══ Tabela estilizada ═════════════════════════════════════════════════════
function styledTable(
  doc: jsPDF,
  startY: number,
  headers: string[],
  rows: any[][],
  widths: number[],
) {
  autoTable(doc, {
    startY,
    head: [headers],
    body: rows,
    theme: 'plain',
    styles: {
      font: FONT,
      fontSize: 9.5,
      cellPadding: { top: 2.5, right: 3, bottom: 2.5, left: 3 },
      textColor: INK,
      lineColor: RULE,
      lineWidth: 0,
    },
    headStyles: {
      fillColor: WHITE,
      textColor: INK_MUTED,
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: { top: 2, right: 3, bottom: 3, left: 3 },
      lineWidth: { bottom: 0.4 },
      lineColor: RULE_DARK,
      halign: 'left',
    },
    columnStyles: Object.fromEntries(widths.map((w, i) => [
      i,
      {
        cellWidth: w,
        halign: i === 0 ? 'left' : 'right',
        ...(i === 0 ? { fontStyle: 'bold' } : {}),
      },
    ])),
    didParseCell: (h) => {
      // Linha TOTAL com fundo cinza e bordas top/bottom
      if (h.section === 'body' && h.row.index === rows.length - 1) {
        h.cell.styles.fillColor = TOTAL_BG;
        h.cell.styles.fontStyle = 'bold';
        h.cell.styles.lineWidth = { top: 0.4, bottom: 0.4 };
        h.cell.styles.lineColor = INK;
      } else if (h.section === 'body') {
        // Linhas alternadas (zebra sutil)
        if (h.row.index % 2 === 1) {
          h.cell.styles.fillColor = SUBTLE_BG;
        }
        // Linha fina embaixo de cada row pra divisão visual
        h.cell.styles.lineWidth = { bottom: 0.1 };
        h.cell.styles.lineColor = RULE;
      }
    },
    // Forçar todas as colunas pra direita exceto a primeira (texto)
    headStylesAdvanced: {} as any,
  });
}

// ═══ Daily detalhamento (modo detalhado) ═══════════════════════════════════
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

  doc.setFont(FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...PRIMARY);
  doc.text(CATEGORIA_LABELS[categoria].toUpperCase(), startX, startY - 2);

  autoTable(doc, {
    startY,
    margin: { left: startX, right: doc.internal.pageSize.getWidth() - startX - width },
    tableWidth: width,
    head: [['Dia', 'Qtd', 'Vendido', 'Custo']],
    body,
    theme: 'plain',
    styles: { font: FONT, fontSize: 7, cellPadding: 1.4, textColor: INK },
    headStyles: {
      fillColor: WHITE,
      textColor: INK_MUTED,
      fontStyle: 'bold',
      lineWidth: { bottom: 0.3 },
      lineColor: RULE_DARK,
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 },
      1: { halign: 'right', cellWidth: 14 },
      2: { halign: 'right' },
      3: { halign: 'right' },
    },
    didParseCell: (h) => {
      if (h.section === 'body' && h.row.index === body.length - 1) {
        h.cell.styles.fillColor = TOTAL_BG;
        h.cell.styles.fontStyle = 'bold';
        h.cell.styles.lineWidth = { top: 0.3 };
        h.cell.styles.lineColor = INK;
      } else if (h.section === 'body' && h.row.index % 2 === 1) {
        h.cell.styles.fillColor = SUBTLE_BG;
      }
    },
  });
}

function detalhamentoPages(doc: jsPDF, data: ContabilPdfData, pageStart: number) {
  const detalhe = data.detalhamentoDiario ?? [];
  const ativas = CATEGORIAS_ORDEM.filter(cat => {
    if (cat === 'brendi') return false;
    const d = detalhe.find(x => x.categoria === cat);
    if (!d) return false;
    return d.dias.some(r => r.qtd > 0 || r.vendido > 0);
  });

  let pageNum = pageStart;
  for (let i = 0; i < ativas.length; i += 2) {
    doc.addPage('a4', 'landscape');
    pageHeader(doc, 'Detalhamento Diário', pageNum);
    pageNum++;

    const pageW = doc.internal.pageSize.getWidth();
    const margin = PAGE_MARGIN;
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

  // Página 1: Capa
  coverPage(doc, data);
  // Página 2: Resumo Consolidado
  pageResumoConsolidado(doc, data);
  // Página 3: Maquinona iFood
  pageMaquinona(doc, data);
  // Página 4: Vouchers
  pageVouchers(doc, data);
  // Página 5: Brendi
  pageBrendi(doc, data);
  // Página 6: iFood Marketplace
  pageIfood(doc, data);

  if (mode === 'detalhado') {
    detalhamentoPages(doc, data, 7);
  }

  pageFooter(doc, doc.getNumberOfPages());

  const fileName = `controle-taxas-${data.periodFileTag}-${mode}.pdf`;
  doc.save(fileName);
}
