// Renderiza o relatório contábil em HTML, com a mesma estrutura e dados do PDF.
// Usado na aba Relatórios pra visualizar o conteúdo sem precisar baixar o arquivo.

import { type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  CATEGORIAS_ORDEM,
  CATEGORIA_LABELS,
  type ContabilCategoria,
  type ContabilPdfData,
  type ContabilDiaRow,
} from '@/lib/audit-pdf-contabil';

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number, decimals = 2) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const fmtPct = (v: number) => `${fmtNum(v)}%`;
const fmtInt = (v: number) => v.toLocaleString('pt-BR');

type KpiTone = 'default' | 'positive' | 'negative';

function Kpi({ eyebrow, value, hint, tone = 'default' }: {
  eyebrow: string; value: string; hint?: string; tone?: KpiTone;
}) {
  const accentClass = tone === 'positive'
    ? 'border-l-green-600 dark:border-l-green-400'
    : tone === 'negative'
    ? 'border-l-rose-600 dark:border-l-rose-400'
    : 'border-l-primary';
  return (
    <div className={cn('rounded-md border bg-card pl-3 pr-3 py-3 border-l-[3px]', accentClass)}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{eyebrow}</div>
      <div className="text-lg font-bold mt-1">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-primary">{eyebrow}</div>
      <h2 className="font-serif text-3xl font-bold mt-1 tracking-tight">{title}</h2>
      <div className="h-0.5 w-14 bg-primary mt-2" />
    </div>
  );
}

function SubHeader({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-bold uppercase tracking-wide text-foreground border-b border-border pb-1 mb-2 inline-block">
      {children}
    </div>
  );
}

type Col = { label: string; align?: 'left' | 'right'; width?: string };

