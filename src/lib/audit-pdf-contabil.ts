import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ═══ Paleta corporativa (refinada) ═════════════════════════════════════════
const PRIMARY: [number, number, number] = [180, 83, 9];            // laranja terracota (mais sóbrio, menos saturado)
const PRIMARY_DARK: [number, number, number] = [124, 45, 18];      // laranja-marrom escuro pra acentos profundos
const INK: [number, number, number] = [15, 23, 42];                // slate-900 (texto principal — quase preto, levemente azulado)
const INK_SECONDARY: [number, number, number] = [51, 65, 85];      // slate-700 (subtítulos)
const INK_MUTED: [number, number, number] = [148, 163, 184];       // slate-400 (legendas, hint)
const RULE: [number, number, number] = [226, 232, 240];            // slate-200 (linha divisória sutil)
const RULE_DARK: [number, number, number] = [51, 65, 85];          // slate-700 (divisória de header)
const SUBTLE_BG: [number, number, number] = [248, 250, 252];       // slate-50 (zebra)
const TOTAL_BG: [number, number, number] = [241, 245, 249];        // slate-100 (linha TOTAL)
const POSITIVE: [number, number, number] = [4, 120, 87];           // emerald-700 (verde mais sóbrio)
const NEGATIVE: [number, number, number] = [185, 28, 28];          // red-700 (vermelho mais sóbrio)
const WHITE: [number, number, number] = [255, 255, 255];

// Tipografia: títulos em serifa (clássico contábil), body em sans-serif.
const FONT = 'helvetica';
const FONT_SERIF = 'times';

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
  // Custo base (vendido − recebido) negativo: recebido > vendido — alerta.
  custo_negativo?: boolean;
  // F2 — provisão de taxa: vendas Maquinona da bandeira ainda sem extrato da
  // operadora. provisao_taxa já está somada em `custo` (estimada=true).
  estimada?: boolean;
  vendas_pendentes?: number;
  provisao_taxa?: number;
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
  // true quando audit_brendi_daily está vazio (match ainda não rodou) —
  // vendido vem dos pedidos, recebido/custo oculto ficam em 0.
  pendente_match?: boolean;
};

export type ContabilIfood = {
  vendido_bruto: number;
  vendido_online: number;
  // Soma de subtotal + taxa de entrega cobrada do cliente (audit_ifood_orders).
  // É a "vendas no portal" do iFood — costuma divergir do vendido_bruto
  // (que vem de audit_ifood_repasses, já com retenções aplicadas).
  valor_vendas_portal: number;
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
  frota_garantida: number;
  ads: number;
  promocoes_loja: number;
  cancel_total: number;
  cancel_parcial: number;
  reembolsos: number;
  ressarc: number;
  promo_ifood: number;
  taxa_servico_cliente: number;
  // Créditos 'nao_reconhecido' na conta iFood Pago — informativo (não soma).
  entrada_nao_reconhecida?: number;
  // true quando não há repasses importados (match pendente) mas há vendas.
  pendente_match?: boolean;
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

// Título de seção: linha laranja + título grande em serifa
function sectionTitle(doc: jsPDF, eyebrow: string, title: string, y: number) {
  // Eyebrow (pequeno texto laranja acima, em sans-serif uppercase)
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...PRIMARY);
  doc.text(eyebrow.toUpperCase(), PAGE_MARGIN, y);

  // Título principal em serifa pra dar peso clássico contábil
  doc.setFont(FONT_SERIF, 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...INK);
  doc.text(title, PAGE_MARGIN, y + 9);

  // Linha laranja decorativa
  doc.setDrawColor(...PRIMARY);
  doc.setLineWidth(0.8);
  doc.line(PAGE_MARGIN, y + 12.5, PAGE_MARGIN + 14, y + 12.5);

  return y + 18;
}

// Nota/alerta abaixo de tabelas (texto pequeno colorido, com wrap).
// Retorna o próximo y disponível.
function noteLine(doc: jsPDF, text: string, y: number, color: [number, number, number]) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFont(FONT, 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...color);
  const lines = doc.splitTextToSize(text, pageW - PAGE_MARGIN * 2);
  doc.text(lines, PAGE_MARGIN, y);
  return y + lines.length * 3.8 + 2;
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

