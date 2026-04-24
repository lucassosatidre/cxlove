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
  bruto: number;
  liquido: number;
  taxa: number;
};

export type ContabilDiaRow = {
  dia: number;
  qtd: number;
  bruto: number;
  liquido: number;
  taxa: number;
};

export type ContabilDetalhamento = {
  categoria: ContabilCategoria;
  dias: ContabilDiaRow[];
};

export type ContabilPdfData = {
  periodLabel: string;
  periodFileTag: string;
  monthDays: number;
  emittedBy: string;
  resumoPorCategoria: ContabilResumoRow[];
  detalhamentoDiario?: ContabilDetalhamento[];
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

  // Build resumo body in fixed order
  const rows = CATEGORIAS_ORDEM.map(cat => {
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r || (cat === 'brendi')) {
      // Brendi placeholder
      if (cat === 'brendi') {
        return ['Brendi', '—', '0,00', '0,00', '0,00', '— em breve'];
      }
      return [CATEGORIA_LABELS[cat], '0', '0,00', '0,00', '0,00', '0,00%'];
    }
    const pct = r.bruto > 0 ? (r.taxa / r.bruto) * 100 : 0;
    return [
      CATEGORIA_LABELS[cat],
      String(r.qtd),
      fmtNum(r.bruto),
      fmtNum(r.liquido),
      fmtNum(Math.abs(r.taxa)),
      fmtPct(pct),
    ];
  });

  const totQtd = data.resumoPorCategoria.reduce((s, r) => s + r.qtd, 0);
  const totBruto = data.resumoPorCategoria.reduce((s, r) => s + r.bruto, 0);
  const totLiq = data.resumoPorCategoria.reduce((s, r) => s + r.liquido, 0);
  const totTaxa = data.resumoPorCategoria.reduce((s, r) => s + Math.abs(r.taxa), 0);
  const totPct = totBruto > 0 ? (totTaxa / totBruto) * 100 : 0;

  rows.push([
    'TOTAL',
    String(totQtd),
    fmtNum(totBruto),
    fmtNum(totLiq),
    fmtNum(totTaxa),
    fmtPct(totPct),
  ]);

  autoTable(doc, {
    startY: 60,
    head: [['Categoria', 'Qtd', 'Bruto', 'Líquido', 'Taxa', '%']],
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

  const taxaCredito = data.resumoPorCategoria.find(r => r.categoria === 'credito')?.taxa ?? 0;
  const taxaDebito = data.resumoPorCategoria.find(r => r.categoria === 'debito')?.taxa ?? 0;
  const taxaPix = data.resumoPorCategoria.find(r => r.categoria === 'pix')?.taxa ?? 0;
  const taxaVoucher = ['alelo', 'ticket', 'vr', 'pluxee']
    .reduce((s, c) => s + (data.resumoPorCategoria.find(r => r.categoria === c as ContabilCategoria)?.taxa ?? 0), 0);

  const totalApurado = Math.abs(taxaCredito) + Math.abs(taxaDebito) + Math.abs(taxaPix) + Math.abs(taxaVoucher);

  const taxaRows: Array<[string, string]> = [
    ['Taxa de Crédito', fmtBRL(Math.abs(taxaCredito))],
    ['Taxa de Débito', fmtBRL(Math.abs(taxaDebito))],
    ['Taxa de Pix', fmtBRL(Math.abs(taxaPix))],
    ['Taxas de Voucher', fmtBRL(Math.abs(taxaVoucher))],
    ['Total de comissão iFood', '— em breve (R$ 0,00)'],
    ['Taxa de antecipação iFood', '— em breve (R$ 0,00)'],
    ['Taxa Brendi (marketplace)', '— em breve (R$ 0,00)'],
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
  doc.text('TOTAL DE TAXAS APURADAS', 14, y);
  doc.text(fmtBRL(totalApurado), 14 + 130, y, { align: 'right' });

  y += 9;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  const obsLines = doc.splitTextToSize(
    '⚠ Observação: Os campos marcados como "em breve" serão habilitados em versão futura do módulo. Este relatório cobre apenas as taxas declaradas pela maquinona iFood. Comissão iFood (marketplace), taxa de antecipação e Brendi serão adicionados posteriormente.',
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
  let totQtd = 0, totBruto = 0, totLiq = 0, totTaxa = 0;

  for (let d = 1; d <= monthDays; d++) {
    const row = byDay.get(d);
    const qtd = row?.qtd ?? 0;
    const bruto = row?.bruto ?? 0;
    const liq = row?.liquido ?? 0;
    const taxa = Math.abs(row?.taxa ?? 0);
    totQtd += qtd; totBruto += bruto; totLiq += liq; totTaxa += taxa;
    body.push([String(d), String(qtd), fmtNum(bruto), fmtNum(taxa)]);
  }
  body.push(['TOTAL', String(totQtd), fmtNum(totBruto), fmtNum(totTaxa)]);

  // Title above table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...ORANGE);
  doc.text(CATEGORIA_LABELS[categoria].toUpperCase(), startX, startY - 2);

  autoTable(doc, {
    startY,
    margin: { left: startX, right: doc.internal.pageSize.getWidth() - startX - width },
    tableWidth: width,
    head: [['Dia', 'Qtd', 'Bruto', 'Taxa']],
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

  // Brendi placeholder page
  doc.addPage('a4', 'landscape');
  header(doc, data.periodLabel);
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...ORANGE);
  doc.text('BRENDI (marketplace)', 14, 32);

  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.3);
  doc.roundedRect(14, 40, pageW - 28, 40, 2, 2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...BLACK);
  doc.text('Funcionalidade em desenvolvimento.', 20, 54);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  doc.setTextColor(...GRAY);
  const txt = doc.splitTextToSize(
    'Quando implementada, esta seção exibirá o detalhamento diário dos depósitos Brendi e a taxa cobrada pela plataforma.',
    pageW - 40,
  );
  doc.text(txt, 20, 64);
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
