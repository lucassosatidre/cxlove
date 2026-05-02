import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, Loader2, Play, FileSpreadsheet, FileText, Landmark, Receipt,
} from 'lucide-react';

type AuditPeriod = { id: string; month: number; year: number; status: string };
type ImportRow = { file_type: string; status: string; created_at: string; imported_rows: number };

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// Fontes esperadas por mês de competência. Cada fonte sabe pra onde linkar
// pra o user importar se faltar. Multiplicidade indica quantos arquivos
// idealmente são esperados (ex: Maquinona = 3 — mês ant + comp + post).
type FonteSpec = {
  key: string;
  file_type: string;     // file_type em audit_imports
  label: string;
  description: string;
  expected: number;      // count esperado pra cobertura ideal
  importPath: string;    // rota pra importar
  importParams?: (period: AuditPeriod | null) => string;
  icon: any;
};

const FONTES: FonteSpec[] = [
  {
    key: 'maquinona',
    file_type: 'maquinona',
    label: 'Maquinona (iFood)',
    description: 'Vendas crédito/débito/PIX/voucher. Idealmente 3 arquivos: ant + comp + post.',
    expected: 1,
    importPath: '/admin/auditoria/importar',
    importParams: (p) => p ? `?period=${p.id}&tipo=maquinona&month=${p.month}&year=${p.year}` : '',
    icon: FileSpreadsheet,
  },
  {
    key: 'cresol',
    file_type: 'cresol',
    label: 'Cresol (extrato banco)',
    description: 'Depósitos iFood (crédito/débito/PIX). 1-3 arquivos.',
    expected: 1,
    importPath: '/admin/auditoria/importar',
    importParams: (p) => p ? `?period=${p.id}&tipo=cresol&month=${p.month}&year=${p.year}` : '',
    icon: Landmark,
  },
  {
    key: 'bb',
    file_type: 'bb',
    label: 'BB (extrato banco)',
    description: 'Depósitos voucher (Alelo/Ticket/VR/Pluxee). 1-3 arquivos.',
    expected: 1,
    importPath: '/admin/auditoria/vouchers',
    importParams: (p) => p ? `?month=${p.month}&year=${p.year}&aba=overview` : '',
    icon: Landmark,
  },
  {
    key: 'ticket',
    file_type: 'ticket',
    label: 'Ticket (PDF reembolsos)',
    description: 'Extrato de Reembolsos do portal Ticket (cobre comp + 30d).',
    expected: 1,
    importPath: '/admin/auditoria/vouchers',
    importParams: (p) => p ? `?month=${p.month}&year=${p.year}&aba=ticket` : '',
    icon: FileText,
  },
  {
    key: 'alelo',
    file_type: 'alelo',
    label: 'Alelo (XLSX vendas)',
    description: 'Extrato de vendas do portal Alelo (cobre comp).',
    expected: 1,
    importPath: '/admin/auditoria/vouchers',
    importParams: (p) => p ? `?month=${p.month}&year=${p.year}&aba=alelo` : '',
    icon: FileSpreadsheet,
  },
  {
    key: 'vr',
    file_type: 'vr',
    label: 'VR (XLS reembolsos + vendas)',
    description: 'Reembolsos + Vendas do portal VR.',
    expected: 2,
    importPath: '/admin/auditoria/vouchers',
    importParams: (p) => p ? `?month=${p.month}&year=${p.year}&aba=vr` : '',
    icon: FileSpreadsheet,
  },
  {
    key: 'pluxee',
    file_type: 'pluxee',
    label: 'Pluxee (CSV reembolsos)',
    description: 'Reembolsos do portal Pluxee. Idealmente 1 arquivo por mês (3 arquivos jan-mar).',
    expected: 3,
    importPath: '/admin/auditoria/vouchers',
    importParams: (p) => p ? `?month=${p.month}&year=${p.year}&aba=pluxee` : '',
    icon: FileText,
  },
];

// Pipelines a executar quando user clica "Auditar mês"
type Step = {
  key: string;
  label: string;
  run: (periodId: string) => Promise<{ ok: boolean; message: string }>;
};