// KPI box elegante. Auto-ajusta fontSize do valor pra caber na largura.
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

  // Valor principal — auto-ajusta fontSize (14 → 11) pra caber em w-8
  doc.setFont(FONT, 'bold');
  doc.setTextColor(...INK);
  let valueFontSize = 14;
  doc.setFontSize(valueFontSize);
  while (doc.getTextWidth(value) > w - 8 && valueFontSize > 9) {
    valueFontSize -= 0.5;
    doc.setFontSize(valueFontSize);
  }
  doc.text(value, x + 4, y + 13);

  // Hint (opcional)
  if (hint) {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...INK_MUTED);
    const lines = doc.splitTextToSize(hint, w - 6);
    doc.text(lines, x + 4, y + 18);
  }
}

// ═══ Página 1: Capa ════════════════════════════════════════════════════════
function coverPage(doc: jsPDF, data: ContabilPdfData, mode: 'resumido' | 'detalhado') {
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
  doc.setFontSize(8.5);
  doc.setTextColor(...WHITE);
  doc.text('RELATÓRIO CONTÁBIL', PAGE_MARGIN, 50);

  // Título principal grande em serifa (clássico contábil)
  doc.setFont(FONT_SERIF, 'bold');
  doc.setFontSize(30);
  doc.setTextColor(...WHITE);
  doc.text('Controle de Taxas', PAGE_MARGIN, 60);

  // Período em destaque (fora da faixa) — serifa, com tracking aberto
  doc.setFont(FONT_SERIF, 'bold');
  doc.setFontSize(38);
  doc.setTextColor(...INK);
  doc.text(data.periodLabel, PAGE_MARGIN, 96);

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

  const items: Array<[string, string, string]> = [
    ['1', 'Resumo Consolidado', '2'],
    ['2', 'Maquinona iFood', '3'],
    ['3', 'Vouchers', '4'],
    ['4', 'Brendi', '5'],
    ['5', 'iFood Marketplace', '6'],
  ];
  if (mode === 'detalhado') {
    items.push(['6', 'Detalhamento diário por categoria', '7+']);
  }
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
    // Taxa iFood = custo / faturamento total iFood (online + direto loja).
    // Já calculado em contabil-data-builder, reflete o universo iFood completo.
    rows.push([
      'iFood Marketplace',
      fmtInt(i.pedidos_count),
      fmtNum(i.vendido_bruto),
      fmtNum(i.liquido_efetivo),
      fmtNum(i.custo_total),
      fmtPct(i.taxa_efetiva_pct),
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

  styledTable(doc, y, ['Categoria', 'Qtd', 'Vendido', 'Recebido', 'Custo', '%'], rows, [50, 22, 32, 32, 28, 22]);

  // Alertas/notas abaixo da tabela
  let ny = (doc as any).lastAutoTable.finalY + 6;
  const negativos = data.resumoPorCategoria.filter(r => r.custo_negativo);
  if (negativos.length > 0) {
    ny = noteLine(doc, `⚠ Recebido maior que vendido em ${negativos.map(r => r.nome).join(', ')} — custo negativo, verificar conciliação.`, ny, NEGATIVE);
  }
  if (data.brendi?.custo_total != null && data.brendi.custo_total < -0.005) {
    ny = noteLine(doc, '⚠ Brendi: recebido maior que vendido — custo negativo, verificar conciliação.', ny, NEGATIVE);
  }
  if (data.ifood?.custo_total != null && data.ifood.custo_total < -0.005) {
    ny = noteLine(doc, '⚠ iFood: recebido maior que vendido — custo negativo, verificar conciliação.', ny, NEGATIVE);
  }
  const estimadas = data.resumoPorCategoria.filter(r => r.estimada);
  if (estimadas.length > 0) {
    ny = noteLine(doc, `⚠ Custo de ${estimadas.map(r => r.nome).join(', ')} inclui taxa estimada (provisão) — ver Seção 3.`, ny, PRIMARY_DARK);
  }
  if (data.brendi?.pendente_match || data.ifood?.pendente_match) {
    const quem = [data.brendi?.pendente_match ? 'Brendi' : null, data.ifood?.pendente_match ? 'iFood' : null]
      .filter(Boolean).join(' e ');
    noteLine(doc, `⚠ ${quem}: pendente de execução do match — recebido/custo ainda não conciliados.`, ny, PRIMARY_DARK);
  }
}

// ═══ Página 3: Maquinona iFood ═════════════════════════════════════════════
function pageMaquinona(doc: jsPDF, data: ContabilPdfData) {
  doc.addPage();
  pageHeader(doc, 'Maquinona iFood', 3);
  let y = sectionTitle(doc, 'Seção 2', 'Maquinona iFood', 22);

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

  styledTable(doc, y, ['Meio de pagamento', 'Qtd', 'Vendido', 'Recebido', 'Custo', '%'], rows, [50, 22, 32, 32, 28, 22]);

  const negativos = data.resumoPorCategoria
    .filter(r => cats.includes(r.categoria) && r.custo_negativo);
  if (negativos.length > 0) {
    noteLine(
      doc,
      `⚠ Recebido maior que vendido em ${negativos.map(r => r.nome).join(', ')} — custo negativo, verificar conciliação Cresol.`,
      (doc as any).lastAutoTable.finalY + 6,
      NEGATIVE,
    );
  }
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
  const comProvisao: ContabilResumoRow[] = [];
  for (const cat of cats) {
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r || (r.vendido === 0 && r.qtd === 0 && !r.estimada)) continue;
    // Linha da operadora mostra o custo APURADO (sem a provisão); a provisão
    // entra como linha própria logo abaixo — assim a soma da coluna fecha
    // com o TOTAL (que já inclui a provisão).
    const provisao = r.provisao_taxa ?? 0;
    const custoApurado = r.custo - provisao;
    const pct = r.vendido > 0 ? (custoApurado / r.vendido) * 100 : 0;
    rows.push([
      CATEGORIA_LABELS[cat],
      fmtInt(r.qtd),
      fmtNum(r.vendido),
      fmtNum(r.recebido),
      fmtNum(custoApurado),
      fmtPct(pct),
    ]);
    if (r.estimada && provisao > 0) {
      comProvisao.push(r);
      rows.push([
        `  ↳ Taxa estimada (provisão) ⚠`,
        '—', '—', '—',
        fmtNum(provisao),
        '—',
      ]);
    }
  }
  rows.push(['TOTAL', fmtInt(totQtd), fmtNum(totVendido), fmtNum(totRecebido), fmtNum(totCusto), fmtPct(totPct)]);

  styledTable(doc, y, ['Operadora', 'Qtd Vendas', 'Vendido', 'Recebido', 'Custo', '%'], rows, [50, 28, 32, 32, 28, 22]);

  // Notas abaixo da tabela
  let ny = (doc as any).lastAutoTable.finalY + 6;
  for (const r of comProvisao) {
    ny = noteLine(
      doc,
      `⚠ ${r.nome}: ${fmtBRL(r.vendas_pendentes ?? 0)} em vendas aguardando extrato da operadora — `
      + `taxa estimada pela média do mês (${fmtBRL(r.provisao_taxa ?? 0)}), pagamento pendente de confirmação.`,
      ny,
      PRIMARY_DARK,
    );
  }
  const negativos = data.resumoPorCategoria
    .filter(r => cats.includes(r.categoria) && r.custo_negativo);
  if (negativos.length > 0) {
    noteLine(
      doc,
      `⚠ Recebido maior que vendido em ${negativos.map(r => r.nome).join(', ')} — custo negativo, verificar conciliação BB.`,
      ny,
      NEGATIVE,
    );
  }
}

// ═══ Página 5: Brendi ══════════════════════════════════════════════════════
function pageBrendi(doc: jsPDF, data: ContabilPdfData) {
  if (!data.brendi) return;
  const b = data.brendi;
  doc.addPage();
  pageHeader(doc, 'Brendi', 5);
  let y = sectionTitle(doc, 'Seção 4', 'Brendi', 22);

  const pctTotal = b.vendido_bruto > 0 ? (b.custo_total / b.vendido_bruto) * 100 : 0;

  // KPIs
  const pageW = doc.internal.pageSize.getWidth();
  const kpiW = (pageW - PAGE_MARGIN * 2 - 8) / 3;
  kpiBox(doc, PAGE_MARGIN, y, kpiW, 24, 'Total bruto', fmtBRL(b.vendido_bruto), `${fmtInt(b.pedidos_count_mes)} pedidos no mês`);
  kpiBox(doc, PAGE_MARGIN + kpiW + 4, y, kpiW, 24, 'Total líquido', fmtBRL(b.recebido_bb), `${fmtInt(b.dias_uteis)} dias úteis com depósito`, POSITIVE);
  kpiBox(doc, PAGE_MARGIN + (kpiW + 4) * 2, y, kpiW, 24, 'Custo total', `${fmtBRL(b.custo_total)}  ·  ${fmtPct(pctTotal)}`, '', NEGATIVE);
  y += 32;

  if (b.pendente_match) {
    y = noteLine(doc, '⚠ Pendente de execução do match — recebido/custo oculto ainda não conciliados com o extrato BB. Execute pela aba Importações.', y, PRIMARY_DARK);
    y += 2;
  }
  if (b.custo_total < -0.005) {
    y = noteLine(doc, '⚠ Recebido maior que vendido — custo negativo, verificar conciliação.', y, NEGATIVE);
    y += 2;
  }

  // Breakdown
  y = subTitle(doc, 'Detalhamento de cobranças', y);

  // Mensalidade vem do campo dedicado; o resto do custo oculto (diffs de
  // match que não são mensalidade) entra como linha separada.
  const outrasDiffs = b.custo_oculto - b.mensalidade;
  const rows: any[] = [
    ['Taxas transacionais', fmtNum(b.taxa_declarada)],
    ['Mensalidade', fmtNum(b.mensalidade)],
    ['Outras diferenças de match', fmtNum(outrasDiffs)],
    ['TOTAL', fmtNum(b.custo_total)],
  ];

  styledTable(
    doc, y,
    ['Tipo de cobrança', 'Valor (R$)'],
    rows,
    [130, 50],
  );
}

// ═══ Página 6: iFood Marketplace ═══════════════════════════════════════════
function pageIfood(doc: jsPDF, data: ContabilPdfData) {
  if (!data.ifood) return;
  const i = data.ifood;
  doc.addPage();
  pageHeader(doc, 'iFood Marketplace', 6);
  let y = sectionTitle(doc, 'Seção 5', 'iFood Marketplace', 22);

  // KPIs
  const pageW = doc.internal.pageSize.getWidth();
  const kpiW = (pageW - PAGE_MARGIN * 2 - 8) / 3;
  kpiBox(doc, PAGE_MARGIN, y, kpiW, 24, 'Total bruto', fmtBRL(i.vendido_bruto), `${fmtInt(i.pedidos_count)} pedidos online`);
  kpiBox(doc, PAGE_MARGIN + kpiW + 4, y, kpiW, 24, 'Total líquido', fmtBRL(i.liquido_efetivo), `${i.repasses_count} repasses, após antecipação`, POSITIVE);
  kpiBox(doc, PAGE_MARGIN + (kpiW + 4) * 2, y, kpiW, 24, 'Custo total', `${fmtBRL(i.custo_total)}  ·  ${fmtPct(i.taxa_efetiva_pct)}`, 'Comissão + taxas + logística + Frota + ADS', NEGATIVE);
  y += 32;

  if (i.pendente_match) {
    y = noteLine(doc, '⚠ Pendente de execução do match — repasses ainda não importados/conciliados. Execute pela aba Importações.', y, PRIMARY_DARK);
    y += 2;
  }
  if (i.custo_total < -0.005) {
    y = noteLine(doc, '⚠ Recebido maior que vendido — custo negativo, verificar conciliação.', y, NEGATIVE);
    y += 2;
  }

  // Cross-reference: valor declarado pelo iFood no portal (subtotal + entrega)
  // — confronta com o (vendido_bruto + recebido_direto) que vem dos repasses.
  if (i.valor_vendas_portal > 0) {
    doc.setFont(FONT, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...INK_SECONDARY);
    const sistemaTotal = i.vendido_bruto + i.recebido_direto;
    const linha = `Valor das vendas no portal iFood: ${fmtBRL(i.valor_vendas_portal)}   ·   Sistema (online + direto loja): ${fmtBRL(sistemaTotal)}`;
    doc.text(linha, PAGE_MARGIN, y);
    y += 6;
  }

  // Breakdown
  y = subTitle(doc, 'Detalhamento de cobranças', y);

  // Soma das taxas brutas declaradas pelo iFood
  const somaTaxasBrutas = Math.abs(i.comissao) + Math.abs(i.taxa_transacao)
    + Math.abs(i.taxa_antecipacao) + Math.abs(i.taxa_conveniencia)
    + Math.abs(i.mensalidade) + Math.abs(i.frete) + Math.abs(i.taxa_entrega_ret)
    + Math.abs(i.taxa_servico_sob_demanda) + Math.abs(i.frota_garantida ?? 0)
    + Math.abs(i.ads);
  // Ajustes positivos = soma das taxas brutas − custo real (vendido − líq efetivo).
  // Reflete reembolsos/ressarc/promo iFood/cancelamentos que retornam pra loja
  // depois das taxas brutas.
  const ajustesPositivos = Math.max(0, somaTaxasBrutas - i.custo_total);

  const breakdown: any[] = [
    ['Comissão iFood', fmtNum(Math.abs(i.comissao))],
    ['Taxa de transação', fmtNum(Math.abs(i.taxa_transacao))],
    ['Taxa de antecipação', fmtNum(Math.abs(i.taxa_antecipacao))],
    ['Taxa conveniência (parcelado)', fmtNum(Math.abs(i.taxa_conveniencia))],
    ['Mensalidade', fmtNum(Math.abs(i.mensalidade))],
    ['Frete iFood', fmtNum(Math.abs(i.frete))],
    ['Taxa entrega retenção', fmtNum(Math.abs(i.taxa_entrega_ret))],
    ['Taxa serviço Sob Demanda Off', fmtNum(Math.abs(i.taxa_servico_sob_demanda))],
    ['Frota Garantida', fmtNum(Math.abs(i.frota_garantida ?? 0))],
    ['ADS (anúncios)', fmtNum(Math.abs(i.ads))],
  ];
  if (ajustesPositivos > 0.01) {
    // Helvetica do jsPDF não suporta U+2212 (minus matemático) — vira `("`
    // no rendering. Usar hífen ASCII U+002D que sempre renderiza.
    breakdown.push([
      '(-) Ajustes positivos (estornos / reembolsos / ressarc / promo iFood)',
      `-${fmtNum(ajustesPositivos)}`,
    ]);
  }
  breakdown.push(['TOTAL', fmtNum(i.custo_total)]);

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
  if ((i.entrada_nao_reconhecida ?? 0) > 0) {
    informativo.push(['Entrada não reconhecida (conta iFood)', fmtNum(i.entrada_nao_reconhecida ?? 0)]);
  }

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
  compact: boolean = false,
) {
  // Modo compacto: usado nas tabelas diárias (até 31+1 linhas) pra caber em
  // uma página A4 portrait sem quebra. Reduz fonte e padding mantendo legibilidade.
  const styles = compact
    ? { fontSize: 7, cellPadding: { top: 0.9, right: 2.5, bottom: 0.9, left: 2.5 } }
    : { fontSize: 9.5, cellPadding: { top: 2.5, right: 3, bottom: 2.5, left: 3 } };
  const headStylesPad = compact
    ? { top: 1.2, right: 2.5, bottom: 1.6, left: 2.5 }
    : { top: 2, right: 3, bottom: 3, left: 3 };

  autoTable(doc, {
    startY,
    head: [headers],
    body: rows,
    theme: 'plain',
    pageBreak: 'avoid' as any,
    styles: {
      font: FONT,
      fontSize: styles.fontSize,
      cellPadding: styles.cellPadding,
      textColor: INK,
      lineColor: RULE,
      lineWidth: 0,
    },
    headStyles: {
      fillColor: WHITE,
      textColor: INK_MUTED,
      fontStyle: 'bold',
      fontSize: compact ? 6.5 : 7.5,
      cellPadding: headStylesPad,
      lineWidth: { bottom: 0.4 },
      lineColor: RULE_DARK,
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
      if (h.section === 'head') {
        h.cell.styles.halign = h.column.index === 0 ? 'left' : 'right';
        return;
      }
      if (h.section === 'body' && h.row.index === rows.length - 1) {
        h.cell.styles.fillColor = TOTAL_BG;
        h.cell.styles.fontStyle = 'bold';
        h.cell.styles.lineWidth = { top: 0.4, bottom: 0.4 };
        h.cell.styles.lineColor = INK;
      } else if (h.section === 'body') {
        if (h.row.index % 2 === 1) {
          h.cell.styles.fillColor = SUBTLE_BG;
        }
        h.cell.styles.lineWidth = { bottom: 0.1 };
        h.cell.styles.lineColor = RULE;
      }
    },
  });
}

// ═══ Detalhamento diário (modo detalhado) ═════════════════════════════════
// Uma página dedicada por categoria, no mesmo padrão visual do resumido:
// header da seção + 3 KPIs no topo + tabela diária estilizada com TOTAL.

const SECTION_INDEX: Record<ContabilCategoria, number> = {
  credito: 6, debito: 7, pix: 8, brendi: 9, alelo: 10, ticket: 11, vr: 12, pluxee: 13,
};

function pageDetalheCategoria(
  doc: jsPDF,
  categoria: ContabilCategoria,
  dias: ContabilDiaRow[],
  monthDays: number,
  pageNum: number,
) {
  const byDay = new Map(dias.map(d => [d.dia, d]));
  const rows: any[] = [];
  let totQtd = 0, totVendido = 0, totRecebido = 0, totCusto = 0;
  for (let d = 1; d <= monthDays; d++) {
    const row = byDay.get(d);
    const qtd = row?.qtd ?? 0;
    const vendido = row?.vendido ?? 0;
    const recebido = row?.recebido ?? 0;
    const custo = Math.abs(row?.custo ?? 0);
    totQtd += qtd; totVendido += vendido; totRecebido += recebido; totCusto += custo;
    if (qtd === 0 && vendido === 0 && custo === 0) continue; // pula dias sem movimento
    const pct = vendido > 0 ? (custo / vendido) * 100 : 0;
    rows.push([
      String(d).padStart(2, '0'),
      fmtInt(qtd),
      fmtNum(vendido),
      fmtNum(recebido),
      fmtNum(custo),
      fmtPct(pct),
    ]);
  }
  const totPct = totVendido > 0 ? (totCusto / totVendido) * 100 : 0;
  rows.push([
    'TOTAL',
    fmtInt(totQtd),
    fmtNum(totVendido),
    fmtNum(totRecebido),
    fmtNum(totCusto),
    fmtPct(totPct),
  ]);

  doc.addPage();
  pageHeader(doc, `Detalhamento — ${CATEGORIA_LABELS[categoria]}`, pageNum);
  const sectionNum = SECTION_INDEX[categoria];
  let y = sectionTitle(doc, `Seção ${sectionNum}`, `${CATEGORIA_LABELS[categoria]} — diário`, 22);

  // 3 KPIs no padrão das outras seções
  const pageW = doc.internal.pageSize.getWidth();
  const kpiW = (pageW - PAGE_MARGIN * 2 - 8) / 3;
  kpiBox(doc, PAGE_MARGIN, y, kpiW, 24, 'Total vendido', fmtBRL(totVendido), `${fmtInt(totQtd)} transações`);
  kpiBox(doc, PAGE_MARGIN + kpiW + 4, y, kpiW, 24, 'Total recebido', fmtBRL(totRecebido), '', POSITIVE);
  kpiBox(doc, PAGE_MARGIN + (kpiW + 4) * 2, y, kpiW, 24, 'Custo total', `${fmtBRL(totCusto)}  ·  ${fmtPct(totPct)}`, '', NEGATIVE);
  y += 32;

  // Tabela diária — compacta pra caber em 1 página A4 (até ~32 linhas)
  y = subTitle(doc, 'Movimento dia a dia', y);
  styledTable(doc, y, ['Dia', 'Qtd', 'Vendido', 'Recebido', 'Custo', '%'], rows, [22, 22, 35, 35, 32, 22], true);
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
  for (const cat of ativas) {
    const dias = detalhe.find(x => x.categoria === cat)?.dias ?? [];
    pageDetalheCategoria(doc, cat, dias, data.monthDays, pageNum);
    pageNum++;
  }
}

export function generateContabilPdf(
  mode: 'resumido' | 'detalhado',
  data: ContabilPdfData,
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  // Página 1: Capa
  coverPage(doc, data, mode);
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