function StyledTable({ columns, rows }: { columns: Col[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-foreground/40">
            {columns.map((c, i) => (
              <th
                key={i}
                className={cn(
                  'py-1.5 px-2 text-[10px] uppercase font-bold text-muted-foreground',
                  c.align === 'right' ? 'text-right' : 'text-left',
                )}
                style={c.width ? { width: c.width } : undefined}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isTotal = String(row[0]).trim().toUpperCase() === 'TOTAL';
            return (
              <tr
                key={ri}
                className={cn(
                  'border-b border-border/50',
                  isTotal && 'bg-muted/60 font-bold border-t-2 border-foreground/40 border-b-foreground/40',
                  !isTotal && ri % 2 === 1 && 'bg-muted/20',
                )}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className={cn(
                      'py-1.5 px-2',
                      columns[ci].align === 'right' ? 'text-right' : 'text-left',
                      ci === 0 && 'font-medium',
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══ Página: Resumo Consolidado ═══════════════════════════════════════════
function PageResumo({ data }: { data: ContabilPdfData }) {
  const baseSum = data.resumoPorCategoria.reduce((acc, r) => ({
    qtd: acc.qtd + r.qtd, vendido: acc.vendido + r.vendido, recebido: acc.recebido + r.recebido, custo: acc.custo + r.custo,
  }), { qtd: 0, vendido: 0, recebido: 0, custo: 0 });
  const brSum = data.brendi ? {
    qtd: data.brendi.pedidos_count_mes, vendido: data.brendi.vendido_bruto,
    recebido: data.brendi.recebido_bb, custo: data.brendi.custo_total,
  } : { qtd: 0, vendido: 0, recebido: 0, custo: 0 };
  const ifSum = data.ifood ? {
    qtd: data.ifood.pedidos_count, vendido: data.ifood.vendido_bruto,
    recebido: data.ifood.liquido_efetivo, custo: data.ifood.custo_total,
  } : { qtd: 0, vendido: 0, recebido: 0, custo: 0 };
  const totQtd = baseSum.qtd + brSum.qtd + ifSum.qtd;
  const totVendido = baseSum.vendido + brSum.vendido + ifSum.vendido;
  const totRecebido = baseSum.recebido + brSum.recebido + ifSum.recebido;
  const totCusto = baseSum.custo + brSum.custo + ifSum.custo;
  const totPct = totVendido > 0 ? (totCusto / totVendido) * 100 : 0;

  const rows: (string | number)[][] = [];
  for (const cat of CATEGORIAS_ORDEM) {
    if (cat === 'brendi') {
      if (data.brendi) {
        const b = data.brendi;
        const pct = b.vendido_bruto > 0 ? (b.custo_total / b.vendido_bruto) * 100 : 0;
        rows.push(['Brendi (online)', fmtInt(b.pedidos_count_mes), fmtNum(b.vendido_bruto), fmtNum(b.recebido_bb), fmtNum(b.custo_total), fmtPct(pct)]);
      }
      continue;
    }
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r || (r.vendido === 0 && r.qtd === 0)) continue;
    const pct = r.vendido > 0 ? (r.custo / r.vendido) * 100 : 0;
    rows.push([CATEGORIA_LABELS[cat], fmtInt(r.qtd), fmtNum(r.vendido), fmtNum(r.recebido), fmtNum(r.custo), fmtPct(pct)]);
  }
  if (data.ifood) {
    const i = data.ifood;
    // Taxa iFood = custo / faturamento total iFood (online + direto loja).
    rows.push(['iFood Marketplace', fmtInt(i.pedidos_count), fmtNum(i.vendido_bruto), fmtNum(i.liquido_efetivo), fmtNum(i.custo_total), fmtPct(i.taxa_efetiva_pct)]);
  }
  rows.push(['TOTAL', fmtInt(totQtd), fmtNum(totVendido), fmtNum(totRecebido), fmtNum(totCusto), fmtPct(totPct)]);

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <SectionHeader eyebrow="Seção 1" title="Resumo Consolidado" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Kpi eyebrow="Faturamento bruto" value={fmtBRL(totVendido)} hint={`${fmtInt(totQtd)} transações no período`} />
          <Kpi eyebrow="Líquido efetivo" value={fmtBRL(totRecebido)} hint="Após custos e antecipações" tone="positive" />
          <Kpi eyebrow="Custo total" value={`${fmtBRL(totCusto)} · ${fmtPct(totPct)}`} hint="Taxa efetiva sobre faturamento bruto" tone="negative" />
        </div>
        <div>
          <SubHeader>Detalhamento por categoria</SubHeader>
          <StyledTable
            columns={[
              { label: 'Categoria', align: 'left' },
              { label: 'Qtd', align: 'right' },
              { label: 'Vendido', align: 'right' },
              { label: 'Recebido', align: 'right' },
              { label: 'Custo', align: 'right' },
              { label: '%', align: 'right' },
            ]}
            rows={rows}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ═══ Página: Maquinona iFood ═══════════════════════════════════════════════
function PageMaquinona({ data }: { data: ContabilPdfData }) {
  const cats = ['credito', 'debito', 'pix'] as ContabilCategoria[];
  let totQtd = 0, totVendido = 0, totRecebido = 0, totCusto = 0;
  const rows: (string | number)[][] = [];
  for (const cat of cats) {
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r) continue;
    const pct = r.vendido > 0 ? (r.custo / r.vendido) * 100 : 0;
    rows.push([CATEGORIA_LABELS[cat], fmtInt(r.qtd), fmtNum(r.vendido), fmtNum(r.recebido), fmtNum(r.custo), fmtPct(pct)]);
    totQtd += r.qtd; totVendido += r.vendido; totRecebido += r.recebido; totCusto += r.custo;
  }
  const totPct = totVendido > 0 ? (totCusto / totVendido) * 100 : 0;
  rows.push(['TOTAL', fmtInt(totQtd), fmtNum(totVendido), fmtNum(totRecebido), fmtNum(totCusto), fmtPct(totPct)]);

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <SectionHeader eyebrow="Seção 2" title="Maquinona iFood" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Kpi eyebrow="Total vendido" value={fmtBRL(totVendido)} hint={`${fmtInt(totQtd)} transações`} />
          <Kpi eyebrow="Total recebido" value={fmtBRL(totRecebido)} hint="Cresol — depósitos pareados" tone="positive" />
          <Kpi eyebrow="Custo total" value={`${fmtBRL(totCusto)} · ${fmtPct(totPct)}`} tone="negative" />
        </div>
        <div>
          <SubHeader>Detalhamento por meio de pagamento</SubHeader>
          <StyledTable
            columns={[
              { label: 'Meio de pagamento', align: 'left' },
              { label: 'Qtd', align: 'right' },
              { label: 'Vendido', align: 'right' },
              { label: 'Recebido', align: 'right' },
              { label: 'Custo', align: 'right' },
              { label: '%', align: 'right' },
            ]}
            rows={rows}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ═══ Página: Vouchers ══════════════════════════════════════════════════════
function PageVouchers({ data }: { data: ContabilPdfData }) {
  const cats = ['alelo', 'ticket', 'vr', 'pluxee'] as ContabilCategoria[];
  let totQtd = 0, totVendido = 0, totRecebido = 0, totCusto = 0;
  const rows: (string | number)[][] = [];
  for (const cat of cats) {
    const r = data.resumoPorCategoria.find(x => x.categoria === cat);
    if (!r || (r.vendido === 0 && r.qtd === 0)) continue;
    const pct = r.vendido > 0 ? (r.custo / r.vendido) * 100 : 0;
    rows.push([CATEGORIA_LABELS[cat], fmtInt(r.qtd), fmtNum(r.vendido), fmtNum(r.recebido), fmtNum(r.custo), fmtPct(pct)]);
    totQtd += r.qtd; totVendido += r.vendido; totRecebido += r.recebido; totCusto += r.custo;
  }
  const totPct = totVendido > 0 ? (totCusto / totVendido) * 100 : 0;
  rows.push(['TOTAL', fmtInt(totQtd), fmtNum(totVendido), fmtNum(totRecebido), fmtNum(totCusto), fmtPct(totPct)]);

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <SectionHeader eyebrow="Seção 3" title="Vouchers" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Kpi eyebrow="Total vendido" value={fmtBRL(totVendido)} hint={`${fmtInt(totQtd)} vendas`} />
          <Kpi eyebrow="Total recebido" value={fmtBRL(totRecebido)} hint="Depósitos pareados no BB" tone="positive" />
          <Kpi eyebrow="Custo total" value={`${fmtBRL(totCusto)} · ${fmtPct(totPct)}`} tone="negative" />
        </div>
        <div>
          <SubHeader>Detalhamento por operadora</SubHeader>
          <StyledTable
            columns={[
              { label: 'Operadora', align: 'left' },
              { label: 'Qtd Vendas', align: 'right' },
              { label: 'Vendido', align: 'right' },
              { label: 'Recebido', align: 'right' },
              { label: 'Custo', align: 'right' },
              { label: '%', align: 'right' },
            ]}
            rows={rows}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ═══ Página: Brendi ═══════════════════════════════════════════════════════
function PageBrendi({ data }: { data: ContabilPdfData }) {
  if (!data.brendi) return null;
  const b = data.brendi;
  const pctTotal = b.vendido_bruto > 0 ? (b.custo_total / b.vendido_bruto) * 100 : 0;
  const rows: (string | number)[][] = [
    ['Taxas transacionais', fmtNum(b.taxa_declarada)],
    ['Mensalidade', fmtNum(b.custo_oculto)],
    ['TOTAL', fmtNum(b.custo_total)],
  ];
  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <SectionHeader eyebrow="Seção 4" title="Brendi" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Kpi eyebrow="Total bruto" value={fmtBRL(b.vendido_bruto)} hint={`${fmtInt(b.pedidos_count_mes)} pedidos no mês`} />
          <Kpi eyebrow="Total líquido" value={fmtBRL(b.recebido_bb)} hint={`${fmtInt(b.dias_uteis)} dias úteis com depósito`} tone="positive" />
          <Kpi eyebrow="Custo total" value={`${fmtBRL(b.custo_total)} · ${fmtPct(pctTotal)}`} tone="negative" />
        </div>
        <div>
          <SubHeader>Detalhamento de cobranças</SubHeader>
          <StyledTable
            columns={[
              { label: 'Tipo de cobrança', align: 'left' },
              { label: 'Valor (R$)', align: 'right' },
            ]}
            rows={rows}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ═══ Página: iFood Marketplace ═════════════════════════════════════════════
function PageIfood({ data }: { data: ContabilPdfData }) {
  if (!data.ifood) return null;
  const i = data.ifood;

  const somaTaxasBrutas = Math.abs(i.comissao) + Math.abs(i.taxa_transacao)
    + Math.abs(i.taxa_antecipacao) + Math.abs(i.taxa_conveniencia)
    + Math.abs(i.mensalidade) + Math.abs(i.frete) + Math.abs(i.taxa_entrega_ret)
    + Math.abs(i.taxa_servico_sob_demanda) + Math.abs(i.ads);
  const ajustesPositivos = Math.max(0, somaTaxasBrutas - i.custo_total);
  const breakdown: (string | number)[][] = [
    ['Comissão iFood', fmtNum(Math.abs(i.comissao))],
    ['Taxa de transação', fmtNum(Math.abs(i.taxa_transacao))],
    ['Taxa de antecipação', fmtNum(Math.abs(i.taxa_antecipacao))],
    ['Taxa conveniência (parcelado)', fmtNum(Math.abs(i.taxa_conveniencia))],
    ['Mensalidade', fmtNum(Math.abs(i.mensalidade))],
    ['Frete iFood', fmtNum(Math.abs(i.frete))],
    ['Taxa entrega retenção', fmtNum(Math.abs(i.taxa_entrega_ret))],
    ['Taxa serviço Sob Demanda Off', fmtNum(Math.abs(i.taxa_servico_sob_demanda))],
    ['ADS (anúncios)', fmtNum(Math.abs(i.ads))],
  ];
  if (ajustesPositivos > 0.01) {
    breakdown.push([
      '(−) Ajustes positivos (estornos / reembolsos / ressarc / promo iFood)',
      `−${fmtNum(ajustesPositivos)}`,
    ]);
  }
  breakdown.push(['TOTAL', fmtNum(i.custo_total)]);
  const informativo: [string, string][] = [
    ['Cancelamentos (total)', fmtNum(Math.abs(i.cancel_total))],
    ['Cancelamentos (parcial)', fmtNum(Math.abs(i.cancel_parcial))],
    ['Reembolsos pra loja', fmtNum(i.reembolsos)],
    ['Ressarcimentos', fmtNum(i.ressarc)],
    ['Promo iFood (devolução)', fmtNum(i.promo_ifood)],
    ['Taxa serviço cliente (retido)', fmtNum(Math.abs(i.taxa_servico_cliente))],
    ['Promoções loja (subsídio absorvido)', fmtNum(Math.abs(i.promocoes_loja))],
    ['Pgto direto loja (dinheiro/maquinininha)', fmtNum(i.recebido_direto)],
  ];

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <SectionHeader eyebrow="Seção 5" title="iFood Marketplace" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Kpi eyebrow="Total bruto" value={fmtBRL(i.vendido_bruto)} hint={`${fmtInt(i.pedidos_count)} pedidos online`} />
          <Kpi eyebrow="Total líquido" value={fmtBRL(i.liquido_efetivo)} hint={`${i.repasses_count} repasses, após antecipação`} tone="positive" />
          <Kpi eyebrow="Custo total" value={`${fmtBRL(i.custo_total)} · ${fmtPct(i.taxa_efetiva_pct)}`} tone="negative" />
        </div>
        <div>
          <SubHeader>Detalhamento de cobranças</SubHeader>
          <StyledTable
            columns={[
              { label: 'Tipo de cobrança', align: 'left' },
              { label: 'Valor (R$)', align: 'right' },
            ]}
            rows={breakdown}
          />
        </div>
        <div>
          <SubHeader>Informativo (não soma no custo)</SubHeader>
          <div className="text-sm">
            {informativo.map(([label, val], idx) => (
              <div key={idx} className="flex justify-between border-b border-border/30 py-1 text-muted-foreground">
                <span>{label}</span>
                <span className="tabular-nums">{val}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══ Página: Detalhe diário (modo detalhado) ═══════════════════════════════
const SECTION_INDEX: Record<ContabilCategoria, number> = {
  credito: 6, debito: 7, pix: 8, brendi: 9, alelo: 10, ticket: 11, vr: 12, pluxee: 13,
};

function PageDetalheCategoria({ categoria, dias, monthDays }: {
  categoria: ContabilCategoria; dias: ContabilDiaRow[]; monthDays: number;
}) {
  const byDay = new Map(dias.map(d => [d.dia, d]));
  const rows: (string | number)[][] = [];
  let totQtd = 0, totVendido = 0, totRecebido = 0, totCusto = 0;
  for (let d = 1; d <= monthDays; d++) {
    const row = byDay.get(d);
    const qtd = row?.qtd ?? 0;
    const vendido = row?.vendido ?? 0;
    const recebido = row?.recebido ?? 0;
    const custo = Math.abs(row?.custo ?? 0);
    totQtd += qtd; totVendido += vendido; totRecebido += recebido; totCusto += custo;
    if (qtd === 0 && vendido === 0 && custo === 0) continue;
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
  rows.push(['TOTAL', fmtInt(totQtd), fmtNum(totVendido), fmtNum(totRecebido), fmtNum(totCusto), fmtPct(totPct)]);

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <SectionHeader
          eyebrow={`Seção ${SECTION_INDEX[categoria]}`}
          title={`${CATEGORIA_LABELS[categoria]} — diário`}
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Kpi eyebrow="Total vendido" value={fmtBRL(totVendido)} hint={`${fmtInt(totQtd)} transações`} />
          <Kpi eyebrow="Total recebido" value={fmtBRL(totRecebido)} tone="positive" />
          <Kpi eyebrow="Custo total" value={`${fmtBRL(totCusto)} · ${fmtPct(totPct)}`} tone="negative" />
        </div>
        <div>
          <SubHeader>Movimento dia a dia</SubHeader>
          <StyledTable
            columns={[
              { label: 'Dia', align: 'left', width: '8%' },
              { label: 'Qtd', align: 'right', width: '10%' },
              { label: 'Vendido', align: 'right' },
              { label: 'Recebido', align: 'right' },
              { label: 'Custo', align: 'right' },
              { label: '%', align: 'right', width: '10%' },
            ]}
            rows={rows}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ═══ Componente principal ═════════════════════════════════════════════════
export function ContabilReportView({ data, mode }: { data: ContabilPdfData; mode: 'resumido' | 'detalhado' }) {
  const detalhe = data.detalhamentoDiario ?? [];
  const ativasDetalhe = CATEGORIAS_ORDEM.filter(cat => {
    if (cat === 'brendi') return false;
    const d = detalhe.find(x => x.categoria === cat);
    if (!d) return false;
    return d.dias.some(r => r.qtd > 0 || r.vendido > 0);
  });
  return (
    <div className="space-y-3">
      <PageResumo data={data} />
      <PageMaquinona data={data} />
      <PageVouchers data={data} />
      <PageBrendi data={data} />
      <PageIfood data={data} />
      {mode === 'detalhado' && ativasDetalhe.map(cat => {
        const dias = detalhe.find(x => x.categoria === cat)?.dias ?? [];
        return (
          <PageDetalheCategoria
            key={cat}
            categoria={cat}
            dias={dias}
            monthDays={data.monthDays}
          />
        );
      })}
    </div>
  );
}
