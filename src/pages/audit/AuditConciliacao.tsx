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
  ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, Loader2, Play, RefreshCw,
} from 'lucide-react';
import {
  UploadMaquinonaCard, UploadCresolCard, UploadBBCard, UploadTicketCard,
  UploadAleloCard, UploadVRCard, UploadPluxeeCard, UploadBrendiCard, UploadSaiposCard,
  dispatchAutoMatchVouchers, dispatchMatchBrendi,
  type AuditPeriodLite,
} from '@/components/audit/UploadCards';

type ImportRow = { file_type: string; status: string; created_at: string; imported_rows: number };

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

type StepId = 'imports' | 'ifood' | 'vouchers' | 'brendi';

const STEPS: { id: StepId; label: string; subtitle: string }[] = [
  { id: 'imports', label: '1. Importar', subtitle: 'Maquinona, Cresol, BB, vouchers, Brendi, Saipos' },
  { id: 'ifood', label: '2. iFood', subtitle: 'Match Maquinona × Cresol' },
  { id: 'vouchers', label: '3. Vouchers', subtitle: 'Match Ticket / Alelo / VR / Pluxee × BB' },
  { id: 'brendi', label: '4. Brendi', subtitle: 'Cross-check Saipos × Brendi + match BB' },
];

// Fontes esperadas: cada item monta o card e o checklist do passo 1.
// `expected` = nº de imports ideal pra cobertura (mês ant + comp + post).
const FONTES: { file_type: string; label: string; expected: number; section: 'ifood' | 'voucher' | 'brendi' }[] = [
  { file_type: 'maquinona', label: 'Maquinona', expected: 3, section: 'ifood' },
  { file_type: 'cresol', label: 'Cresol', expected: 3, section: 'ifood' },
  { file_type: 'bb', label: 'BB', expected: 2, section: 'voucher' },
  { file_type: 'ticket', label: 'Ticket', expected: 1, section: 'voucher' },
  { file_type: 'alelo', label: 'Alelo', expected: 1, section: 'voucher' },
  { file_type: 'vr', label: 'VR', expected: 2, section: 'voucher' },
  { file_type: 'pluxee', label: 'Pluxee', expected: 1, section: 'voucher' },
  { file_type: 'brendi', label: 'Brendi', expected: 3, section: 'brendi' },
  { file_type: 'saipos', label: 'Saipos', expected: 3, section: 'brendi' },
];

