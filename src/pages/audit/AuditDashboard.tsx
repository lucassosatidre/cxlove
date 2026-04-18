import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from '@/hooks/use-toast';
import { Plus, ArrowRight, FileSpreadsheet, Loader2, Play, RefreshCw, AlertTriangle, Download, Lock, LockOpen, History } from 'lucide-react';
import { generateAuditPdf, periodFileTag, periodLabel as makePeriodLabel, type AuditPdfData } from '@/lib/audit-pdf';
import { CloseConfirmDialog, ReopenDialog } from '@/components/audit/PeriodCloseDialog';

type AuditPeriod = {
  id: string;
  month: number;
  year: number;
  status: 'aberto' | 'importado' | 'conciliado' | 'fechado';
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
};

type AuditImport = {
  file_type: 'maquinona' | 'cresol' | 'bb';
  status: string;
  file_name: string;
  imported_rows: number;
  created_at: string;
};

type Totals = {
  vendido: number;
  recebido: number;
  custo: number;
  taxaPct: number;
  txCount: number;
  bruto: number;
  taxa: number;
  liquidoDeclarado: number;
  custoDeclarado: number;
};

type VoucherMatch = {
  company: string;
  sold_amount: number;
  deposited_amount: number;
  difference: number;
  effective_tax_rate: number;
  status: string;
  sold_count?: number;
  deposit_count?: number;
};

type DailyMatch = {
  match_date: string;
  expected_amount: number;
  deposited_amount: number;
  difference: number;
  transaction_count: number;
  status: string;
};

