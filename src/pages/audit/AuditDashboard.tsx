import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from '@/hooks/use-toast';
import { Plus, ArrowRight, Loader2, Play, RefreshCw, Lock, LockOpen, History } from 'lucide-react';
import AuditNavTabs from '@/components/audit/AuditNavTabs';
import { periodLabel as makePeriodLabel } from '@/lib/audit-pdf';
import { CloseConfirmDialog, ReopenDialog } from '@/components/audit/PeriodCloseDialog';
import { fetchAllPaginated } from '@/lib/supabase-pagination';

type AuditPeriod = {
  id: string;
  month: number;
  year: number;
  status: 'aberto' | 'importado' | 'conciliado' | 'fechado';
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
};

type ImportSource = 'maquinona' | 'cresol';

type AuditImport = {
  file_type: 'maquinona' | 'cresol';
  status: string;
  file_name: string;
  imported_rows: number;
  created_at: string;
};

type PeriodImportRow = {
  audit_period_id: string;
  source: ImportSource;
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
  liquidoIfood: number;
  brutoIfood: number;
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
  const [allImports, setAllImports] = useState<PeriodImportRow[]>([]);
  const [totals, setTotals] = useState<Totals>({ vendido: 0, recebido: 0, custo: 0, taxaPct: 0, txCount: 0, bruto: 0, taxa: 0, liquidoDeclarado: 0, custoDeclarado: 0, liquidoIfood: 0, brutoIfood: 0 });
  
  const [dailyMatches, setDailyMatches] = useState<DailyMatch[]>([]);
  const [depositRows, setDepositRows] = useState<{ category: string | null; bank: string | null; match_status?: string | null; total_amount: number; deposit_count: number }[]>([]);
  const [ifoodCompetencia, setIfoodCompetencia] = useState(0);
  const [ifoodAdjacente, setIfoodAdjacente] = useState(0);
  const [custoDeclaradoIfood, setCustoDeclaradoIfood] = useState(0);
  const [custoOculto, setCustoOculto] = useState(0);
  const [ifoodNaoConciliado, setIfoodNaoConciliado] = useState(0);
  const [promocaoIfood, setPromocaoIfood] = useState(0);
  const [incentivoIfood, setIncentivoIfood] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [userNamesById, setUserNamesById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [aiAudits, setAiAudits] = useState<any>(null);

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
    // ifoodCompRows pode passar de 1000 em meses cheios → usa fetchAllPaginated.
    // (audit_daily_matches max ~31 rows/mês; demais queries pequenas, OK.)
    // vw_period_imports não existe no schema atual — substituído por query direta
    // em audit_imports (mesmos dados). file_type vira source 1:1.
    const [{ data: imps }, { data: totalsRpc }, { data: depsRpc }, { data: dMatches }, { data: logRows }, ifoodCompRows] = await Promise.all([
      supabase.from('audit_imports').select('file_type,status,file_name,imported_rows,created_at').eq('audit_period_id', periodId).order('created_at', { ascending: false }),
      supabase.rpc('get_audit_period_totals', { p_period_id: periodId }),
      supabase.rpc('get_audit_period_deposits', { p_period_id: periodId }),
      supabase.from('audit_daily_matches').select('match_date,expected_amount,deposited_amount,difference,transaction_count,status').eq('audit_period_id', periodId).order('match_date'),
      supabase.from('audit_period_log').select('id,action,user_id,reason,created_at').eq('audit_period_id', periodId).order('created_at', { ascending: true }),
      fetchAllPaginated<any>(
        supabase.from('audit_bank_deposits').select('matched_competencia_amount,matched_adjacente_amount').eq('audit_period_id', periodId).eq('bank', 'cresol').eq('category', 'ifood'),
      ),
    ]);
    setImports((imps as AuditImport[]) ?? []);
    // allImports = mesma fonte de imps, com source = file_type
    const allImps: PeriodImportRow[] = ((imps as any[]) ?? []).map((i: any) => ({
      audit_period_id: periodId,
      source: i.file_type as ImportSource,
      status: i.status,
      file_name: i.file_name,
      imported_rows: Number(i.imported_rows ?? 0),
      created_at: i.created_at,
    }));
    setAllImports(allImps);

    const t = (totalsRpc as any[])?.[0] ?? {};
    const bruto = Number(t.total_bruto ?? 0);
    const liquidoDeclarado = Number(t.total_liquido_declarado ?? 0);
    const liquidoIfood = Number(t.total_liquido_ifood ?? 0);
    const brutoIfood = Number(t.total_bruto_ifood ?? 0);
    // Taxa real Maquinona = gross - net (inclui taxa declarada + implícita/antecipação).
    // total_taxa_declarada da RPC só pega a parte explícita (subestima ~30%).
    const taxa = Math.max(brutoIfood - liquidoIfood, 0);
    const promocao = Number(t.total_promocao ?? 0);
    const promocaoIfood = Number((t as any).total_promocao_ifood ?? 0);
    const incentivoIfood = Number((t as any).total_incentivo_ifood ?? 0);
    const txCount = Number(t.total_count ?? 0);
    const custoDeclarado = Math.max(bruto - liquidoDeclarado, 0);

    const depRows = (depsRpc as { category: string | null; bank: string | null; match_status?: string | null; total_amount: number; deposit_count: number }[]) ?? [];

    // iFood matched de COMPETÊNCIA: usa audit_daily_matches como fonte da verdade
    // (escrita pelo run-audit-match com carry-forward, considera clusters de
    // feriado/carnaval). matched_competencia_amount do classify_ifood_deposits
    // não é cluster-aware e subestima.
    //
    // Após refactor do run-audit-match (match lote-a-lote por valor):
    // match_date em audit_daily_matches = sale_date (não expected_deposit_date).
    // Cada linha = soma dos lotes (PIX+CARD) daquela venda, com líq Maquinona
    // expected e Cresol deposited matched 1:1.
    //
    // Recebido competência = soma deposited das linhas do mês (= o que de
    // fato caiu na Cresol referente a vendas de fev, mesmo que tenha caído em mar).
    const dailyInPeriod = ((dMatches as any[]) ?? []).filter(d => {
      const [y, m] = d.match_date.split('-').map(Number);
      return y === year && m === month;
    });
    const ifoodComp = dailyInPeriod.reduce((s, d) => s + Number(d.deposited_amount || 0), 0);
    // Custo OCULTO REAL: soma dos abs(diff negativos) só dos lotes matched.
    // Cada row do daily_matches.difference = deposited - expected_matched (post-refactor).
    // Diff negativo = retenção real (PIX retido, antecipação extra não-declarada).
    const ifoodOcultoMatched = dailyInPeriod.reduce((s, d) => {
      const diff = Number(d.difference || 0);
      return s + (diff < 0 ? -diff : 0);
    }, 0);
    // Não conciliado: expected_total (do daily_matches) - expected_matched.
    // expected_matched = deposited - difference (= sum dos lotes que bateram).
    const ifoodNaoConciliado = dailyInPeriod.reduce((s, d) => {
      const expectedTotal = Number(d.expected_amount || 0);
      const deposited = Number(d.deposited_amount || 0);
      const diff = Number(d.difference || 0);
      const expectedMatched = deposited - diff; // recupera líq dos matched
      return s + Math.max(expectedTotal - expectedMatched, 0);
    }, 0);

    // Adjacentes = depósitos relativos a vendas de outros meses que bateram
    // por valor (jan/mar importados pra contexto).
    const dailyOutsidePeriod = ((dMatches as any[]) ?? []).filter(d => {
      const [y, m] = d.match_date.split('-').map(Number);
      return y !== year || m !== month;
    });
    const ifoodAdj = dailyOutsidePeriod.reduce((s, d) => s + Number(d.deposited_amount || 0), 0);
    setIfoodCompetencia(ifoodComp);
    setIfoodAdjacente(ifoodAdj);
    setIfoodNaoConciliado(ifoodNaoConciliado);

    const recebido = ifoodComp;
    const vendidoIfood = brutoIfood;
    const custoDeclaradoIfood = Math.max(brutoIfood - liquidoIfood, 0);
    // Custo oculto = só o que tem evidência (diff negativo dos matched).
    // Não inclui não-conciliado (esse é incerteza do match, não taxa real).
    const custoOculto = ifoodOcultoMatched;
    const custoTotal = custoDeclaradoIfood + custoOculto;
    const taxaEfetiva = vendidoIfood > 0 ? (custoTotal / vendidoIfood) * 100 : 0;

    setTotals({
      vendido: vendidoIfood, recebido, custo: custoTotal, taxaPct: taxaEfetiva,
      txCount, bruto, taxa: taxa + promocao, liquidoDeclarado, custoDeclarado,
      liquidoIfood, brutoIfood,
    });
    setCustoDeclaradoIfood(custoDeclaradoIfood);
    setCustoOculto(custoOculto);
    setPromocaoIfood(promocaoIfood);
    setIncentivoIfood(incentivoIfood);
    setDepositRows(depRows);
    
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
        setTotals({ vendido: 0, recebido: 0, custo: 0, taxaPct: 0, txCount: 0, bruto: 0, taxa: 0, liquidoDeclarado: 0, custoDeclarado: 0, liquidoIfood: 0, brutoIfood: 0 });
        
        setDailyMatches([]);
        setDepositRows([]);
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

  const importByType = (t: 'maquinona' | 'cresol') => imports.find(i => i.file_type === t);
  const allImported = ['maquinona', 'cresol'].every(t => importByType(t as any)?.status === 'completed');
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
      if ((data as any)?.ai_audits) setAiAudits((data as any).ai_audits);
      toast({
        title: '✓ Conciliação concluída',
        description: `${(data as any).daily_matches_count ?? 0} matches diários processados`,
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

  // Gap real do match: soma das diferenças no mês, EXCLUINDO linhas pending
  // (cujo expected já está incluído no expected acumulado do cluster que fechou
  // os dias subsequentes — somar pending dobra a contagem).
  const ifoodGap = dailyMatches
    .filter(m => {
      const [y, mm] = m.match_date.split('-').map(Number);
      return y === year && mm === month && m.status !== 'pending';
    })
    .reduce((s, m) => s + Number(m.difference || 0), 0);
  // Custo = vem direto de totals.custo (= taxa real Maquinona, gross-net).
  // Não calcula override aqui — manter consistente com setTotals.
  const custoReal = totals.custo;

  // Breakdown of bank deposits by match_status (for iFood card)
  const sumDeposits = (filterFn: (d: typeof depositRows[number]) => boolean) =>
    depositRows.filter(filterFn).reduce((s, d) => s + Number(d.total_amount || 0), 0);

  // iFood: matched usa SOMENTE valor de competência; adjacente vem do state ifoodAdjacente
  const ifoodMatched = ifoodCompetencia;
  const ifoodNaoId = sumDeposits(d => d.bank === 'cresol' && d.category === 'ifood' && d.match_status === 'nao_identificado');

  const periodLabelStr = makePeriodLabel(month, year);

  return (
    <AppLayout title="Auditoria de Taxas" subtitle="Conciliação Maquinona × Cresol (iFood físico)">
      <div className="space-y-4">
        <AuditNavTabs />

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


        {/* KPIs principais — Maquinona iFood */}
        {(() => {
          const recebidoCresol = ifoodCompetencia || totals.recebido;
          const vendido = totals.vendido;
          const custoTotal = vendido - recebidoCresol;
          return (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard title="Total vendido bruto" value={formatCurrency(vendido)} />
                <SummaryCard title="Custo declarado" value={formatCurrency(custoDeclaradoIfood)} />
                <SummaryCard title="Total recebido" value={formatCurrency(recebidoCresol)} />
                <SummaryCard title="Custo total" value={formatCurrency(custoTotal)} />
              </div>

              {/* Informativos compactos */}
              {(promocaoIfood > 0 || custoOculto > 0.5) && (
                <Card>
                  <CardContent className="py-3">
                    <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Informativo</div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
                      {promocaoIfood > 0 && (
                        <div>
                          <span className="text-muted-foreground">Cashback:</span>{' '}
                          <span className="font-medium">{formatCurrency(promocaoIfood)}</span>
                        </div>
                      )}
                      {custoOculto > 0.5 && (
                        <div>
                          <span className="text-muted-foreground">Custo não declarado:</span>{' '}
                          <span className="font-medium text-amber-700 dark:text-amber-500">{formatCurrency(custoOculto)}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 text-primary"
                  disabled={!canExport}
                  onClick={() => navigate(`/admin/auditoria/ifood?period=${period?.id}`)}
                >
                  Ver detalhes <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </>
          );
        })()}

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
