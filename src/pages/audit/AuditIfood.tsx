import { useEffect, useMemo, useState } from 'react';
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
  // Quando status='pending', match_date que fechou esse dia (cluster_matched/cluster_partial).
  closed_by?: string;
  // Quando status começa com 'cluster_', lista de match_dates pending que esse cluster fechou.
  closes?: string[];
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

  useEffect(() => {
    if (!isAdmin || !periodId) return;
    (async () => {
      setLoading(true);

      // Paginated fetches: tabelas audit_* podem passar do limit padrão de 1000.
      const fetchAllIfoodTxs = () =>
        fetchAllPaginated<any>(
          supabase
            .from('audit_card_transactions')
            .select('expected_deposit_date,gross_amount,tax_amount,net_amount')
            .eq('audit_period_id', periodId!)
            .eq('deposit_group', 'ifood'),
        );

      // Lê audit_daily_matches direto (escrita pelo run-audit-match com
      // carry-forward) — fonte da verdade pro detalhamento diário.
      // get_audit_ifood_daily_detail RPC ainda usa lógica antiga (sem cluster).
      const [
        { data: period },
        { data: dailyMatches },
        txs,
      ] = await Promise.all([
        supabase.from('audit_periods').select('month,year').eq('id', periodId).maybeSingle(),
        supabase
          .from('audit_daily_matches')
          .select('match_date,expected_amount,deposited_amount,difference,transaction_count,deposit_count,status')
          .eq('audit_period_id', periodId)
          .order('match_date'),
        fetchAllIfoodTxs(),
      ]);

      if (period) {
        const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        setPeriodLabel(`${months[(period as any).month - 1]}/${(period as any).year}`);
        setPeriodMY({ month: (period as any).month, year: (period as any).year });
      }

      // Calcula gross e tax por expected_deposit_date (= match_date) somando
      // direto do audit_card_transactions. Tax real = gross - net.
      const grossByDate = new Map<string, number>();
      const taxByDate = new Map<string, number>();
      for (const t of (txs as any[]) ?? []) {
        const d = (t as any).expected_deposit_date;
        if (!d) continue;
        const gross = Number((t as any).gross_amount || 0);
        const net = Number((t as any).net_amount || 0);
        const realTax = Math.max(gross - net, 0);
        grossByDate.set(d, (grossByDate.get(d) ?? 0) + gross);
        taxByDate.set(d, (taxByDate.get(d) ?? 0) + realTax);
      }

      // Filtra apenas dates do período (mês/ano) — daily_matches pode ter linhas
      // de meses adjacentes por causa do carry-forward.
      const periodMonth = (period as any)?.month;
      const periodYear = (period as any)?.year;

      const enriched: MatchRow[] = ((dailyMatches as any[]) ?? [])
        .filter(d => {
          if (!periodMonth || !periodYear) return true;
          const [y, m] = d.match_date.split('-').map(Number);
          return y === periodYear && m === periodMonth;
        })
        .map(d => ({
          match_date: d.match_date,
          expected_amount: Number(d.expected_amount || 0),
          deposited_amount: Number(d.deposited_amount || 0),
          difference: Number(d.difference || 0),
          transaction_count: Number(d.transaction_count || 0),
          deposit_count: Number(d.deposit_count || 0),
          status: d.status,
          gross: grossByDate.get(d.match_date) ?? 0,
          tax: taxByDate.get(d.match_date) ?? 0,
        }));

      // Linka pending → cluster que fechou. Walk: cada sequência de pending
      // termina num cluster_matched/cluster_partial.
      let pendingBuffer: string[] = [];
      for (const r of enriched) {
        if (r.status === 'pending') {
          pendingBuffer.push(r.match_date);
        } else if (r.status?.startsWith('cluster_')) {
          for (const pd of pendingBuffer) {
            const pendingRow = enriched.find(x => x.match_date === pd);
            if (pendingRow) pendingRow.closed_by = r.match_date;
          }
          if (pendingBuffer.length > 0) r.closes = [...pendingBuffer, r.match_date];
          pendingBuffer = [];
        } else {
          pendingBuffer = [];
        }
      }

      // Rateio proporcional: distribui o depósito do cluster entre os dias
      // que ele cobriu (pendings + dia do cluster) na proporção do líq esperado
      // de cada dia. Permite auditoria dia-a-dia (cobrar operadora por
      // desconto indevido em um dia específico em vez de bloco de 3 dias).
      for (const cluster of enriched.filter(r => r.closes && r.closes.length > 1)) {
        const memberDates = cluster.closes!;
        const clusterDate = memberDates[memberDates.length - 1];
        const pendingDates = memberDates.slice(0, -1);

        // expected do cluster row é cumulativo (= pending1 + pending2 + dia).
        // Recupera o expected do cluster day por si só.
        const pendingsExpectedSum = pendingDates.reduce((s, d) => {
          const r = enriched.find(x => x.match_date === d);
          return s + (r?.expected_amount ?? 0);
        }, 0);
        const cumExpected = cluster.expected_amount;
        const clusterDayOnly = Math.max(cumExpected - pendingsExpectedSum, 0);
        const totalDeposited = cluster.deposited_amount;

        // Atualiza cada linha do cluster com sua porção
        for (const d of memberDates) {
          const r = enriched.find(x => x.match_date === d);
          if (!r) continue;

          if (d === clusterDate) {
            r.expected_amount = clusterDayOnly;
          }
          const expectedDay = r.expected_amount;
          const proportion = cumExpected > 0 ? expectedDay / cumExpected : 0;
          const distributed = totalDeposited * proportion;
          r.deposited_amount = distributed;
          r.difference = distributed - expectedDay;

          // Re-classifica status baseado no diff individual após rateio
          const tolerance = Math.max(1, expectedDay * 0.005);
          if (Math.abs(r.difference) <= tolerance) {
            r.status = 'matched';
          } else {
            r.status = 'partial';
          }
        }
      }

      setRows(enriched);

      // Header totals: soma dos enriched (= o que está visível na tabela)
      // Header totals: filtra pending pra não duplicar (expected do pending
      // já está incluído no expected acumulado do cluster que fechou).
      const nonPending = enriched.filter(r => r.status !== 'pending');
      const totalExpected = nonPending.reduce((s, r) => s + r.expected_amount, 0);
      const totalDeposited = nonPending.reduce((s, r) => s + r.deposited_amount, 0);
      setHeaderTotals({ expected: totalExpected, deposited: totalDeposited });

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
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhum match encontrado. Execute a conciliação no dashboard.</TableCell></TableRow>
                )}
                {rows.map(r => (
                  <TableRow key={r.match_date} className={STATUS_BG[r.status] ?? ''}>
                    <TableCell className="font-medium">{fmtDate(r.match_date)}</TableCell>
                    <TableCell className="text-right">{r.transaction_count}</TableCell>
                    <TableCell className="text-right">{fmt(r.gross)}</TableCell>
                    <TableCell className="text-right">{fmt(r.tax)}</TableCell>
                    <TableCell className="text-right">{fmt(Number(r.expected_amount))}</TableCell>
                    <TableCell className="text-right">{fmt(Number(r.deposited_amount))}</TableCell>
                    <TableCell className={`text-right font-semibold ${Number(r.difference) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{fmt(Number(r.difference))}</TableCell>
                    <TableCell className="text-xs">
                      <div>{STATUS_LABEL[r.status] ?? r.status}</div>
                      {r.closed_by && (
                        <div className="text-[10px] text-blue-700 dark:text-blue-400 mt-0.5">
                          rateio do depósito de {fmtDate(r.closed_by)}
                        </div>
                      )}
                      {r.closes && r.closes.length > 1 && (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          rateio cobre: {r.closes.slice(0, -1).map(fmtDate).join(', ')} + hoje
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

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