const STEPS: Step[] = [
  {
    key: 'run-audit-match',
    label: 'Match iFood/Cresol (lote × depósito)',
    run: async (periodId) => {
      const { data, error } = await supabase.functions.invoke('run-audit-match', {
        body: { audit_period_id: periodId },
      });
      if (error) return { ok: false, message: error.message };
      if (!data?.success) return { ok: false, message: data?.error || 'Falha' };
      return { ok: true, message: `${data.daily_matches_count ?? 0} dias casados, diff iFood R$${(data.total_difference_ifood ?? 0).toFixed(2)}` };
    },
  },
  {
    key: 'match-vouchers-ticket',
    label: 'Match Ticket × BB',
    run: async (periodId) => {
      const { data, error } = await supabase.functions.invoke('match-vouchers', {
        body: { audit_period_id: periodId, operadora: 'ticket', reset: true },
      });
      if (error) return { ok: false, message: error.message };
      if (!data?.success) return { ok: false, message: data?.error || 'Falha' };
      return { ok: true, message: data.message ?? 'OK' };
    },
  },
  {
    key: 'match-vouchers-alelo',
    label: 'Match Alelo × BB',
    run: async (periodId) => {
      const { data, error } = await supabase.functions.invoke('match-vouchers', {
        body: { audit_period_id: periodId, operadora: 'alelo', reset: true },
      });
      if (error) return { ok: false, message: error.message };
      if (!data?.success) return { ok: false, message: data?.error || 'Falha' };
      return { ok: true, message: data.message ?? 'OK' };
    },
  },
  {
    key: 'match-vouchers-vr',
    label: 'Match VR × BB',
    run: async (periodId) => {
      const { data, error } = await supabase.functions.invoke('match-vouchers', {
        body: { audit_period_id: periodId, operadora: 'vr', reset: true },
      });
      if (error) return { ok: false, message: error.message };
      if (!data?.success) return { ok: false, message: data?.error || 'Falha' };
      return { ok: true, message: data.message ?? 'OK' };
    },
  },
  {
    key: 'match-vouchers-pluxee',
    label: 'Match Pluxee × BB',
    run: async (periodId) => {
      const { data, error } = await supabase.functions.invoke('match-vouchers', {
        body: { audit_period_id: periodId, operadora: 'pluxee', reset: true },
      });
      if (error) return { ok: false, message: error.message };
      if (!data?.success) return { ok: false, message: data?.error || 'Falha' };
      return { ok: true, message: data.message ?? 'OK' };
    },
  },
];

type StepStatus = 'pending' | 'running' | 'ok' | 'error';

