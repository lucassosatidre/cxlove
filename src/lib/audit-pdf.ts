import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const ORANGE: [number, number, number] = [249, 115, 22]; // #F97316
const BLACK: [number, number, number] = [26, 26, 26];
const GREEN: [number, number, number] = [16, 185, 129];
const YELLOW: [number, number, number] = [245, 158, 11];
const RED: [number, number, number] = [239, 68, 68];
const BLUE: [number, number, number] = [59, 130, 246];
const GRAY: [number, number, number] = [120, 120, 120];

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number, decimals = 2) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

export type DailyMatchRow = {
  match_date: string;
  expected_amount: number;
  deposited_amount: number;
  difference: number;
  transaction_count: number;
  status: string;
  gross?: number;
  tax?: number;
};

export type VoucherMatchRow = {
  company: string;
  sold_amount: number;
  deposited_amount: number;
  difference: number;
  effective_tax_rate: number;
  status: string;
};

export type AuditPdfData = {
  periodLabel: string;        // e.g. "Março / 2026"
  periodFileTag: string;      // e.g. "2026-03"
  emittedBy: string;
  totals: {
    vendido: number;
    recebido: number;
    custoTotal: number;
    taxaEfetiva: number;
  };
  criticalVouchers: VoucherMatchRow[];
  ifoodSummary?: {
    bruto: number;
    taxaDeclarada: number;
    liquidoEsperado: number;
    depositoCresol: number;
    diferenca: number;
  };
  dailyRows?: DailyMatchRow[];
  voucherRows?: VoucherMatchRow[];
};

const COMPANY_LABELS: Record<string, string> = {
  alelo: 'ALELO',
  ticket: 'TICKET',
  pluxee: 'PLUXEE',
  vr: 'VR',
};

const STATUS_LABELS: Record<string, string> = {
  ok: 'OK',
  alerta: 'ALERTA',
  critico: 'CRÍTICO',
  divergente: 'DIVERG',
  no_sales: 'SEM VENDAS',
  matched: 'OK',
  cluster_matched: 'OK (CLUSTER)',
  partial: 'PARCIAL',
  cluster_partial: 'PARCIAL (CLUSTER)',
  missing_deposit: 'SEM DEP.',
  extra_deposit: 'DEP. EXTRA',
  pending: 'AGUARDANDO',
};

const STATUS_COLORS: Record<string, [number, number, number]> = {
  ok: GREEN,
  matched: GREEN,
  cluster_matched: GREEN,
  alerta: YELLOW,
  partial: YELLOW,
  cluster_partial: YELLOW,
  critico: RED,
  missing_deposit: RED,
  divergente: BLUE,
  extra_deposit: BLUE,
  no_sales: GRAY,
  pending: YELLOW,
};

function header(doc: jsPDF, periodLabel: string, emittedBy: string) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ORANGE);
  doc.setFontSize(10);
  doc.text('PIZZARIA ESTRELA DA ILHA', 20, 14);
  doc.setTextColor(...BLACK);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Auditoria de Taxas — ${periodLabel}`, pageW - 20, 14, { align: 'right' });
  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.5);
  doc.line(20, 17, pageW - 20, 17);
}

function footer(doc: jsPDF) {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(220);
    doc.line(20, pageH - 18, pageW - 20, pageH - 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text(
      'Pizzaria Estrela da Ilha — Relatório gerado automaticamente. Taxas efetivas de 1 mês podem conter efeitos de borda (repasses atrasados/adiantados). Para análise definitiva, use 3+ meses.',
      20, pageH - 13, { maxWidth: pageW - 60 }
    );
    doc.text(`Pág ${i}/${total}`, pageW - 20, pageH - 9, { align: 'right' });
  }
}

function coverPage(doc: jsPDF, data: AuditPdfData) {
  const pageW = doc.internal.pageSize.getWidth();
  header(doc, data.periodLabel, data.emittedBy);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...ORANGE);
  doc.setFontSize(22);
  doc.text('RELATÓRIO DE AUDITORIA DE TAXAS', 20, 36);

  doc.setTextColor(...BLACK);
  doc.setFontSize(14);
  doc.text(`Período: ${data.periodLabel.toUpperCase()}`, 20, 46);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const now = new Date();
  doc.text(`Emitido em: ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, 20, 56);
  doc.text(`Emitido por: ${data.emittedBy}`, 20, 62);
  doc.text('CNPJ: 00.939.190/0001-07', 20, 68);

  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.3);
  doc.line(20, 76, pageW - 20, 76);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...ORANGE);
  doc.text('RESUMO EXECUTIVO', 20, 86);

  autoTable(doc, {
    startY: 92,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 11, cellPadding: 4, textColor: BLACK },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 60 },
      1: { halign: 'right' },
    },
    body: [
      ['Vendido', fmtBRL(data.totals.vendido)],
      ['Recebido', fmtBRL(data.totals.recebido)],
      ['Custo Total', fmtBRL(data.totals.custoTotal)],
      ['Taxa Efetiva', `${fmtNum(data.totals.taxaEfetiva)}%`],
    ],
  });

  let y = (doc as any).lastAutoTable.finalY + 12;

  if (data.criticalVouchers.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...RED);
    doc.text('🚨 ALERTAS', 20, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...BLACK);
    for (const v of data.criticalVouchers) {
      const label = COMPANY_LABELS[v.company] ?? v.company.toUpperCase();
      doc.text(
        `• ${label}: taxa efetiva de ${fmtNum(Number(v.effective_tax_rate))}% — CRÍTICO`,
        24, y
      );
      y += 5;
      doc.setTextColor(...GRAY);
      doc.text(
        `   Vendido ${fmtBRL(Number(v.sold_amount))} · Recebido ${fmtBRL(Number(v.deposited_amount))} · Diferença ${fmtBRL(Number(v.difference))}`,
        24, y
      );
      doc.setTextColor(...BLACK);
      y += 7;
    }
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(...GRAY);
    doc.text('Nenhum alerta crítico no período.', 20, y);
  }
}

