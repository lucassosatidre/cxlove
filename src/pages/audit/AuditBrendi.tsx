import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, RefreshCw, AlertCircle, CheckCircle2, ShoppingBag } from 'lucide-react';
import {
  UploadBrendiCard, UploadSaiposCard, dispatchMatchBrendi,
  type AuditPeriodLite,
} from '@/components/audit/UploadCards';

type DailyRow = {
  id: string;
  expected_credit_date: string;
  sale_dates: string[];
  pedidos_count: number;
  expected_amount: number;       // bruto
  expected_liquido: number;      // bruto - taxa declarada Brendi
  taxa_calculada: number;        // sum fee_per_pedido (Pix 0.5%+R$0.40 / Cr.Online 5.69%)
  received_amount: number;
  diff: number;                  // received - expected_liquido (próximo de 0 exceto mensalidade)
  diff_pct: number;
  status: string;
  note: string | null;
};

type CrosscheckResult = {
  ok: number;
  missing_in_brendi: Array<{ order_id: string; saipos_total: number; pagamento: string; data_venda?: string }>;
  missing_in_brendi_count: number;
  missing_in_saipos: Array<{ order_id: string; brendi_total: number; forma: string; created_at_remote?: string }>;
  missing_in_saipos_count: number;
  value_mismatch: Array<{ order_id: string; saipos_total: number; brendi_total: number; diff: number; data?: string }>;
  value_mismatch_count: number;
};

