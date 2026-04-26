import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { useAuth } from '@/hooks/useAuth';
import { generateAuditPdf, periodFileTag, periodLabel as makePeriodLabel } from '@/lib/audit-pdf';
import { AlertTriangle, ArrowLeft, ChevronDown, Download, FileDown, Loader2 } from 'lucide-react';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (iso?: string | null) => {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const COMPANY_LABELS: Record<string, string> = {
  alelo: 'ALELO',
  ticket: 'TICKET',
  pluxee: 'PLUXEE (Sodexo)',
  vr: 'VR',
};

const STATUS_CONFIG: Record<string, { emoji: string; label: string; border: string; badge: string }> = {
  ok: { emoji: '🟢', label: 'OK', border: 'border-green-500/40', badge: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  alerta: { emoji: '🟡', label: 'ALERTA', border: 'border-yellow-500/40', badge: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' },
  critico: { emoji: '🔴', label: 'CRÍTICO', border: 'border-red-500 ring-2 ring-red-500/30', badge: 'bg-red-500/20 text-red-700 dark:text-red-400' },
  divergente: { emoji: '🔵', label: 'DIVERGENTE', border: 'border-blue-500/40', badge: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  no_sales: { emoji: '⚪', label: 'SEM VENDAS', border: 'border-muted', badge: 'bg-muted text-muted-foreground' },
};

type VoucherMatch = {
  company: string;
  sold_amount: number;
  sold_count: number;
  deposited_amount: number;
  deposit_count: number;
  difference: number;
  effective_tax_rate: number;
  status: string;
};

type Detail = {
  sales: { sale_date: string; gross_amount: number; brand: string | null }[];
  deposits: { deposit_date: string; amount: number; detail: string | null }[];
};

export default function AuditVoucher() {
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const periodId = params.get('period');
  const [matches, setMatches] = useState<VoucherMatch[]>([]);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [adjByCompany, setAdjByCompany] = useState<Record<string, number>>({});
  const [expectedRates, setExpectedRates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [periodLabel, setPeriodLabel] = useState('');
  const [periodMY, setPeriodMY] = useState<{ month: number; year: number } | null>(null);

  useEffect(() => {
    if (!isAdmin || !periodId) return;
    (async () => {
      setLoading(true);
      const companies = ['alelo', 'ticket', 'pluxee', 'vr'];
      const [{ data: period }, { data: m }, { data: sales }, { data: deps }, { data: expRates }] = await Promise.all([
        supabase.from('audit_periods').select('month,year').eq('id', periodId).maybeSingle(),
        supabase.from('audit_voucher_matches').select('*').eq('audit_period_id', periodId),
        supabase.from('audit_card_transactions').select('deposit_group,sale_date,gross_amount,brand').eq('audit_period_id', periodId).in('deposit_group', companies).order('sale_date'),
        supabase.from('audit_bank_deposits').select('category,deposit_date,amount,detail,match_status,matched_competencia_amount,matched_adjacente_amount').eq('audit_period_id', periodId).eq('bank', 'bb').in('category', companies).order('deposit_date'),
        supabase.from('voucher_expected_rates' as any).select('company,expected_rate_pct'),
      ]);

      if (period) {
        const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        setPeriodLabel(`${months[(period as any).month - 1]}/${(period as any).year}`);
        setPeriodMY({ month: (period as any).month, year: (period as any).year });
      }

      setMatches((m as any[]) ?? []);

      const det: Record<string, Detail> = {};
      const adj: Record<string, number> = {};
      for (const c of companies) { det[c] = { sales: [], deposits: [] }; adj[c] = 0; }
      for (const s of sales ?? []) {
        const k = (s as any).deposit_group;
        if (det[k]) det[k].sales.push({ sale_date: (s as any).sale_date, gross_amount: Number((s as any).gross_amount), brand: (s as any).brand });
      }
      for (const d of deps ?? []) {
        const k = (d as any).category;
        if (det[k]) det[k].deposits.push({ deposit_date: (d as any).deposit_date, amount: Number((d as any).amount), detail: (d as any).detail });
        // Adjacente = matched_adjacente_amount + (todo amount de fora_periodo)
        const dd: any = d;
        if (adj[k] !== undefined) {
          adj[k] += Number(dd.matched_adjacente_amount || 0);
          if (dd.match_status === 'fora_periodo') adj[k] += Number(dd.amount || 0) - Number(dd.matched_adjacente_amount || 0);
        }
      }
      setDetails(det);
      setAdjByCompany(adj);
      const er: Record<string, number> = {};
      for (const r of (expRates ?? []) as any[]) er[r.company] = Number(r.expected_rate_pct);
      setExpectedRates(er);
      setLoading(false);
    })();
  }, [periodId, isAdmin]);

  const totals = useMemo(() => {
    const sold = matches.reduce((s, r) => s + Number(r.sold_amount || 0), 0);
    const dep = matches.reduce((s, r) => s + Number(r.deposited_amount || 0), 0);
    const rate = sold > 0 ? (sold - dep) / sold * 100 : 0;
    return { sold, dep, rate };
  }, [matches]);

  const exportCSV = () => {
    const header = ['Empresa','Vendido','Vendas','Recebido','Depósitos','Diferença','Taxa Efetiva %','Status'].join(';');
    const lines = matches.map(r => [
      COMPANY_LABELS[r.company] ?? r.company,
      Number(r.sold_amount).toFixed(2),
      r.sold_count,
      Number(r.deposited_amount).toFixed(2),
      r.deposit_count,
      Number(r.difference).toFixed(2),
      Number(r.effective_tax_rate).toFixed(2),
      r.status,
    ].join(';'));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria-voucher-${periodLabel || 'periodo'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (roleLoading || loading) {
    return (
      <AppLayout title="Conciliação Voucher">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return <AppLayout title="Conciliação Voucher"><Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito.</CardContent></Card></AppLayout>;
  }

  if (!periodId) {
    return <AppLayout title="Conciliação Voucher"><Card><CardContent className="py-10 text-center text-muted-foreground">Período não informado. <Button variant="link" onClick={() => navigate('/admin/auditoria')}>Voltar</Button></CardContent></Card></AppLayout>;
  }

  const ordered = ['alelo', 'ticket', 'pluxee', 'vr']
    .map(c => matches.find(m => m.company === c))
    .filter(Boolean) as VoucherMatch[];

  return (
    <AppLayout title="Conciliação Voucher (BB)" subtitle={periodLabel}>
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink onClick={() => navigate('/admin/auditoria')} className="cursor-pointer">Auditoria</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Conciliação Voucher</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {periodId && (
          <Card className="border-blue-500/40 bg-blue-500/5">
            <CardContent className="py-3 flex items-center justify-between gap-2 text-sm flex-wrap">
              <div className="flex items-start gap-2">
                <span className="text-blue-600 dark:text-blue-400 font-semibold">📊 Nova versão disponível</span>
                <span className="text-muted-foreground">
                  Importe os extratos das operadoras para análise precisa (sem chute de prazo).
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/admin/auditoria/voucher-settlements?period=${periodId}`)}
              >
                Ir para Conciliação por Extratos →
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="border-yellow-500/40 bg-yellow-500/5">
          <CardContent className="py-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
            <p className="text-muted-foreground">
              Taxas efetivas de 1 mês podem conter <strong>efeitos de borda</strong> (vendas do mês anterior ou que serão pagas no próximo). Para análise precisa, use períodos de 3+ meses.
            </p>
          </CardContent>
        </Card>

        {ordered.length === 0 && (
          <Card><CardContent className="py-10 text-center text-muted-foreground">Nenhum match encontrado. Execute a conciliação no dashboard.</CardContent></Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {ordered.map(m => {
            const cfg = STATUS_CONFIG[m.status] ?? STATUS_CONFIG.no_sales;
            const isCritico = m.status === 'critico';
            return (
              <Card key={m.company} className={`border-2 ${cfg.border}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span>{cfg.emoji}</span> {COMPANY_LABELS[m.company]}
                    </CardTitle>
                    <Badge className={cfg.badge} variant="secondary">
                      {isCritico && <AlertTriangle className="h-3 w-3 mr-1" />}
                      {cfg.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Vendido (competência):</span><span className="font-medium">{fmt(Number(m.sold_amount))}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Recebido competência:</span><span className="font-medium">{fmt(Number(m.deposited_amount))}</span></div>
                  {adjByCompany[m.company] > 0 && (
                    <div className="flex justify-between text-xs"><span className="text-muted-foreground">ℹ Recebido outras comp.:</span><span className="text-muted-foreground">{fmt(adjByCompany[m.company])}</span></div>
                  )}
                  <div className="flex justify-between"><span className="text-muted-foreground">Diferença:</span><span className={`font-semibold ${Number(m.difference) > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{fmt(Number(m.difference))}</span></div>
                  {(() => {
                    const exp = expectedRates[m.company] ?? 0;
                    const gap = Number(m.effective_tax_rate) - exp;
                    const rateColor = gap > 5 ? 'text-red-600 dark:text-red-400'
                      : gap > 2 ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-green-600 dark:text-green-400';
                    const gapColor = rateColor;
                    return (
                      <>
                        <div className="flex justify-between"><span className="text-muted-foreground">Taxa efetiva:</span><span className={`font-semibold ${rateColor}`}>{Number(m.effective_tax_rate).toFixed(2).replace('.', ',')}%</span></div>
                        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Taxa esperada:</span><span className="text-muted-foreground">{exp.toFixed(2).replace('.', ',')}%</span></div>
                        <div className="flex justify-between text-xs"><span className="text-muted-foreground">Gap (real - esperada):</span><span className={`font-medium ${gapColor}`}>{(gap >= 0 ? '+' : '') + gap.toFixed(2).replace('.', ',')} pp</span></div>
                      </>
                    );
                  })()}
                  <div className="text-xs text-muted-foreground pt-1">{m.sold_count} vendas / {m.deposit_count} depósitos</div>

                  {(isCritico || m.status === 'alerta') && (
                    <Collapsible className="pt-2">
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm" className="gap-1 w-full justify-between">
                          Ver detalhes <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-3 space-y-3">
                        <div>
                          <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Vendas (Maquinona)</p>
                          <div className="max-h-40 overflow-auto text-xs space-y-0.5">
                            {(details[m.company]?.sales ?? []).map((s, i) => (
                              <div key={i} className="flex justify-between border-b border-border/50 py-0.5">
                                <span>{fmtDate(s.sale_date)} {s.brand ?? ''}</span>
                                <span>{fmt(s.gross_amount)}</span>
                              </div>
                            ))}
                            {(details[m.company]?.sales ?? []).length === 0 && <p className="text-muted-foreground">Sem vendas.</p>}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Depósitos (BB)</p>
                          <div className="max-h-40 overflow-auto text-xs space-y-0.5">
                            {(details[m.company]?.deposits ?? []).map((d, i) => (
                              <div key={i} className="flex justify-between border-b border-border/50 py-0.5">
                                <span>{fmtDate(d.deposit_date)}</span>
                                <span>{fmt(d.amount)}</span>
                              </div>
                            ))}
                            {(details[m.company]?.deposits ?? []).length === 0 && <p className="text-muted-foreground">Sem depósitos.</p>}
                          </div>
                        </div>
                        <div className="text-xs pt-2 border-t">
                          Gap acumulado: <strong className="text-red-600 dark:text-red-400">{fmt(Number(m.difference))}</strong> · Taxa efetiva: <strong>{Number(m.effective_tax_rate).toFixed(2).replace('.', ',')}%</strong>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Resumo Total Voucher</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-xs text-muted-foreground uppercase">Vendido</p><p className="text-lg font-semibold">{fmt(totals.sold)}</p></div>
            <div><p className="text-xs text-muted-foreground uppercase">Recebido</p><p className="text-lg font-semibold">{fmt(totals.dep)}</p></div>
            <div><p className="text-xs text-muted-foreground uppercase">Taxa efetiva geral</p><p className={`text-lg font-semibold ${totals.rate > 5 ? 'text-red-600 dark:text-red-400' : ''}`}>{totals.rate.toFixed(2).replace('.', ',')}%</p></div>
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
                generateAuditPdf('voucher', {
                  periodLabel: makePeriodLabel(periodMY.month, periodMY.year),
                  periodFileTag: periodFileTag(periodMY.month, periodMY.year),
                  emittedBy: user?.email ?? 'Admin',
                  totals: {
                    vendido: totals.sold,
                    recebido: totals.dep,
                    custoTotal: Math.max(totals.sold - totals.dep, 0),
                    taxaEfetiva: totals.rate,
                  },
                  criticalVouchers: matches.filter(m => m.status === 'critico'),
                  voucherRows: matches,
                });
              }}
              disabled={matches.length === 0}
              className="gap-2"
            >
              <FileDown className="h-4 w-4" /> Exportar PDF
            </Button>
            <Button onClick={exportCSV} disabled={matches.length === 0} className="gap-2">
              <Download className="h-4 w-4" /> Exportar CSV
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