function ifoodPage(doc: jsPDF, data: AuditPdfData) {
  doc.addPage();
  header(doc, data.periodLabel, data.emittedBy);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...ORANGE);
  doc.text('CONCILIAÇÃO IFOOD (CRESOL)', 20, 32);

  if (data.ifoodSummary) {
    autoTable(doc, {
      startY: 38,
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 1.5, textColor: BLACK },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 70 },
        1: { halign: 'right' },
      },
      body: [
        ['Vendas brutas:', fmtBRL(data.ifoodSummary.bruto)],
        ['Taxa declarada:', `${fmtBRL(data.ifoodSummary.taxaDeclarada)} (${data.ifoodSummary.bruto > 0 ? fmtNum(data.ifoodSummary.taxaDeclarada / data.ifoodSummary.bruto * 100) : '0,00'}%)`],
        ['Líquido esperado:', fmtBRL(data.ifoodSummary.liquidoEsperado)],
        ['Depósito Cresol:', fmtBRL(data.ifoodSummary.depositoCresol)],
        ['Diferença líquida:', fmtBRL(data.ifoodSummary.diferenca)],
      ],
    });
  }

  const startY = ((doc as any).lastAutoTable?.finalY ?? 50) + 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...BLACK);
  doc.text('Detalhamento diário', 20, startY);

  const rows = (data.dailyRows ?? []).map(r => [
    fmtDate(r.match_date),
    String(r.transaction_count),
    fmtBRL(Number(r.gross ?? 0)),
    fmtBRL(Number(r.expected_amount)),
    fmtBRL(Number(r.deposited_amount)),
    fmtBRL(Number(r.difference)),
    STATUS_LABELS[r.status] ?? r.status,
  ]);

  autoTable(doc, {
    startY: startY + 3,
    head: [['Data', 'Vnd', 'Bruto', 'Líq Esp', 'Depósito', 'Diferença', 'Status']],
    body: rows.length > 0 ? rows : [['—', '—', '—', '—', '—', '—', '—']],
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2, textColor: BLACK },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
    didParseCell: (hookData) => {
      if (hookData.section === 'body' && hookData.column.index === 6) {
        const status = (data.dailyRows ?? [])[hookData.row.index]?.status;
        const color = status ? STATUS_COLORS[status] : undefined;
        if (color) {
          hookData.cell.styles.textColor = color;
          hookData.cell.styles.fontStyle = 'bold';
        }
      }
      if (hookData.section === 'body' && hookData.column.index === 5) {
        const v = (data.dailyRows ?? [])[hookData.row.index]?.difference ?? 0;
        if (Number(v) < 0) hookData.cell.styles.textColor = RED;
        else if (Number(v) > 0) hookData.cell.styles.textColor = GREEN;
      }
    },
  });
}

function voucherPage(doc: jsPDF, data: AuditPdfData) {
  doc.addPage();
  header(doc, data.periodLabel, data.emittedBy);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...ORANGE);
  doc.text('CONCILIAÇÃO VOUCHER (BB)', 20, 32);

  const ordered = ['alelo', 'ticket', 'pluxee', 'vr']
    .map(c => (data.voucherRows ?? []).find(v => v.company === c))
    .filter(Boolean) as VoucherMatchRow[];

  const totalSold = ordered.reduce((s, r) => s + Number(r.sold_amount), 0);
  const totalDep = ordered.reduce((s, r) => s + Number(r.deposited_amount), 0);
  const totalDiff = totalSold - totalDep;
  const totalRate = totalSold > 0 ? (totalDiff / totalSold) * 100 : 0;

  const body = ordered.map(v => [
    COMPANY_LABELS[v.company] ?? v.company.toUpperCase(),
    fmtBRL(Number(v.sold_amount)),
    fmtBRL(Number(v.deposited_amount)),
    `${fmtNum(Number(v.effective_tax_rate))}%`,
    STATUS_LABELS[v.status] ?? v.status,
  ]);

  body.push([
    'TOTAL',
    fmtBRL(totalSold),
    fmtBRL(totalDep),
    `${fmtNum(totalRate)}%`,
    '',
  ]);

  autoTable(doc, {
    startY: 40,
    head: [['Empresa', 'Vendido', 'Recebido', 'Taxa Efetiva', 'Status']],
    body,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 3.5, textColor: BLACK },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'center', fontStyle: 'bold' },
    },
    didParseCell: (hookData) => {
      if (hookData.section === 'body' && hookData.row.index === body.length - 1) {
        hookData.cell.styles.fillColor = [240, 240, 240];
        hookData.cell.styles.fontStyle = 'bold';
      }
      if (hookData.section === 'body' && hookData.column.index === 4 && hookData.row.index < ordered.length) {
        const status = ordered[hookData.row.index]?.status;
        const color = status ? STATUS_COLORS[status] : undefined;
        if (color) hookData.cell.styles.textColor = color;
      }
    },
  });
}

export function generateAuditPdf(
  type: 'completo' | 'ifood' | 'voucher',
  data: AuditPdfData
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  coverPage(doc, data);

  if (type === 'completo' || type === 'ifood') ifoodPage(doc, data);
  if (type === 'completo' || type === 'voucher') voucherPage(doc, data);

  footer(doc);

  const fileName = `auditoria-taxas-${data.periodFileTag}-${type}.pdf`;
  doc.save(fileName);
}

export function periodFileTag(month: number, year: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function periodLabel(month: number, year: number): string {
  return `${MONTHS[month - 1]} / ${year}`;
}