type LogEntry = {
  id: string;
  action: 'fechado' | 'reaberto';
  user_id: string | null;
  reason: string | null;
  created_at: string;
};

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  aberto: { label: 'Aberto', className: 'bg-muted text-muted-foreground' },
  importado: { label: 'Importado', className: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' },
  conciliado: { label: 'Conciliado', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  fechado: { label: 'Fechado', className: 'bg-green-500/15 text-green-700 dark:text-green-400' },
};

const FILE_LABELS: Record<string, string> = {
  maquinona: 'Maquinona',
  cresol: 'Cresol',
  bb: 'Banco do Brasil',
};

const COMPANY_LABELS: Record<string, string> = {
  alelo: 'Alelo', ticket: 'Ticket', pluxee: 'Pluxee', vr: 'VR',
};

const formatCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export default function AuditDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const now = new Date();

  const getInitial = (key: 'month' | 'year', fallback: number) => {
    const url = searchParams.get(key);
    if (url) return Number(url);
    const saved = sessionStorage.getItem(`auditDashboard_${key}`);
    if (saved) return Number(saved);
    return fallback;
  };

  const [month, setMonth] = useState<number>(() => getInitial('month', now.getMonth() + 1));
  const [year, setYear] = useState<number>(() => getInitial('year', now.getFullYear()));
  const [period, setPeriod] = useState<AuditPeriod | null>(null);
  const [imports, setImports] = useState<AuditImport[]>([]);
  const [totals, setTotals] = useState<Totals>({ vendido: 0, recebido: 0, custo: 0, taxaPct: 0, txCount: 0, bruto: 0, taxa: 0, liquidoDeclarado: 0, custoDeclarado: 0 });
  const [voucherMatches, setVoucherMatches] = useState<VoucherMatch[]>([]);
  const [dailyMatches, setDailyMatches] = useState<DailyMatch[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [userNamesById, setUserNamesById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);

  // Persist month/year to sessionStorage + URL on every change
  useEffect(() => {
    sessionStorage.setItem('auditDashboard_month', String(month));
    sessionStorage.setItem('auditDashboard_year', String(year));
    setSearchParams({ month: String(month), year: String(year) }, { replace: true });
  }, [month, year, setSearchParams]);

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  const loadPeriodData = async (periodId: string) => {
    const [{ data: imps }, { data: totalsRpc }, { data: depsRpc }, { data: vMatches }, { data: dMatches }, { data: logRows }] = await Promise.all([
      supabase.from('audit_imports').select('file_type,status,file_name,imported_rows,created_at').eq('audit_period_id', periodId).order('created_at', { ascending: false }),
      supabase.rpc('get_audit_period_totals', { p_period_id: periodId }),
      supabase.rpc('get_audit_period_deposits', { p_period_id: periodId }),
      supabase.from('audit_voucher_matches').select('company,sold_amount,deposited_amount,difference,effective_tax_rate,status,sold_count,deposit_count').eq('audit_period_id', periodId),
      supabase.from('audit_daily_matches').select('match_date,expected_amount,deposited_amount,difference,transaction_count,status').eq('audit_period_id', periodId).order('match_date'),
      supabase.from('audit_period_log').select('id,action,user_id,reason,created_at').eq('audit_period_id', periodId).order('created_at', { ascending: true }),
    ]);
    setImports((imps as AuditImport[]) ?? []);

    const t = (totalsRpc as any[])?.[0] ?? {};
    const bruto = Number(t.total_bruto ?? 0);
    const liquidoDeclarado = Number(t.total_liquido_declarado ?? 0);
    const taxa = Number(t.total_taxa_declarada ?? 0);
    const promocao = Number(t.total_promocao ?? 0);
    const txCount = Number(t.total_count ?? 0);
    const custoDeclarado = Math.max(bruto - liquidoDeclarado, 0); // taxa + promoção declaradas

    const depRows = (depsRpc as { category: string | null; total_amount: number }[]) ?? [];
    const recebido = depRows
      .filter(d => ['ifood', 'alelo', 'ticket', 'pluxee', 'vr'].includes(d.category ?? ''))
      .reduce((s, d) => s + Number(d.total_amount || 0), 0);
    const custoReal = Math.max(bruto - recebido, 0);
    const taxaEfetiva = bruto > 0 ? (custoReal / bruto) * 100 : 0;

    setTotals({
      vendido: bruto, recebido, custo: custoReal, taxaPct: taxaEfetiva,
      txCount, bruto, taxa: taxa + promocao, liquidoDeclarado, custoDeclarado,
    });
    setVoucherMatches((vMatches as VoucherMatch[]) ?? []);
    setDailyMatches((dMatches as DailyMatch[]) ?? []);
    setLogs((logRows as LogEntry[]) ?? []);
  };

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data: p } = await supabase
        .from('audit_periods').select('*')
        .eq('month', month).eq('year', year).maybeSingle();

      if (!active) return;
      setPeriod((p as AuditPeriod) ?? null);

      if (p) {
        await loadPeriodData((p as AuditPeriod).id);
      } else {
        setImports([]);
        setTotals({ vendido: 0, recebido: 0, custo: 0, taxaPct: 0, txCount: 0, bruto: 0, taxa: 0 });
        setVoucherMatches([]);
        setDailyMatches([]);
        setLogs([]);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [month, year, isAdmin]);

  // Resolve user names for the closed_by + log entries
  useEffect(() => {
    const ids = new Set<string>();
    if (period?.closed_by) ids.add(period.closed_by);
    for (const l of logs) if (l.user_id) ids.add(l.user_id);
    const missing = Array.from(ids).filter(id => !(id in userNamesById));
    if (missing.length === 0) return;
    (async () => {
      // Try delivery_drivers first, then user metadata via fallback (email/uuid)
      const { data: drivers } = await supabase
        .from('delivery_drivers').select('auth_user_id,nome').in('auth_user_id', missing);
      const map: Record<string, string> = {};
      for (const d of drivers ?? []) map[(d as any).auth_user_id] = (d as any).nome;
      // For ids not found, just keep "Admin"
      for (const id of missing) if (!map[id]) map[id] = 'Admin';
      setUserNamesById(prev => ({ ...prev, ...map }));
    })();
  }, [period?.closed_by, logs]);

  const handleCreatePeriod = async () => {
    if (!user) return;
    setCreating(true);
    const { data, error } = await supabase
      .from('audit_periods')
      .insert({ month, year, created_by: user.id }).select().single();
    setCreating(false);
    if (error) {
      toast({ title: 'Erro ao criar período', description: error.message, variant: 'destructive' });
      return;
    }
    setPeriod(data as AuditPeriod);
    toast({ title: 'Período criado', description: `${MONTHS[month - 1]} / ${year}` });
  };

  const importByType = (t: 'maquinona' | 'cresol' | 'bb') => imports.find(i => i.file_type === t);
  const allImported = ['maquinona', 'cresol', 'bb'].every(t => importByType(t as any)?.status === 'completed');
  const isConciliated = period?.status === 'conciliado';
  const isClosed = period?.status === 'fechado';
  const canExport = isConciliated || isClosed;

  const handleRunMatch = async () => {
    if (!period) return;
    setReconciling(true);
    try {
      const { data, error } = await supabase.functions.invoke('run-audit-match', {
        body: { audit_period_id: period.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: '✓ Conciliação concluída',
        description: `${(data as any).daily_matches_count} matches diários · ${(data as any).voucher_matches_count} matches voucher`,
      });
      const { data: p } = await supabase.from('audit_periods').select('*').eq('id', period.id).maybeSingle();
      if (p) setPeriod(p as AuditPeriod);
      await loadPeriodData(period.id);
    } catch (e: any) {
      toast({ title: 'Erro na conciliação', description: e.message ?? 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setReconciling(false);
    }
  };

  const buildPdfData = (): AuditPdfData => {
    const ifoodGap = dailyMatches.reduce((s, m) => s + Number(m.difference || 0), 0);
    return {
      periodLabel: makePeriodLabel(month, year),
      periodFileTag: periodFileTag(month, year),
      emittedBy: user?.email ?? 'Admin',
      totals: {
        vendido: totals.vendido,
        recebido: totals.recebido,
        custoTotal: totals.custo,
        taxaEfetiva: totals.taxaPct,
      },
      criticalVouchers: voucherMatches.filter(v => v.status === 'critico'),
      ifoodSummary: {
        bruto: totals.bruto,
        taxaDeclarada: totals.taxa,
        liquidoEsperado: dailyMatches.reduce((s, m) => s + Number(m.expected_amount), 0),
        depositoCresol: dailyMatches.reduce((s, m) => s + Number(m.deposited_amount), 0),
        diferenca: ifoodGap,
      },
      dailyRows: dailyMatches,
      voucherRows: voucherMatches,
    };
  };

  const handleExportPdf = async () => {
    if (!canExport) return;
    setExportingPdf(true);
    try {
      generateAuditPdf('completo', buildPdfData());
      toast({ title: '✓ Relatório exportado' });
    } catch (e: any) {
      toast({ title: 'Erro ao gerar PDF', description: e.message ?? 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleClose = async () => {
    if (!period || !user) return;
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('audit_periods')
      .update({ status: 'fechado', closed_at: nowIso, closed_by: user.id, updated_at: nowIso })
      .eq('id', period.id);
    if (error) {
      toast({ title: 'Erro ao fechar', description: error.message, variant: 'destructive' });
      return;
    }
    await supabase.from('audit_period_log').insert({
      audit_period_id: period.id, action: 'fechado', user_id: user.id, reason: null,
    });
    toast({ title: '✓ Período fechado', description: `${MONTHS[month - 1]}/${year} fechado com sucesso` });
    setCloseOpen(false);
    const { data: p } = await supabase.from('audit_periods').select('*').eq('id', period.id).maybeSingle();
    if (p) setPeriod(p as AuditPeriod);
    await loadPeriodData(period.id);
  };

  const handleReopen = async (reason: string) => {
    if (!period || !user) return;
    const { error } = await supabase
      .from('audit_periods')
      .update({ status: 'conciliado', closed_at: null, closed_by: null, updated_at: new Date().toISOString() })
      .eq('id', period.id);
    if (error) {
      toast({ title: 'Erro ao reabrir', description: error.message, variant: 'destructive' });
      return;
    }
    await supabase.from('audit_period_log').insert({
      audit_period_id: period.id, action: 'reaberto', user_id: user.id, reason,
    });
    toast({ title: '✓ Período reaberto' });
    setReopenOpen(false);
    const { data: p } = await supabase.from('audit_periods').select('*').eq('id', period.id).maybeSingle();
    if (p) setPeriod(p as AuditPeriod);
    await loadPeriodData(period.id);
  };

  if (roleLoading) {
    return (
      <AppLayout title="Auditoria de Taxas">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="Auditoria de Taxas">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito a administradores.</CardContent></Card>
      </AppLayout>
    );
  }

  const statusBadge = period ? STATUS_VARIANTS[period.status] : null;
  const criticalVouchers = voucherMatches.filter(v => v.status === 'critico');

  const ifoodGap = dailyMatches.reduce((s, m) => s + Number(m.difference || 0), 0);
  const voucherGap = voucherMatches.reduce((s, m) => s + Number(m.difference || 0), 0);
  const custoReal = isConciliated || isClosed
    ? Math.abs(Math.min(ifoodGap, 0)) + Math.max(voucherGap, 0) + (totals.recebido > 0 ? Math.max(0, totals.vendido - totals.recebido - Math.max(voucherGap, 0)) : 0)
    : totals.custo;

  const periodLabelStr = makePeriodLabel(month, year);

  const exportBtn = (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="outline"
              onClick={handleExportPdf}
              disabled={!canExport || exportingPdf}
              className="gap-2"
            >
              {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exportingPdf ? 'Gerando PDF...' : 'Exportar PDF'}
            </Button>
          </span>
        </TooltipTrigger>
        {!canExport && (
          <TooltipContent>Execute a conciliação antes de exportar</TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <AppLayout title="Auditoria de Taxas" subtitle="Conciliação Maquinona × Bancos">
      <div className="space-y-6">
        {/* Closed banner */}
        {isClosed && period && (
          <Card className="border-slate-400/60 bg-slate-500/5">
            <CardContent className="py-3 flex flex-wrap items-center gap-3">
              <Lock className="h-5 w-5 text-slate-500" />
              <div className="flex-1 min-w-[260px] text-sm">
                <p className="font-semibold">PERÍODO FECHADO</p>
                <p className="text-muted-foreground text-xs">
                  Fechado em {period.closed_at ? formatDateTime(period.closed_at) : '—'}
                  {period.closed_by ? ` por ${userNamesById[period.closed_by] ?? 'Admin'}` : ''}.
                  {' '}Apenas visualização e exportação disponíveis.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setReopenOpen(true)} className="gap-2">
                <LockOpen className="h-4 w-4" /> Reabrir Período
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Critical alert */}
        {criticalVouchers.length > 0 && (
          <Card className="border-red-500 bg-red-500/5">
            <CardContent className="py-3 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-sm">
                <p className="font-semibold text-red-700 dark:text-red-400">
                  🚨 ATENÇÃO: {criticalVouchers.map(v => COMPANY_LABELS[v.company]?.toUpperCase()).join(', ')} {criticalVouchers.length === 1 ? 'está retendo' : 'estão retendo'} acima do esperado
                </p>
                {criticalVouchers.map(v => (
                  <p key={v.company} className="text-muted-foreground mt-0.5">
                    <strong>{COMPANY_LABELS[v.company]}</strong>: {Number(v.effective_tax_rate).toFixed(1)}% · Esperado {formatCurrency(Number(v.sold_amount))} · Recebido {formatCurrency(Number(v.deposited_amount))} · Gap {formatCurrency(Number(v.difference))}
                  </p>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate(`/admin/auditoria/voucher?period=${period?.id}`)}>
                Investigar
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Selector */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <div className="flex items-center gap-2">
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (<SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>))}
                </SelectContent>
              </Select>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="ml-auto flex items-center gap-3 flex-wrap">
              {period && statusBadge && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge className={statusBadge.className} variant="secondary">{statusBadge.label}</Badge>
                </div>
              )}
              {period && exportBtn}
              {period && isConciliated && !isClosed && (
                <Button variant="default" onClick={() => setCloseOpen(true)} className="gap-2">
                  <Lock className="h-4 w-4" /> Fechar Período
                </Button>
              )}
              {!period && !loading && (
                <Button onClick={handleCreatePeriod} disabled={creating} className="gap-2">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Novo Período
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Reconcile button */}
        {period && !isClosed && (
          <Card>
            <CardContent className="py-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                {!allImported && <span className="text-muted-foreground">Importe os 3 arquivos para habilitar a conciliação.</span>}
                {allImported && !isConciliated && <span className="text-muted-foreground">Os 3 arquivos foram importados. Pronto para conciliar.</span>}
                {isConciliated && <span className="text-muted-foreground">Última conciliação: {formatDateTime(period.updated_at)}</span>}
              </div>
              <Button
                onClick={handleRunMatch}
                disabled={!allImported || reconciling}
                variant={isConciliated ? 'outline' : 'default'}
                className="gap-2"
              >
                {reconciling ? <Loader2 className="h-4 w-4 animate-spin" /> : isConciliated ? <RefreshCw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {reconciling ? 'Conciliando...' : isConciliated ? 'Reexecutar Conciliação' : 'Executar Conciliação'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard title="Vendido" value={formatCurrency(totals.vendido)} />
          <SummaryCard title="Recebido" value={formatCurrency(totals.recebido)} />
          <SummaryCard title="Custo" value={formatCurrency(custoReal)} />
          <SummaryCard title="Taxa efetiva" value={`${totals.taxaPct.toFixed(2).replace('.', ',')}%`} />
        </div>

        {/* iFood + Voucher detail entries */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">iFood (Cresol)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {dailyMatches.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conciliação executada.</p>
              ) : (
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Líquido esperado:</span><span className="font-medium">{formatCurrency(dailyMatches.reduce((s, m) => s + Number(m.expected_amount), 0))}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Recebido Cresol:</span><span className="font-medium">{formatCurrency(dailyMatches.reduce((s, m) => s + Number(m.deposited_amount), 0))}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Gap:</span><span className={`font-semibold ${ifoodGap < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>{formatCurrency(ifoodGap)}</span></div>
                </div>
              )}
              <Button variant="ghost" size="sm" className="gap-1 text-primary" disabled={!canExport} onClick={() => navigate(`/admin/auditoria/ifood?period=${period?.id}`)}>
                Ver detalhes <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Vouchers (BB)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {voucherMatches.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conciliação executada.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {['alelo', 'ticket', 'pluxee', 'vr'].map(c => {
                    const v = voucherMatches.find(m => m.company === c);
                    if (!v) return <div key={c} className="rounded border p-2 opacity-50"><div className="font-semibold">{COMPANY_LABELS[c]}</div><div className="text-muted-foreground">—</div></div>;
                    const cls = v.status === 'critico' ? 'border-red-500 bg-red-500/5' : v.status === 'alerta' ? 'border-yellow-500/50 bg-yellow-500/5' : v.status === 'divergente' ? 'border-blue-500/50 bg-blue-500/5' : 'border-green-500/50 bg-green-500/5';
                    return (
                      <div key={c} className={`rounded border p-2 ${cls}`}>
                        <div className="font-semibold">{COMPANY_LABELS[c]}</div>
                        <div>Taxa: <strong>{Number(v.effective_tax_rate).toFixed(1)}%</strong></div>
                        <div className="text-muted-foreground uppercase">{v.status}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button variant="ghost" size="sm" className="gap-1 text-primary" disabled={!canExport} onClick={() => navigate(`/admin/auditoria/voucher?period=${period?.id}`)}>
                Ver detalhes <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Imports */}
        <Card>
          <CardHeader><CardTitle className="text-base">Importações do período</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {isClosed && (
              <p className="text-xs text-muted-foreground italic">Este período está fechado. Para importar novos arquivos, reabra o período.</p>
            )}
            {(['maquinona', 'cresol', 'bb'] as const).map(t => {
              const imp = importByType(t);
              const isCompleted = imp?.status === 'completed';
              return (
                <div key={t} className="flex items-center justify-between rounded-md border bg-card px-4 py-3">
                  <div className="flex items-center gap-3">
                    <FileSpreadsheet className="h-4 w-4 text-primary" />
                    <span className="font-medium">{FILE_LABELS[t]}</span>
                    {isCompleted && imp ? (
                      <Badge variant="secondary" className="bg-green-500/15 text-green-700 dark:text-green-400">
                        ✓ importado em {formatDateTime(imp.created_at)} ({imp.imported_rows} transações)
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-muted text-muted-foreground">não importado</Badge>
                    )}
                  </div>
                  <Button size="sm" variant="outline" disabled={!period || isClosed} onClick={() => navigate(`/admin/auditoria/importar?tipo=${t}&period=${period?.id}`, { state: { month, year } })}>
                    {isCompleted ? 'Re-importar' : 'Importar'}
                  </Button>
                </div>
              );
            })}
            {!period && (<p className="text-xs text-muted-foreground pt-1">Crie o período acima antes de importar arquivos.</p>)}
          </CardContent>
        </Card>

        {/* History */}
        {logs.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" /> Histórico deste período
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-xs text-muted-foreground">
              {logs.map(l => (
                <div key={l.id}>
                  <span className="font-mono">{formatDateTime(l.created_at)}</span>
                  {' — '}
                  <span className={l.action === 'fechado' ? 'text-foreground font-medium' : 'text-blue-600 dark:text-blue-400 font-medium'}>
                    {l.action === 'fechado' ? 'Fechado' : 'Reaberto'}
                  </span>
                  {l.user_id ? ` por ${userNamesById[l.user_id] ?? 'Admin'}` : ''}
                  {l.reason ? <span className="block pl-4 italic">Motivo: "{l.reason}"</span> : null}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {period && (
        <>
          <CloseConfirmDialog
            open={closeOpen}
            onOpenChange={setCloseOpen}
            periodLabel={periodLabelStr}
            onConfirm={handleClose}
          />
          <ReopenDialog
            open={reopenOpen}
            onOpenChange={setReopenOpen}
            periodLabel={periodLabelStr}
            onConfirm={handleReopen}
          />
        </>
      )}
    </AppLayout>
  );
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase text-muted-foreground tracking-wide">{title}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