const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  matched: { label: '✓ Matched', className: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  pending: { label: 'Aguardando', className: 'bg-muted text-muted-foreground' },
  pending_manual: { label: '⚠ Manual', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  mensalidade_descontada: { label: '💰 Mensalidade', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  sem_deposito: { label: 'Sem depósito', className: 'bg-rose-500/15 text-rose-700 dark:text-rose-400' },
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const fmtDate = (iso: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

export default function AuditBrendi() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const now = new Date();

  const [month, setMonth] = useState<number>(Number(searchParams.get('month')) || now.getMonth() + 1);
  const [year, setYear] = useState<number>(Number(searchParams.get('year')) || now.getFullYear());
  const [tab, setTab] = useState<string>(searchParams.get('aba') ?? 'resumo');

  const [period, setPeriod] = useState<AuditPeriodLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [crosscheck, setCrosscheck] = useState<CrosscheckResult | null>(null);
  const [imports, setImports] = useState<Array<{ file_type: string; status: string; created_at: string; imported_rows: number }>>([]);
  const [brendiOrdersCount, setBrendiOrdersCount] = useState(0);
  const [brendiCashbackTotal, setBrendiCashbackTotal] = useState(0);
  const [brendiCashbackOrdersCount, setBrendiCashbackOrdersCount] = useState(0);
  const [saiposOrdersCount, setSaiposOrdersCount] = useState(0);

  // URL sync
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('month', String(month));
    next.set('year', String(year));
    if (tab === 'resumo') next.delete('aba');
    else next.set('aba', tab);
    setSearchParams(next, { replace: true });
  }, [month, year, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async (periodId: string) => {
    const [{ data: dailyRows }, { data: imps }, { count: brendiCount }, { count: saiposCount }, { data: cashbackData }] = await Promise.all([
      supabase
        .from('audit_brendi_daily')
        .select('id, expected_credit_date, sale_dates, pedidos_count, expected_amount, expected_liquido, taxa_calculada, received_amount, diff, diff_pct, status, note')
        .eq('audit_period_id', periodId)
        .order('expected_credit_date'),
      supabase
        .from('audit_imports')
        .select('file_type, status, created_at, imported_rows')
        .eq('audit_period_id', periodId)
        .in('file_type', ['brendi', 'saipos'])
        .order('created_at', { ascending: false }),
      supabase
        .from('audit_brendi_orders')
        .select('id', { count: 'exact', head: true })
        .eq('audit_period_id', periodId),
      supabase
        .from('audit_saipos_orders')
        .select('id', { count: 'exact', head: true })
        .eq('audit_period_id', periodId),
      supabase
        .from('audit_brendi_orders')
        .select('cashback_usado')
        .eq('audit_period_id', periodId)
        .gt('cashback_usado', 0),
    ]);
    setDaily((dailyRows ?? []) as DailyRow[]);
    setImports((imps ?? []) as any);
    setBrendiOrdersCount(brendiCount ?? 0);
    setSaiposOrdersCount(saiposCount ?? 0);
    setBrendiCashbackTotal((cashbackData ?? []).reduce((s, r) => s + Number(r.cashback_usado || 0), 0));
    setBrendiCashbackOrdersCount((cashbackData ?? []).length);
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
      else {
        setDaily([]); setImports([]); setBrendiOrdersCount(0); setSaiposOrdersCount(0);
        setBrendiCashbackTotal(0); setBrendiCashbackOrdersCount(0);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isAdmin, month, year]);

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

  const handleMatch = async () => {
    if (!period) return;
    setRunning(true);
    const result = await dispatchMatchBrendi(period.id);
    if (result) {
      setCrosscheck(result.crosscheck);
      toast.success(result.message);
      await refresh(period.id);
    }
    setRunning(false);
  };

  const onUploadAfter = async () => {
    if (period) await refresh(period.id);
  };

  const totals = useMemo(() => {
    const exp = daily.reduce((s, d) => s + Number(d.expected_amount || 0), 0);
    const expLiq = daily.reduce((s, d) => s + Number(d.expected_liquido || 0), 0);
    const taxaDecl = daily.reduce((s, d) => s + Number(d.taxa_calculada || 0), 0);
    const rec = daily.reduce((s, d) => s + Number(d.received_amount || 0), 0);
    const taxa = exp > 0 ? ((exp - rec) / exp) * 100 : 0;            // taxa efetiva total
    const taxaDeclPct = exp > 0 ? (taxaDecl / exp) * 100 : 0;        // taxa declarada Brendi
    const custoOculto = expLiq - rec;                                 // diff não explicado pelas taxas declaradas
    const pedidosMes = daily.reduce((s, d) => s + Number(d.pedidos_count || 0), 0);
    const pendingManualCount = daily.filter(d => d.status === 'pending_manual').length;
    const mensalidadeCount = daily.filter(d => d.status === 'mensalidade_descontada').length;
    const mensalidadeAmount = daily
      .filter(d => d.status === 'mensalidade_descontada')
      .reduce((s, d) => s + Math.abs(Number(d.diff || 0)), 0);
    return { exp, expLiq, taxaDecl, rec, taxa, taxaDeclPct, custoOculto, pedidosMes, pendingManualCount, mensalidadeCount, mensalidadeAmount };
  }, [daily]);

  if (roleLoading || loading) {
    return (
      <AppLayout title="Brendi">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="Brendi">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito a administradores.</CardContent></Card>
      </AppLayout>
    );
  }

  const importByType = (t: 'brendi' | 'saipos') => imports.find(i => i.file_type === t && i.status === 'completed');
  const brendiOk = !!importByType('brendi');
  const saiposOk = !!importByType('saipos');
  const canMatch = brendiOk && saiposOk;

  return (
    <AppLayout title="Brendi" subtitle="Custo Brendi (vendas online)">
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink onClick={() => navigate('/admin/auditoria')} className="cursor-pointer">
                Auditoria
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Brendi</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Seletor mês */}
        <Card>
          <CardContent className="py-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-muted-foreground">Mês</span>
              <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-muted-foreground">Ano</span>
              <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
                <SelectTrigger className="w-[110px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[year - 1, year, year + 1].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {period ? (
              <Badge variant="outline" className="font-medium">
                Período {MONTHS[period.month - 1]} {period.year} — {period.status}
              </Badge>
            ) : (
              <Badge variant="secondary">Sem período (será criado no upload)</Badge>
            )}
            <div className="ml-auto">
              <Button
                onClick={handleMatch}
                disabled={!canMatch || running}
                className="gap-2"
              >
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {running ? 'Executando…' : 'Executar match Brendi'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Cards de upload */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <UploadBrendiCard period={period} ensurePeriod={ensurePeriod} onAfter={onUploadAfter} />
          <UploadSaiposCard period={period} ensurePeriod={ensurePeriod} onAfter={onUploadAfter} />
        </div>

        {!canMatch && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-3 text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span>
                Importe <strong>Brendi</strong> e <strong>Saipos</strong> antes de executar o match.
                {!brendiOk && ' Falta Brendi.'}
                {!saiposOk && ' Falta Saipos.'}
              </span>
            </CardContent>
          </Card>
        )}

        {/* Sub-abas */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-4 w-full md:w-auto">
            <TabsTrigger value="resumo">Resumo</TabsTrigger>
            <TabsTrigger value="crosscheck">Cross-check Saipos × Brendi</TabsTrigger>
            <TabsTrigger value="diario">Auditoria PIX BB</TabsTrigger>
            <TabsTrigger value="pedidos">Pedidos importados</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === 'resumo' && (
          <ResumoTab
            totals={totals}
            brendiOrdersCount={brendiOrdersCount}
            saiposOrdersCount={saiposOrdersCount}
            cashbackTotal={brendiCashbackTotal}
            cashbackOrdersCount={brendiCashbackOrdersCount}
            crosscheck={crosscheck}
            daily={daily}
          />
        )}

        {tab === 'crosscheck' && (
          <CrosscheckTab
            crosscheck={crosscheck}
            onRefresh={handleMatch}
            running={running}
            canMatch={canMatch}
          />
        )}

        {tab === 'diario' && (
          <DiarioTab
            daily={daily}
            totals={totals}
          />
        )}

        {tab === 'pedidos' && period && (
          <PedidosTab periodId={period.id} />
        )}

        <Button variant="outline" onClick={() => navigate('/admin/auditoria')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar à Auditoria
        </Button>
      </div>
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ResumoTab({
  totals, brendiOrdersCount, saiposOrdersCount, cashbackTotal, cashbackOrdersCount, crosscheck, daily,
}: {
  totals: { exp: number; expLiq: number; taxaDecl: number; rec: number; taxa: number; taxaDeclPct: number; custoOculto: number; pedidosMes: number; pendingManualCount: number; mensalidadeCount: number; mensalidadeAmount: number };
  brendiOrdersCount: number;
  saiposOrdersCount: number;
  cashbackTotal: number;
  cashbackOrdersCount: number;
  crosscheck: CrosscheckResult | null;
  daily: DailyRow[];
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          title="Vendido bruto (Brendi online)"
          value={fmt(totals.exp)}
          hint={`${totals.pedidosMes} pedidos no mês · ${brendiOrdersCount} importados (3 meses)`}
        />
        <KpiCard
          title="Taxa declarada Brendi"
          value={`${totals.taxaDeclPct.toFixed(2).replace('.', ',')}%`}
          hint={`${fmt(totals.taxaDecl)} (Pix 0,5% + R$0,40 · Cr.Online 5,69%)`}
        />
        <KpiCard
          title="Esperado líquido"
          value={fmt(totals.expLiq)}
          hint={`Recebido BB: ${fmt(totals.rec)} (${daily.length} dias úteis)`}
        />
        <KpiCard
          title="Custo oculto"
          value={fmt(Math.abs(totals.custoOculto))}
          hint={`${totals.custoOculto > 0 ? 'Faltou' : 'Sobrou'} vs esperado · Mensalidade: ${fmt(totals.mensalidadeAmount)} (${totals.mensalidadeCount}x)`}
          className={Math.abs(totals.custoOculto) > 100 ? 'text-rose-700 dark:text-rose-400' : 'text-foreground'}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Cashback (informativo)</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cashback usado pelos clientes:</span>
              <span className="font-medium">{fmt(cashbackTotal)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Pedidos com cashback:</span>
              <span>{cashbackOrdersCount}</span>
            </div>
            <p className="text-xs text-muted-foreground italic pt-1">
              O Total (R$) já está líquido do cashback. Aqui é só visibilidade — não afeta o match.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Status do match</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            {crosscheck ? (
              <>
                <Row label="Cross-check OK" value={String(crosscheck.ok)} />
                <Row label="Só no Saipos (Brendi não declarou)" value={String(crosscheck.missing_in_brendi_count)}
                  tone={crosscheck.missing_in_brendi_count > 0 ? 'red' : 'normal'} />
                <Row label="Só no Brendi (sem Saipos)" value={String(crosscheck.missing_in_saipos_count)} />
                <Row label="Diferença de valor (>R$2)" value={String(crosscheck.value_mismatch_count)}
                  tone={crosscheck.value_mismatch_count > 0 ? 'amber' : 'normal'} />
              </>
            ) : (
              <p className="text-muted-foreground">Execute o match pra ver o cross-check.</p>
            )}
            <hr className="my-2" />
            <Row label="Dias matched" value={String(daily.filter(d => d.status === 'matched').length)} />
            <Row label="Dias pending manual (>5%)" value={String(totals.pendingManualCount)}
              tone={totals.pendingManualCount > 0 ? 'amber' : 'normal'} />
            <Row label="Dias com mensalidade descontada" value={String(totals.mensalidadeCount)} />
            <Row label="Dias sem depósito" value={String(daily.filter(d => d.status === 'sem_deposito').length)}
              tone={daily.filter(d => d.status === 'sem_deposito').length > 0 ? 'amber' : 'normal'} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CrosscheckTab({
  crosscheck, onRefresh, running, canMatch,
}: {
  crosscheck: CrosscheckResult | null;
  onRefresh: () => Promise<void>;
  running: boolean;
  canMatch: boolean;
}) {
  if (!crosscheck) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-center text-muted-foreground">
          {canMatch
            ? <Button onClick={onRefresh} disabled={running}>{running ? 'Executando…' : 'Executar cross-check agora'}</Button>
            : 'Importe Brendi + Saipos e execute o match pra ver o cross-check.'}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <Card className={crosscheck.missing_in_brendi_count > 0 ? 'border-rose-500/40 bg-rose-500/5' : ''}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            {crosscheck.missing_in_brendi_count > 0
              ? <AlertCircle className="h-4 w-4 text-rose-600" />
              : <CheckCircle2 className="h-4 w-4 text-green-600" />}
            Saipos viu, Brendi não declarou ({crosscheck.missing_in_brendi_count})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Pedidos online que o PDV registrou mas não apareceram no report Brendi. Possível repasse omisso (cobrável).
          </p>
        </CardHeader>
        {crosscheck.missing_in_brendi.length > 0 && (
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead className="text-right">Total Saipos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crosscheck.missing_in_brendi.map(r => (
                  <TableRow key={r.order_id}>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(r.data_venda)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.order_id}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{r.pagamento}</Badge></TableCell>
                    <TableCell className="text-right font-medium">{fmt(r.saipos_total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        )}
      </Card>

      {crosscheck.value_mismatch_count > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Diferença de valor entre Saipos e Brendi ({crosscheck.value_mismatch_count})</CardTitle>
            <p className="text-xs text-muted-foreground">Tolerância R$ 2,00. Diferenças maiores indicam ajuste pós-fato.</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Order ID</TableHead>
                  <TableHead className="text-right">Saipos</TableHead>
                  <TableHead className="text-right">Brendi</TableHead>
                  <TableHead className="text-right">Diff</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crosscheck.value_mismatch.map(r => (
                  <TableRow key={r.order_id}>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(r.data)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.order_id}</TableCell>
                    <TableCell className="text-right">{fmt(r.saipos_total)}</TableCell>
                    <TableCell className="text-right">{fmt(r.brendi_total)}</TableCell>
                    <TableCell className="text-right font-medium text-amber-700 dark:text-amber-500">{fmt(r.diff)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {crosscheck.missing_in_saipos_count > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Brendi declarou, Saipos não tem ({crosscheck.missing_in_saipos_count})</CardTitle>
            <p className="text-xs text-muted-foreground">Pedido no report Brendi sem correspondência no PDV. Investigar.</p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead className="text-right">Total Brendi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crosscheck.missing_in_saipos.map(r => (
                  <TableRow key={r.order_id}>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(r.created_at_remote)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.order_id}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{r.forma}</Badge></TableCell>
                    <TableCell className="text-right font-medium">{fmt(r.brendi_total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DiarioTab({
  daily, totals,
}: {
  daily: DailyRow[];
  totals: { exp: number; expLiq: number; taxaDecl: number; rec: number; taxa: number; taxaDeclPct: number; custoOculto: number; pedidosMes: number; pendingManualCount: number; mensalidadeCount: number; mensalidadeAmount: number };
}) {
  if (daily.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-center text-muted-foreground">
          Sem dados diários. Importe e execute o match.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Auditoria PIX BB (Brendi)</CardTitle>
        <p className="text-xs text-muted-foreground">
          1 row por dia útil de crédito esperado. Vendas de fim de semana e feriado consolidam no próximo dia útil.
          Status "Manual" = diff &gt; 5% — preencha override pra justificar.
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data crédito esperada</TableHead>
              <TableHead>Dias de venda</TableHead>
              <TableHead className="text-right">Pedidos</TableHead>
              <TableHead className="text-right">Bruto</TableHead>
              <TableHead className="text-right">Taxa Brendi</TableHead>
              <TableHead className="text-right">Esperado líq</TableHead>
              <TableHead className="text-right">Recebido BB</TableHead>
              <TableHead className="text-right">Diff</TableHead>
              <TableHead className="text-right">Diff %</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {daily.map(d => {
              const variant = STATUS_VARIANTS[d.status] ?? STATUS_VARIANTS.pending;
              return (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{fmtDate(d.expected_credit_date)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {d.sale_dates.map(s => fmtDate(s)).join(', ')}
                  </TableCell>
                  <TableCell className="text-right">{d.pedidos_count}</TableCell>
                  <TableCell className="text-right">{fmt(d.expected_amount)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">−{fmt(d.taxa_calculada)}</TableCell>
                  <TableCell className="text-right">{fmt(d.expected_liquido)}</TableCell>
                  <TableCell className="text-right">{fmt(d.received_amount)}</TableCell>
                  <TableCell className={`text-right font-medium ${d.diff < -0.5 ? 'text-rose-700 dark:text-rose-400' : d.diff > 0.5 ? 'text-amber-700 dark:text-amber-500' : ''}`}>
                    {fmt(d.diff)}
                  </TableCell>
                  <TableCell className="text-right">{fmtPct(d.diff_pct)}</TableCell>
                  <TableCell><Badge variant="secondary" className={variant.className}>{variant.label}</Badge></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="text-xs text-muted-foreground pt-3">
          Bruto: <strong>{fmt(totals.exp)}</strong> · Taxa Brendi declarada: <strong>{fmt(totals.taxaDecl)}</strong> ({totals.taxaDeclPct.toFixed(2).replace('.', ',')}%)
          {' · '}Esperado líquido: <strong>{fmt(totals.expLiq)}</strong> · Recebido BB: <strong>{fmt(totals.rec)}</strong>
          {' · '}Custo oculto: <strong className={Math.abs(totals.custoOculto) > 100 ? 'text-rose-700 dark:text-rose-400' : ''}>{fmt(totals.custoOculto)}</strong>
        </div>
      </CardContent>
    </Card>
  );
}

function PedidosTab({ periodId }: { periodId: string }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('audit_brendi_orders')
        .select('id, order_id, sale_date, forma_pagamento, total, taxa_entrega, cashback_usado, cliente_nome')
        .eq('audit_period_id', periodId)
        .order('sale_date', { ascending: false })
        .limit(500);
      if (!active) return;
      setOrders(data ?? []);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [periodId]);

  if (loading) return <Card><CardContent className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></CardContent></Card>;
  if (orders.length === 0) {
    return <Card><CardContent className="py-8 text-sm text-center text-muted-foreground">Sem pedidos importados.</CardContent></Card>;
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Pedidos online importados ({orders.length})</CardTitle>
        <p className="text-xs text-muted-foreground">Mostrando 500 mais recentes. Order ID casa com Saipos.id_pedido_parceiro.</p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Order ID</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Forma</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Taxa entrega</TableHead>
              <TableHead className="text-right">Cashback</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map(o => (
              <TableRow key={o.id}>
                <TableCell>{fmtDate(o.sale_date)}</TableCell>
                <TableCell className="font-mono text-xs">{o.order_id}</TableCell>
                <TableCell>{o.cliente_nome ?? '—'}</TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{o.forma_pagamento}</Badge></TableCell>
                <TableCell className="text-right font-medium">{fmt(Number(o.total))}</TableCell>
                <TableCell className="text-right text-xs">{fmt(Number(o.taxa_entrega || 0))}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground">
                  {Number(o.cashback_usado) > 0 ? fmt(Number(o.cashback_usado)) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// Helpers UI
function KpiCard({ title, value, hint, className = '' }: { title: string; value: string; hint?: string; className?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase text-muted-foreground tracking-wide">{title}</p>
        <p className={`text-2xl font-semibold mt-1 ${className}`}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'red' | 'amber' }) {
  const cls = tone === 'red' ? 'text-rose-700 dark:text-rose-400 font-semibold' : tone === 'amber' ? 'text-amber-700 dark:text-amber-500 font-semibold' : '';
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cls}>{value}</span>
    </div>
  );
}
