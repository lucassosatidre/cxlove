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
import { ArrowLeft, Download, FileDown, Loader2 } from 'lucide-react';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const STATUS_BG: Record<string, string> = {
  matched: 'bg-green-500/10',
  partial: 'bg-yellow-500/10',
  missing_deposit: 'bg-red-500/10',
  extra_deposit: 'bg-blue-500/10',
};

const STATUS_LABEL: Record<string, string> = {
  matched: '🟢 OK',
  partial: '🟡 Parcial',
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

  useEffect(() => {
    if (!isAdmin || !periodId) return;
    (async () => {
      setLoading(true);
      const [{ data: period }, { data: matches }, { data: txs }] = await Promise.all([
        supabase.from('audit_periods').select('month,year').eq('id', periodId).maybeSingle(),
        supabase.from('audit_daily_matches').select('*').eq('audit_period_id', periodId).order('match_date', { ascending: true }),
        supabase.from('audit_card_transactions').select('expected_deposit_date,gross_amount,tax_amount').eq('audit_period_id', periodId).eq('deposit_group', 'ifood'),
      ]);

      if (period) {
        const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        setPeriodLabel(`${months[(period as any).month - 1]}/${(period as any).year}`);
        setPeriodMY({ month: (period as any).month, year: (period as any).year });
      }

      const grossByDate = new Map<string, { gross: number; tax: number }>();
      for (const t of txs ?? []) {
        const d = (t as any).expected_deposit_date;
        if (!d) continue;
        const cur = grossByDate.get(d) ?? { gross: 0, tax: 0 };
        cur.gross += Number((t as any).gross_amount || 0);
        cur.tax += Number((t as any).tax_amount || 0);
        grossByDate.set(d, cur);
      }

      const enriched = ((matches as any[]) ?? []).map(m => ({
        ...m,
        gross: grossByDate.get(m.match_date)?.gross ?? 0,
        tax: grossByDate.get(m.match_date)?.tax ?? 0,
      }));
      setRows(enriched);
      setLoading(false);
    })();
  }, [periodId, isAdmin]);

  const totals = useMemo(() => {
    const expected = rows.reduce((s, r) => s + Number(r.expected_amount || 0), 0);
    const deposited = rows.reduce((s, r) => s + Number(r.deposited_amount || 0), 0);
    const diff = deposited - expected;
    const antecRate = expected > 0 && diff < 0 ? Math.abs(diff) / expected * 100 : 0;
    return { expected, deposited, diff, antecRate };
  }, [rows]);

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
    <AppLayout title="Conciliação iFood (Cresol)" subtitle={periodLabel}>
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink onClick={() => navigate('/admin/auditoria')} className="cursor-pointer">Auditoria</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Conciliação iFood</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard title="Líq. Esperado" value={fmt(totals.expected)} />
          <SummaryCard title="Depositado" value={fmt(totals.deposited)} />
          <SummaryCard title="Diferença" value={fmt(totals.diff)} accent={totals.diff < 0 ? 'negative' : 'positive'} />
          <SummaryCard title="Taxa antecipação est." value={`${totals.antecRate.toFixed(2).replace('.', ',')}%`} />
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
                    <TableCell className="text-xs">{STATUS_LABEL[r.status] ?? r.status}</TableCell>
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