export default function AuditConciliacao() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, loading: roleLoading } = useUserRole();

  const now = new Date();
  const [month, setMonth] = useState<number>(Number(searchParams.get('month')) || now.getMonth() + 1);
  const [year, setYear] = useState<number>(Number(searchParams.get('year')) || now.getFullYear());
  const [step, setStep] = useState<StepId>(((searchParams.get('step') as StepId) ?? 'imports'));

  const [period, setPeriod] = useState<AuditPeriodLite | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [runningIfood, setRunningIfood] = useState(false);
  const [ifoodResult, setIfoodResult] = useState<string | null>(null);
  const [runningVouchers, setRunningVouchers] = useState(false);
  const [voucherResult, setVoucherResult] = useState<string | null>(null);
  const [runningBrendi, setRunningBrendi] = useState(false);
  const [brendiResult, setBrendiResult] = useState<string | null>(null);

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
      const p = (data as AuditPeriodLite) ?? null;
      if (!active) return;
      setPeriod(p);
      if (p) await refresh(p.id);
      else setImports([]);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isAdmin, month, year]);

  // URL sync
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('month', String(month));
    next.set('year', String(year));
    next.set('step', step);
    setSearchParams(next, { replace: true });
  }, [month, year, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const importCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const i of imports) map[i.file_type] = (map[i.file_type] ?? 0) + 1;
    return map;
  }, [imports]);

  const ifoodReady = (importCounts['maquinona'] ?? 0) > 0 && (importCounts['cresol'] ?? 0) > 0;
  const vouchersReady = (importCounts['bb'] ?? 0) > 0;
  const brendiReady = (importCounts['brendi'] ?? 0) > 0 && (importCounts['saipos'] ?? 0) > 0;

  const ensurePeriod = async (): Promise<AuditPeriodLite | null> => {
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
    const p = data as AuditPeriodLite;
    setPeriod(p);
    return p;
  };

  const onUploadAfter = async () => {
    if (period) await refresh(period.id);
  };

  const handleRunIfood = async () => {
    const p = await ensurePeriod();
    if (!p) return;
    setRunningIfood(true);
    setIfoodResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('run-audit-match', {
        body: { audit_period_id: p.id },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Falha');
      const msg = `${data.daily_matches_count ?? 0} dias casados, diff R$${(data.total_difference_ifood ?? 0).toFixed(2)}`;
      setIfoodResult(msg);
      toast.success('✓ Match iFood/Cresol concluído', { description: msg });
    } catch (e: any) {
      const msg = e?.message ?? 'Erro inesperado';
      setIfoodResult(`Erro: ${msg}`);
      toast.error('Erro no match iFood', { description: msg });
    } finally {
      setRunningIfood(false);
    }
  };

  const handleRunVouchers = async () => {
    const p = await ensurePeriod();
    if (!p) return;
    setRunningVouchers(true);
    setVoucherResult(null);
    try {
      await dispatchAutoMatchVouchers(p.id, ['ticket', 'alelo', 'vr', 'pluxee']);
      setVoucherResult('Match disparado pra Ticket / Alelo / VR / Pluxee — veja toasts.');
      toast.success('✓ Match vouchers concluído');
    } catch (e: any) {
      const msg = e?.message ?? 'Erro inesperado';
      setVoucherResult(`Erro: ${msg}`);
      toast.error('Erro no match vouchers', { description: msg });
    } finally {
      setRunningVouchers(false);
    }
  };

  const handleRunBrendi = async () => {
    const p = await ensurePeriod();
    if (!p) return;
    setRunningBrendi(true);
    setBrendiResult(null);
    try {
      const res = await dispatchMatchBrendi(p.id);
      if (res) {
        const cc = res.crosscheck;
        const d = res.daily;
        setBrendiResult(`${d.rows} dias · ${cc.ok} ok / ${cc.missing_in_brendi_count} só Saipos / ${cc.value_mismatch_count} valores divergentes · taxa ${d.taxa_efetiva_pct}%`);
      } else {
        setBrendiResult('Erro: ver toasts');
      }
    } catch (e: any) {
      const msg = e?.message ?? 'Erro inesperado';
      setBrendiResult(`Erro: ${msg}`);
      toast.error('Erro no match Brendi', { description: msg });
    } finally {
      setRunningBrendi(false);
    }
  };

  if (roleLoading || loading) {
    return (
      <AppLayout title="Conciliação">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="Conciliação">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito a administradores.</CardContent></Card>
      </AppLayout>
    );
  }

  const stepIndex = STEPS.findIndex(s => s.id === step);

  return (
    <AppLayout title="Conciliação" subtitle="Importar → iFood → Vouchers → Brendi">
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink onClick={() => navigate('/admin/auditoria')} className="cursor-pointer">
                Auditoria
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Conciliação</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

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
              <Badge variant="secondary">Sem período (será criado ao importar)</Badge>
            )}
          </CardContent>
        </Card>

        {/* Stepper */}
        <Card>
          <CardContent className="py-3">
            <div className="flex items-stretch gap-2 overflow-x-auto">
              {STEPS.map((s, idx) => {
                const isActive = s.id === step;
                const isPast = idx < stepIndex;
                return (
                  <button
                    key={s.id}
                    onClick={() => setStep(s.id)}
                    className={`flex-1 min-w-[180px] text-left rounded-md border px-3 py-2 transition ${
                      isActive
                        ? 'border-blue-500 bg-blue-500/10'
                        : isPast
                          ? 'border-green-500/40 bg-green-500/5'
                          : 'border-border bg-card hover:bg-muted/50'
                    }`}
                  >
                    <div className="text-sm font-semibold">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{s.subtitle}</div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {step === 'imports' && (
          <ImportsStep
            period={period}
            ensurePeriod={ensurePeriod}
            onUploadAfter={onUploadAfter}
            importCounts={importCounts}
            onAdvance={() => setStep('ifood')}
            ifoodReady={ifoodReady}
          />
        )}

        {step === 'ifood' && (
          <IfoodStep
            ready={ifoodReady}
            running={runningIfood}
            result={ifoodResult}
            onRun={handleRunIfood}
            onBack={() => setStep('imports')}
            onAdvance={() => setStep('vouchers')}
            period={period}
            month={month}
            year={year}
          />
        )}

        {step === 'vouchers' && (
          <VouchersStep
            ready={vouchersReady}
            running={runningVouchers}
            result={voucherResult}
            onRun={handleRunVouchers}
            onBack={() => setStep('ifood')}
            onAdvance={() => setStep('brendi')}
            period={period}
            month={month}
            year={year}
          />
        )}

        {step === 'brendi' && (
          <BrendiStep
            ready={brendiReady}
            running={runningBrendi}
            result={brendiResult}
            onRun={handleRunBrendi}
            onBack={() => setStep('vouchers')}
            period={period}
            month={month}
            year={year}
          />
        )}
      </div>
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Imports — 7 upload cards + checklist
// ─────────────────────────────────────────────────────────────────────────────
function ImportsStep({
  period, ensurePeriod, onUploadAfter, importCounts, onAdvance, ifoodReady,
}: {
  period: AuditPeriodLite | null;
  ensurePeriod: () => Promise<AuditPeriodLite | null>;
  onUploadAfter: () => Promise<void>;
  importCounts: Record<string, number>;
  onAdvance: () => void;
  ifoodReady: boolean;
}) {
  // BB onAfter: dispara match-vouchers pras 4 operadoras (BB é a ponte BB→lote)
  const handleBBAfter = async () => {
    await onUploadAfter();
    if (period) await dispatchAutoMatchVouchers(period.id, ['ticket', 'alelo', 'vr', 'pluxee']);
  };
  const handleVoucherAfter = async (op: 'ticket' | 'alelo' | 'vr' | 'pluxee') => {
    await onUploadAfter();
    if (period) await dispatchAutoMatchVouchers(period.id, [op]);
  };

  return (
    <>
      {/* Checklist consolidado */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Checklist de fontes</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Mínimo pra avançar pra <strong>iFood</strong>: Maquinona + Cresol.
            Pra <strong>Vouchers</strong>: BB + ao menos 1 operadora.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {FONTES.map(f => {
              const count = importCounts[f.file_type] ?? 0;
              const ok = count >= 1;
              const completo = count >= f.expected;
              return (
                <div key={f.file_type} className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5">
                  <span className="text-sm font-medium">{f.label}</span>
                  {!ok ? (
                    <Badge variant="destructive" className="text-[10px] ml-auto">faltando</Badge>
                  ) : completo ? (
                    <Badge className="bg-green-500/15 text-green-700 dark:text-green-400 text-[10px] ml-auto">
                      ✓ {count}/{f.expected}
                    </Badge>
                  ) : (
                    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 text-[10px] ml-auto">
                      {count}/{f.expected}
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Cards de upload — iFood */}
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium px-1">
          iFood (Maquinona × Cresol)
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <UploadMaquinonaCard period={period} ensurePeriod={ensurePeriod} onAfter={onUploadAfter} />
          <UploadCresolCard period={period} ensurePeriod={ensurePeriod} onAfter={onUploadAfter} />
        </div>
      </div>

      {/* Cards de upload — Vouchers */}
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium px-1">
          Vouchers (Ticket / Alelo / VR / Pluxee × BB)
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <UploadBBCard period={period} ensurePeriod={ensurePeriod} onAfter={handleBBAfter} />
          <UploadTicketCard period={period} ensurePeriod={ensurePeriod} onAfter={() => handleVoucherAfter('ticket')} />
          <UploadAleloCard period={period} ensurePeriod={ensurePeriod} onAfter={() => handleVoucherAfter('alelo')} />
          <UploadVRCard period={period} ensurePeriod={ensurePeriod} onAfter={() => handleVoucherAfter('vr')} />
          <UploadPluxeeCard period={period} ensurePeriod={ensurePeriod} onAfter={() => handleVoucherAfter('pluxee')} />
        </div>
      </div>

      {/* Cards de upload — Brendi (estágio 3) */}
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium px-1">
          Brendi (vendas online × BB)
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <UploadBrendiCard period={period} ensurePeriod={ensurePeriod} onAfter={onUploadAfter} />
          <UploadSaiposCard period={period} ensurePeriod={ensurePeriod} onAfter={onUploadAfter} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={onAdvance} disabled={!ifoodReady} className="gap-2">
          Avançar para iFood <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: iFood — run-audit-match
// ─────────────────────────────────────────────────────────────────────────────
function IfoodStep({
  ready, running, result, onRun, onBack, onAdvance, period, month, year,
}: {
  ready: boolean;
  running: boolean;
  result: string | null;
  onRun: () => Promise<void>;
  onBack: () => void;
  onAdvance: () => void;
  period: AuditPeriodLite | null;
  month: number;
  year: number;
}) {
  const navigate = useNavigate();
  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Conciliação iFood</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Pareia cada lote (sale_date × tipo PIX/CARD) da Maquinona com o depósito Cresol mais próximo
            em valor (tolerância 10%, janela de 14 dias). Diff negativo = custo oculto cobrável.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {!ready && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              ⚠ Importe Maquinona + Cresol (passo 1) pra habilitar.
            </p>
          )}
          <Button
            size="lg"
            variant="default"
            className="gap-2"
            disabled={!ready || running}
            onClick={onRun}
          >
            {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
            {running ? 'Executando…' : (result ? 'Reexecutar match' : 'Executar match iFood')}
          </Button>
          {result && (
            <div className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${
              result.startsWith('Erro') ? 'border-rose-500/40 bg-rose-500/5' : 'border-green-500/40 bg-green-500/5'
            }`}>
              {result.startsWith('Erro')
                ? <AlertCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                : <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />}
              <span>{result}</span>
            </div>
          )}
          {period && (
            <Button
              variant="link"
              className="px-0 h-auto"
              onClick={() => navigate(`/admin/auditoria?month=${month}&year=${year}`)}
            >
              Ver KPIs e tabela diária no Dashboard <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <Button onClick={onAdvance} className="gap-2">
          Avançar para Vouchers <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Vouchers — match-vouchers pras 4 operadoras
// ─────────────────────────────────────────────────────────────────────────────
function VouchersStep({
  ready, running, result, onRun, onBack, onAdvance, period, month, year,
}: {
  ready: boolean;
  running: boolean;
  result: string | null;
  onRun: () => Promise<void>;
  onBack: () => void;
  onAdvance: () => void;
  period: AuditPeriodLite | null;
  month: number;
  year: number;
}) {
  const navigate = useNavigate();
  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Conciliação Vouchers</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Pareia cada lote voucher (Ticket / Alelo / VR / Pluxee) com o depósito BB
            correspondente. Algoritmo em 3 passes (1↔1, 1↔2 dep somados, N↔1 dep) com
            normalização de data útil e tolerâncias por operadora.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {!ready && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              ⚠ Importe BB (passo 1) pra habilitar. Operadoras sem extrato ficarão sem lotes pra parear.
            </p>
          )}
          <Button
            size="lg"
            variant="default"
            className="gap-2"
            disabled={!ready || running}
            onClick={onRun}
          >
            {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
            {running ? 'Executando…' : (result ? 'Reexecutar match' : 'Executar match vouchers')}
          </Button>
          {result && (
            <div className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${
              result.startsWith('Erro') ? 'border-rose-500/40 bg-rose-500/5' : 'border-green-500/40 bg-green-500/5'
            }`}>
              {result.startsWith('Erro')
                ? <AlertCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                : <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />}
              <span>{result}</span>
            </div>
          )}
          {period && (
            <Button
              variant="link"
              className="px-0 h-auto"
              onClick={() => navigate(`/admin/auditoria/vouchers?month=${month}&year=${year}&aba=overview`)}
            >
              Ver lotes, depósitos e cross-check no Vouchers <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <Button onClick={onAdvance} className="gap-2">
          Avançar para Brendi <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4: Brendi — match-brendi (cross-check Saipos × Brendi + daily BB)
// ─────────────────────────────────────────────────────────────────────────────
function BrendiStep({
  ready, running, result, onRun, onBack, period, month, year,
}: {
  ready: boolean;
  running: boolean;
  result: string | null;
  onRun: () => Promise<void>;
  onBack: () => void;
  period: AuditPeriodLite | null;
  month: number;
  year: number;
}) {
  const navigate = useNavigate();
  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Conciliação Brendi</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Cross-check Saipos × Brendi (1-pra-1 por order_id, tolerância R$ 2,00) + match agregado
            por dia útil de crédito (D+1) com PIX BB Brendi. Detecta mensalidade descontada e marca
            divergências &gt; 5% pra preenchimento manual.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {!ready && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              ⚠ Importe Brendi + Saipos (passo 1) pra habilitar. Saipos é obrigatório pro cross-check.
            </p>
          )}
          <Button
            size="lg"
            variant="default"
            className="gap-2"
            disabled={!ready || running}
            onClick={onRun}
          >
            {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <RefreshCw className="h-5 w-5" />}
            {running ? 'Executando…' : (result ? 'Reexecutar match' : 'Executar match Brendi')}
          </Button>
          {result && (
            <div className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${
              result.startsWith('Erro') ? 'border-rose-500/40 bg-rose-500/5' : 'border-green-500/40 bg-green-500/5'
            }`}>
              {result.startsWith('Erro')
                ? <AlertCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                : <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />}
              <span>{result}</span>
            </div>
          )}
          {period && (
            <Button
              variant="link"
              className="px-0 h-auto"
              onClick={() => navigate(`/admin/auditoria/brendi?month=${month}&year=${year}`)}
            >
              Ver Resumo, cross-check e daily no Brendi <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Button>
        <Button
          variant="default"
          onClick={() => navigate(`/admin/auditoria?month=${month}&year=${year}`)}
          className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          Concluído — voltar ao Dashboard <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </>
  );
}
