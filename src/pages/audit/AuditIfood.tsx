import { useEffect, useMemo, useState, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/hooks/useAuth';
import { generateAuditPdf, periodFileTag, periodLabel as makePeriodLabel } from '@/lib/audit-pdf';
import { fetchAllPaginated } from '@/lib/supabase-pagination';
import { ArrowLeft, Download, FileDown, Loader2 } from 'lucide-react';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const STATUS_BG: Record<string, string> = {
  matched: 'bg-green-500/10',
  cluster_matched: 'bg-green-500/10',
  partial: 'bg-yellow-500/10',
  cluster_partial: 'bg-yellow-500/10',
  pending: 'bg-orange-500/10',
  missing_deposit: 'bg-red-500/10',
  extra_deposit: 'bg-blue-500/10',
};

const STATUS_LABEL: Record<string, string> = {
  matched: '🟢 OK',
  cluster_matched: '🟢 OK (cluster)',
  partial: '🟡 Parcial',
  cluster_partial: '🟡 Parcial (cluster)',
  pending: '🟠 Aguardando depósito',
  missing_deposit: '🔴 Sem depósito',
  extra_deposit: '🔵 Depósito extra',
};

type LotMatch = {
  tipo: 'PIX' | 'CARD';
  count: number;
  bruto: number;
  liq: number;
  cresol_date?: string;
  cresol_amount?: number;
  diff?: number;
  matched: boolean;
};

type MatchRow = {
  match_date: string;
  expected_amount: number;
  deposited_amount: number;
  difference: number;
  transaction_count: number;
  deposit_count: number;
  status: string;
  gross: number;
  tax: number;
  lots: LotMatch[]; // breakdown PIX + CARD com cresol pareado
};

export default function AuditIfood() {
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const periodId = params.get('period');
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodLabel, setPeriodLabel] = useState('');
  const [periodMY, setPeriodMY] = useState<{ month: number; year: number } | null>(null);

  const [headerTotals, setHeaderTotals] = useState({ expected: 0, deposited: 0 });
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [unmatchedCresolDeps, setUnmatchedCresolDeps] = useState<Array<{ date: string; amount: number }>>([]);

  useEffect(() => {
    if (!isAdmin || !periodId) return;
    (async () => {
      setLoading(true);

      // Carrega TODAS as transações Maquinona iFood + TODOS os depósitos Cresol
      // do audit_period (inclui meses adjacentes pra match valor-a-valor).
      const fetchAllIfoodTxs = () =>
        fetchAllPaginated<any>(
          supabase
            .from('audit_card_transactions')
            .select('sale_date,payment_method,gross_amount,net_amount')
            .eq('audit_period_id', periodId!)
            .eq('deposit_group', 'ifood'),
        );
      const fetchAllCresolDeps = () =>
        fetchAllPaginated<any>(
          supabase
            .from('audit_bank_deposits')
            .select('id,deposit_date,amount,description')
            .eq('audit_period_id', periodId!)
            .eq('bank', 'cresol')
            .eq('category', 'ifood'),
        );

      const [
        { data: period },
        txs,
        cresolDeps,
      ] = await Promise.all([
        supabase.from('audit_periods').select('month,year').eq('id', periodId).maybeSingle(),
        fetchAllIfoodTxs(),
        fetchAllCresolDeps(),
      ]);

      if (period) {
        const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        setPeriodLabel(`${months[(period as any).month - 1]}/${(period as any).year}`);
        setPeriodMY({ month: (period as any).month, year: (period as any).year });
      }
      const periodMonth = (period as any)?.month;
      const periodYear = (period as any)?.year;

      // Agrupa Maquinona em lotes (sale_date × tipo PIX/CARD)
      type LotInternal = { sale_date: string; tipo: 'PIX'|'CARD'; bruto: number; liq: number; count: number };
      const lotsMap = new Map<string, LotInternal>();
      for (const t of (txs as any[]) ?? []) {
        const sd = String(t.sale_date);
        const method = String(t.payment_method ?? '').toUpperCase();
        const tipo: 'PIX'|'CARD' = method === 'PIX' ? 'PIX' : 'CARD';
        const key = `${sd}|${tipo}`;
        const lot = lotsMap.get(key) ?? { sale_date: sd, tipo, bruto: 0, liq: 0, count: 0 };
        lot.bruto += Number(t.gross_amount || 0);
        lot.liq += Number(t.net_amount || 0);
        lot.count += 1;
        lotsMap.set(key, lot);
      }
      const lotsArr: LotInternal[] = Array.from(lotsMap.values());

      // Match valor-a-valor (replica algoritmo do run-audit-match):
      // tolerance 10%, janela 14d, lotes maiores primeiro
      const depPool: Array<{ id: string; date: string; amount: number; matched: boolean }> =
        ((cresolDeps as any[]) ?? []).map(d => ({
          id: d.id, date: String(d.deposit_date), amount: Number(d.amount || 0), matched: false,
        }));
      const addDays = (iso: string, n: number) => {
        const d = new Date(iso + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
      };
      const lotsForMatch = [...lotsArr].sort((a, b) => b.liq - a.liq);
      const lotResults: Array<LotInternal & { cresol_date?: string; cresol_amount?: number; diff?: number; matched: boolean }> = [];
      for (const lot of lotsForMatch) {
        const maxDate = addDays(lot.sale_date, 14);
        let best: typeof depPool[0] | null = null;
        let bestPct = 999;
        for (const dep of depPool) {
          if (dep.matched) continue;
          if (dep.date < lot.sale_date) continue;
          if (dep.date > maxDate) continue;
          const diffPct = lot.liq > 0 ? Math.abs(dep.amount - lot.liq) / lot.liq : 999;
          if (diffPct < 0.10 && diffPct < bestPct) {
            best = dep;
            bestPct = diffPct;
          }
        }
        if (best) {
          best.matched = true;
          lotResults.push({ ...lot, cresol_date: best.date, cresol_amount: best.amount, diff: best.amount - lot.liq, matched: true });
        } else {
          lotResults.push({ ...lot, matched: false });
        }
      }

      // Agrupa lotes por sale_date pra montar as rows da tabela
      const lotsBySaleDate = new Map<string, LotMatch[]>();
      for (const lr of lotResults) {
        const arr = lotsBySaleDate.get(lr.sale_date) ?? [];
        arr.push({
          tipo: lr.tipo,
          count: lr.count,
          bruto: lr.bruto,
          liq: lr.liq,
          cresol_date: lr.cresol_date,
          cresol_amount: lr.cresol_amount,
          diff: lr.diff,
          matched: lr.matched,
        });
        lotsBySaleDate.set(lr.sale_date, arr);
      }

      // Monta rows agregadas (1 por sale_date), filtradas pelo mês do período
      const enriched: MatchRow[] = [];
      for (const [sd, lots] of lotsBySaleDate) {
        const [y, m] = sd.split('-').map(Number);
        if (periodMonth && (y !== periodYear || m !== periodMonth)) continue;
        const matchedLots = lots.filter(l => l.matched);
        const expected = lots.reduce((s, l) => s + l.liq, 0);
        const expectedMatched = matchedLots.reduce((s, l) => s + l.liq, 0);
        const deposited = matchedLots.reduce((s, l) => s + (l.cresol_amount ?? 0), 0);
        const diff = deposited - expectedMatched;
        const tolerance = Math.max(1, expectedMatched * 0.005);
        let status: string;
        if (matchedLots.length === 0) status = 'pending';
        else if (matchedLots.length < lots.length) status = 'partial';
        else if (Math.abs(diff) <= tolerance) status = 'matched';
        else status = 'partial';
        const bruto = lots.reduce((s, l) => s + l.bruto, 0);
        const tax = bruto - expected;
        enriched.push({
          match_date: sd,
          expected_amount: expected,
          deposited_amount: deposited,
          difference: diff,
          transaction_count: lots.reduce((s, l) => s + l.count, 0),
          deposit_count: matchedLots.length,
          status,
          gross: bruto,
          tax: Math.max(tax, 0),
          lots: lots.sort((a, b) => a.tipo.localeCompare(b.tipo)),
        });
      }
      enriched.sort((a, b) => a.match_date.localeCompare(b.match_date));
      setRows(enriched);

      const totalExpected = enriched.reduce((s, r) => s + r.expected_amount, 0);
      const totalDeposited = enriched.reduce((s, r) => s + r.deposited_amount, 0);
      setHeaderTotals({ expected: totalExpected, deposited: totalDeposited });

      // Lista depósitos Cresol não pareados (outro lado do cruzamento)
      // Filtra só os do mês de competência pra não poluir.
      const unmatchedDeps = depPool
        .filter(d => !d.matched)
        .filter(d => {
          const [y, m] = d.date.split('-').map(Number);
          return !periodMonth || (y === periodYear && m === periodMonth);
        })
        .sort((a, b) => a.date.localeCompare(b.date));
      setUnmatchedCresolDeps(unmatchedDeps.map(d => ({ date: d.date, amount: d.amount })));

      setLoading(false);
    })();
  }, [periodId, isAdmin]);

  const totals = useMemo(() => {
    const expected = headerTotals.expected;
    const deposited = headerTotals.deposited;
    const diff = deposited - expected;
    const antecRate = expected > 0 && diff < 0 ? Math.abs(diff) / expected * 100 : 0;
    return { expected, deposited, diff, antecRate };
  }, [headerTotals]);

  const exportCSV = () => {
    const header = ['Data','Vendas','Bruto','Taxa iFood','Liq Esperado','Depositado','Diferença','Status'].join(';');
    const lines = rows.map(r => [
      fmtDate(r.match_date),
      r.transaction_count,
      r.gross.toFixed(2),
      r.tax.toFixed(2),
      Number(r.expected_amount).toFixed(2),
      Number(r.deposited_amount).toFixed(2),
      Number(r.difference).toFixed(2),
      r.status,
    ].join(';'));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria-ifood-${periodLabel || 'periodo'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (roleLoading || loading) {
    return (
      <AppLayout title="Conciliação iFood">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return <AppLayout title="Conciliação iFood"><Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito.</CardContent></Card></AppLayout>;
  }

  if (!periodId) {
    return <AppLayout title="Conciliação iFood"><Card><CardContent className="py-10 text-center text-muted-foreground">Período não informado. <Button variant="link" onClick={() => navigate('/admin/auditoria')}>Voltar</Button></CardContent></Card></AppLayout>;
  }

  return (
    <AppLayout title="Conciliação iFood" subtitle={periodLabel}>
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink onClick={() => navigate('/admin/auditoria')} className="cursor-pointer">Auditoria</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Conciliação iFood</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Card de "Taxa antecipação est." removido — métrica enganosa para o caso iFood/Cresol (D+0/D+1).
            v4: o spread líq. esperado vs depositado já é informado em "Diferença". */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard title="Líq. Esperado" value={fmt(totals.expected)} />
          <SummaryCard title="Depositado" value={fmt(totals.deposited)} />
          <SummaryCard title="Diferença" value={fmt(totals.diff)} accent={totals.diff < 0 ? 'negative' : 'positive'} />
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6"></TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Vendas</TableHead>
                  <TableHead className="text-right">Bruto</TableHead>
                  <TableHead className="text-right">Taxa iFood</TableHead>
                  <TableHead className="text-right">Líq. Esperado</TableHead>
                  <TableHead className="text-right">Depositado</TableHead>
                  <TableHead className="text-right">Diferença</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Nenhum match encontrado. Execute a conciliação no dashboard.</TableCell></TableRow>
                )}
                {rows.map(r => {
                  const isExpanded = expandedDates.has(r.match_date);
                  return (
                    <Fragment key={r.match_date}>
                      <TableRow
                        className={`${STATUS_BG[r.status] ?? ''} cursor-pointer hover:bg-muted/30`}
                        onClick={() => {
                          const next = new Set(expandedDates);
                          if (next.has(r.match_date)) next.delete(r.match_date);
                          else next.add(r.match_date);
                          setExpandedDates(next);
                        }}
                      >
                        <TableCell className="w-6">{isExpanded ? '▼' : '▶'}</TableCell>
                        <TableCell className="font-medium">{fmtDate(r.match_date)}</TableCell>
                        <TableCell className="text-right">{r.transaction_count}</TableCell>
                        <TableCell className="text-right">{fmt(r.gross)}</TableCell>
                        <TableCell className="text-right">{fmt(r.tax)}</TableCell>
                        <TableCell className="text-right">{fmt(Number(r.expected_amount))}</TableCell>
                        <TableCell className="text-right">{fmt(Number(r.deposited_amount))}</TableCell>
                        <TableCell className={`text-right font-semibold ${Number(r.difference) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{fmt(Number(r.difference))}</TableCell>
                        <TableCell className="text-xs">{STATUS_LABEL[r.status] ?? r.status}</TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/20">
                          <TableCell colSpan={9} className="p-0">
                            <div className="p-3 text-xs space-y-1">
                              <div className="font-semibold mb-1 text-muted-foreground">
                                Lotes Maquinona × depósitos Cresol pareados:
                              </div>
                              <table className="w-full">
                                <thead className="text-[10px] text-muted-foreground">
                                  <tr>
                                    <th className="text-left py-1">Tipo</th>
                                    <th className="text-right">Vendas</th>
                                    <th className="text-right">Bruto Maq</th>
                                    <th className="text-right">Líq Maq</th>
                                    <th className="text-right">→ Cresol Data</th>
                                    <th className="text-right">→ Cresol Valor</th>
                                    <th className="text-right">Diff</th>
                                    <th className="text-right">% retido</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.lots.map((l, i) => {
                                    const pct = l.matched && l.liq > 0 && l.diff != null
                                      ? (l.diff / l.liq) * 100 : null;
                                    return (
                                      <tr key={i} className={!l.matched ? 'text-amber-600 dark:text-amber-500' : ''}>
                                        <td className="py-1 font-mono">{l.tipo}</td>
                                        <td className="text-right">{l.count}</td>
                                        <td className="text-right">{fmt(l.bruto)}</td>
                                        <td className="text-right">{fmt(l.liq)}</td>
                                        <td className="text-right">{l.matched ? fmtDate(l.cresol_date!) : '— sem match'}</td>
                                        <td className="text-right">{l.matched ? fmt(l.cresol_amount!) : '—'}</td>
                                        <td className={`text-right font-semibold ${l.matched && l.diff != null && l.diff < -0.5 ? 'text-red-600 dark:text-red-400' : ''}`}>
                                          {l.matched ? fmt(l.diff!) : '—'}
                                        </td>
                                        <td className="text-right">{pct != null ? `${pct.toFixed(2)}%` : '—'}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                              {r.lots.some(l => !l.matched) && (
                                <div className="mt-2 text-[11px] text-amber-700 dark:text-amber-500">
                                  ⚠ Lote(s) sem match: a Cresol provavelmente agregou esse PIX/CARD em outro depósito ou repassou em padrão atípico. Confira o extrato manualmente.
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {unmatchedCresolDeps.length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="text-sm font-semibold text-amber-700 dark:text-amber-500">
                ⚠ {unmatchedCresolDeps.length} depósito(s) Cresol no mês sem lote Maquinona pareado
              </div>
              <p className="text-xs text-muted-foreground">
                Esses depósitos chegaram na Cresol mas o algoritmo não encontrou venda Maquinona correspondente (tolerance 10%, janela 14d). Possíveis causas: estorno, ajuste manual do iFood, ou referem-se a vendas de meses muito adjacentes.
              </p>
              <table className="w-full text-xs mt-2">
                <thead className="text-[10px] text-muted-foreground">
                  <tr><th className="text-left">Data</th><th className="text-right">Valor</th></tr>
                </thead>
                <tbody>
                  {unmatchedCresolDeps.map((d, i) => (
                    <tr key={i}>
                      <td className="py-0.5">{fmtDate(d.date)}</td>
                      <td className="text-right font-mono">{fmt(d.amount)}</td>
                    </tr>
                  ))}
                  <tr className="border-t font-semibold">
                    <td className="pt-1">Total</td>
                    <td className="text-right font-mono pt-1">{fmt(unmatchedCresolDeps.reduce((s, d) => s + d.amount, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center justify-between flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/admin/auditoria')} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!periodMY) return;
                generateAuditPdf('ifood', {
                  periodLabel: makePeriodLabel(periodMY.month, periodMY.year),
                  periodFileTag: periodFileTag(periodMY.month, periodMY.year),
                  emittedBy: user?.email ?? 'Admin',
                  totals: {
                    vendido: rows.reduce((s, r) => s + Number(r.gross || 0), 0),
                    recebido: totals.deposited,
                    custoTotal: Math.abs(Math.min(totals.diff, 0)),
                    taxaEfetiva: totals.antecRate,
                  },
                  criticalVouchers: [],
                  ifoodSummary: {
                    bruto: rows.reduce((s, r) => s + Number(r.gross || 0), 0),
                    taxaDeclarada: rows.reduce((s, r) => s + Number(r.tax || 0), 0),
                    liquidoEsperado: totals.expected,
                    depositoCresol: totals.deposited,
                    diferenca: totals.diff,
                  },
                  dailyRows: rows,
                });
              }}
              disabled={rows.length === 0}
              className="gap-2"
            >
              <FileDown className="h-4 w-4" /> Exportar PDF
            </Button>
            <Button onClick={exportCSV} disabled={rows.length === 0} className="gap-2">
              <Download className="h-4 w-4" /> Exportar CSV
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function SummaryCard({ title, value, accent }: { title: string; value: string; accent?: 'positive' | 'negative' }) {
  const cls = accent === 'negative' ? 'text-red-600 dark:text-red-400' : accent === 'positive' ? 'text-green-600 dark:text-green-400' : '';
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase text-muted-foreground tracking-wide">{title}</p>
        <p className={`text-2xl font-semibold mt-1 ${cls}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