export default function AuditarMes() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, loading: roleLoading } = useUserRole();

  const now = new Date();
  const [month, setMonth] = useState<number>(Number(searchParams.get('month')) || now.getMonth() + 1);
  const [year, setYear] = useState<number>(Number(searchParams.get('year')) || now.getFullYear());

  const [period, setPeriod] = useState<AuditPeriod | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [stepStatus, setStepStatus] = useState<Record<string, { status: StepStatus; message?: string }>>({});

  const refresh = async (periodId: string) => {
    const { data } = await supabase
      .from('audit_imports')
      .select('file_type, status, created_at, imported_rows')
      .eq('audit_period_id', periodId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false });
    setImports((data ?? []) as ImportRow[]);
  };

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('audit_periods').select('*').eq('month', month).eq('year', year).maybeSingle();
      const p = (data as AuditPeriod) ?? null;
      if (!active) return;
      setPeriod(p);
      if (p) await refresh(p.id);
      else setImports([]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isAdmin, month, year]);

  // Sync URL
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('month', String(month));
    next.set('year', String(year));
    setSearchParams(next, { replace: true });
  }, [month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const importCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const i of imports) map[i.file_type] = (map[i.file_type] ?? 0) + 1;
    return map;
  }, [imports]);

  // Mínimo viável pra rodar auditoria: maquinona + cresol importados.
  // BB e voucher operadoras são bônus (auditoria roda sem eles, só não faz match).
  const minimumOk = (importCounts['maquinona'] ?? 0) > 0 && (importCounts['cresol'] ?? 0) > 0;

  const ensurePeriod = async (): Promise<AuditPeriod | null> => {
    if (period) return period;
    const { data, error } = await supabase
      .from('audit_periods')
      .insert({ month, year, status: 'aberto' })
      .select()
      .single();
    if (error) {
      toast.error('Erro ao criar período', { description: error.message });
      return null;
    }
    const p = data as AuditPeriod;
    setPeriod(p);
    return p;
  };

  const runPipeline = async () => {
    const p = await ensurePeriod();
    if (!p) return;
    setRunning(true);
    setStepStatus({});
    const initial: Record<string, { status: StepStatus }> = {};
    for (const s of STEPS) initial[s.key] = { status: 'pending' };
    setStepStatus(initial);

    let allOk = true;
    for (const step of STEPS) {
      setStepStatus(prev => ({ ...prev, [step.key]: { status: 'running' } }));
      try {
        const result = await step.run(p.id);
        setStepStatus(prev => ({
          ...prev,
          [step.key]: { status: result.ok ? 'ok' : 'error', message: result.message },
        }));
        if (!result.ok) allOk = false;
      } catch (e: any) {
        setStepStatus(prev => ({
          ...prev,
          [step.key]: { status: 'error', message: e?.message ?? 'Erro inesperado' },
        }));
        allOk = false;
      }
    }
    setRunning(false);
    if (allOk) {
      toast.success('✓ Auditoria do mês concluída');
    } else {
      toast.error('Alguns passos falharam — veja o log');
    }
  };

  if (roleLoading || loading) {
    return (
      <AppLayout title="Auditar mês">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="Auditar mês">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito a administradores.</CardContent></Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Auditar mês" subtitle="Pipeline de auditoria">
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink onClick={() => navigate('/admin/auditoria')} className="cursor-pointer">
                Auditoria
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Auditar mês</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="py-3 text-sm">
            <strong>Pipeline orquestrado.</strong> Importe todos os extratos (ou pelo menos
            Maquinona + Cresol pra mínimo viável), confira o checklist abaixo e clique em
            <strong> Auditar mês</strong>. O sistema dispara o match iFood/Cresol e os 4
            matches voucher (Ticket/Alelo/VR/Pluxee) em sequência.
          </CardContent>
        </Card>

        {/* Seletor de mês */}
        <Card>
          <CardContent className="py-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-muted-foreground">Mês</span>
              <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-muted-foreground">Ano</span>
              <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
                <SelectTrigger className="w-[110px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[year - 1, year, year + 1].map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {period ? (
              <Badge variant="outline" className="font-medium">
                Período {MONTHS[period.month - 1]} {period.year} — {period.status}
              </Badge>
            ) : (
              <Badge variant="secondary">Sem período (será criado ao auditar)</Badge>
            )}
          </CardContent>
        </Card>

        {/* Checklist */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Checklist de fontes</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Cada fonte tem um count esperado de imports. Mínimo pra auditar: Maquinona + Cresol.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {FONTES.map(f => {
                const Icon = f.icon;
                const count = importCounts[f.file_type] ?? 0;
                const ok = count >= 1;
                const completo = count >= f.expected;
                return (
                  <div
                    key={f.key}
                    className="flex items-center gap-3 rounded-md border bg-card px-3 py-2"
                  >
                    <Icon className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <strong className="text-sm">{f.label}</strong>
                        {!ok ? (
                          <Badge variant="destructive" className="text-[10px]">Faltando</Badge>
                        ) : completo ? (
                          <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 text-[10px]">
                            ✓ {count}/{f.expected}
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px]">
                            {count}/{f.expected} parcial
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{f.description}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 shrink-0"
                      onClick={() => navigate(f.importPath + (f.importParams?.(period) ?? ''))}
                    >
                      Importar <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Botão Auditar mês + log de execução */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pipeline de auditoria</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              size="lg"
              variant="default"
              className="gap-2"
              disabled={!minimumOk || running}
              onClick={runPipeline}
            >
              {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
              {running ? 'Executando…' : 'Auditar mês'}
            </Button>
            {!minimumOk && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                ⚠ Importe Maquinona + Cresol (mínimo) pra habilitar.
              </p>
            )}

            {Object.keys(stepStatus).length > 0 && (
              <div className="space-y-1.5 mt-3">
                {STEPS.map(s => {
                  const st = stepStatus[s.key] ?? { status: 'pending' as StepStatus };
                  return (
                    <div
                      key={s.key}
                      className="flex items-center gap-2 text-sm py-1 border-b last:border-0"
                    >
                      <div className="w-5 shrink-0">
                        {st.status === 'pending' && <span className="text-muted-foreground">○</span>}
                        {st.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
                        {st.status === 'ok' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                        {st.status === 'error' && <AlertCircle className="h-4 w-4 text-rose-600" />}
                      </div>
                      <div className="flex-1">
                        <div className={st.status === 'error' ? 'text-rose-700 dark:text-rose-400' : ''}>
                          {s.label}
                        </div>
                        {st.message && (
                          <div className="text-xs text-muted-foreground">{st.message}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {!running && Object.values(stepStatus).every(s => s.status === 'ok') && Object.keys(stepStatus).length > 0 && (
              <div className="rounded border bg-green-500/10 border-green-500/30 px-3 py-2 mt-3 text-sm">
                ✓ Auditoria concluída. Próximo passo: revisar resultados em
                <Button variant="link" className="px-1 h-auto" onClick={() => period && navigate(`/admin/auditoria?month=${period.month}&year=${period.year}`)}>
                  Auditoria iFood/Cresol
                </Button>
                e
                <Button variant="link" className="px-1 h-auto" onClick={() => period && navigate(`/admin/auditoria/vouchers?month=${period.month}&year=${period.year}&aba=overview`)}>
                  Vouchers
                </Button>
                .
              </div>
            )}
          </CardContent>
        </Card>

        <Button variant="outline" onClick={() => navigate('/admin/auditoria')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar à Auditoria principal
        </Button>
      </div>
    </AppLayout>
  );
}
