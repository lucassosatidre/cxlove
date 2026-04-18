import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from '@/hooks/use-toast';
import { Plus, ArrowRight, FileSpreadsheet, Loader2, Play, RefreshCw, AlertTriangle } from 'lucide-react';

type AuditPeriod = {
  id: string;
  month: number;
  year: number;
  status: 'aberto' | 'importado' | 'conciliado' | 'fechado';
  updated_at: string;
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
};

type VoucherMatch = {
  company: string;
  sold_amount: number;
  deposited_amount: number;
  difference: number;
  effective_tax_rate: number;
  status: string;
};

type DailyMatch = {
  expected_amount: number;
  deposited_amount: number;
  difference: number;
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
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [period, setPeriod] = useState<AuditPeriod | null>(null);
  const [imports, setImports] = useState<AuditImport[]>([]);
  const [totals, setTotals] = useState<Totals>({ vendido: 0, recebido: 0, custo: 0, taxaPct: 0, txCount: 0 });
  const [voucherMatches, setVoucherMatches] = useState<VoucherMatch[]>([]);
  const [dailyMatches, setDailyMatches] = useState<DailyMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  const loadPeriodData = async (periodId: string) => {
    const [{ data: imps }, { data: txs }, { data: deps }, { data: vMatches }, { data: dMatches }] = await Promise.all([
      supabase.from('audit_imports').select('file_type,status,file_name,imported_rows,created_at').eq('audit_period_id', periodId).order('created_at', { ascending: false }),
      supabase.from('audit_card_transactions').select('gross_amount,tax_amount').eq('audit_period_id', periodId),
      supabase.from('audit_bank_deposits').select('amount,category').eq('audit_period_id', periodId),
      supabase.from('audit_voucher_matches').select('company,sold_amount,deposited_amount,difference,effective_tax_rate,status').eq('audit_period_id', periodId),
      supabase.from('audit_daily_matches').select('expected_amount,deposited_amount,difference').eq('audit_period_id', periodId),
    ]);
    setImports((imps as AuditImport[]) ?? []);
    const rows = (txs as { gross_amount: number; tax_amount: number }[]) ?? [];
    const vendido = rows.reduce((s, r) => s + Number(r.gross_amount || 0), 0);

    const depRows = (deps as { amount: number; category: string | null }[]) ?? [];
    const recebido = depRows
      .filter(d => ['ifood', 'alelo', 'ticket', 'pluxee', 'vr'].includes(d.category ?? ''))
      .reduce((s, d) => s + Number(d.amount || 0), 0);
    const custo = Math.max(vendido - recebido, 0);
    const taxaEfetiva = vendido > 0 ? (custo / vendido) * 100 : 0;

    setTotals({ vendido, recebido, custo, taxaPct: taxaEfetiva, txCount: rows.length });
    setVoucherMatches((vMatches as VoucherMatch[]) ?? []);
    setDailyMatches((dMatches as DailyMatch[]) ?? []);
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
        setTotals({ vendido: 0, recebido: 0, custo: 0, taxaPct: 0, txCount: 0 });
        setVoucherMatches([]);
        setDailyMatches([]);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [month, year, isAdmin]);

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
      // refresh
      const { data: p } = await supabase.from('audit_periods').select('*').eq('id', period.id).maybeSingle();
      if (p) setPeriod(p as AuditPeriod);
      await loadPeriodData(period.id);
    } catch (e: any) {
      toast({ title: 'Erro na conciliação', description: e.message ?? 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setReconciling(false);
    }
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

  // Refined totals when conciliated
  const ifoodGap = dailyMatches.reduce((s, m) => s + Number(m.difference || 0), 0);
  const voucherGap = voucherMatches.reduce((s, m) => s + Number(m.difference || 0), 0);
  const taxDeclared = totals.vendido - totals.recebido; // approx already in custo
  // When conciliated, custo = taxa declarada + |gap antecipação se negativo|
  const custoReal = isConciliated
    ? Math.abs(Math.min(ifoodGap, 0)) + Math.max(voucherGap, 0) + (totals.recebido > 0 ? Math.max(0, totals.vendido - totals.recebido - Math.max(voucherGap, 0)) : 0)
    : totals.custo;

  return (
    <AppLayout title="Auditoria de Taxas" subtitle="Conciliação Maquinona × Bancos">
      <div className="space-y-6">
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

            <div className="ml-auto flex items-center gap-3">
              {period && statusBadge && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Status:</span>
                  <Badge className={statusBadge.className} variant="secondary">{statusBadge.label}</Badge>
                  <span className="text-muted-foreground hidden md:inline">
                    Atualizado: {formatDateTime(period.updated_at)}
                  </span>
                </div>
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
        {period && (
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
              <Button variant="ghost" size="sm" className="gap-1 text-primary" disabled={!isConciliated} onClick={() => navigate(`/admin/auditoria/ifood?period=${period?.id}`)}>
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
              <Button variant="ghost" size="sm" className="gap-1 text-primary" disabled={!isConciliated} onClick={() => navigate(`/admin/auditoria/voucher?period=${period?.id}`)}>
                Ver detalhes <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Imports */}
        <Card>
          <CardHeader><CardTitle className="text-base">Importações do período</CardTitle></CardHeader>
          <CardContent className="space-y-2">
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
                  <Button size="sm" variant="outline" disabled={!period} onClick={() => navigate(`/admin/auditoria/importar?tipo=${t}`)}>
                    {isCompleted ? 'Re-importar' : 'Importar'}
                  </Button>
                </div>
              );
            })}
            {!period && (<p className="text-xs text-muted-foreground pt-1">Crie o período acima antes de importar arquivos.</p>)}
          </CardContent>
        </Card>
      </div>
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
