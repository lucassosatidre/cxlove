import { Fragment, useEffect, useMemo, useState } from 'react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Loader2, RefreshCw, AlertCircle, CheckCircle2, Copy } from 'lucide-react';
import {
  UploadIfoodExtratoDetalhadoCard, UploadIfoodContaCsvCard, UploadIfoodOrdersCard,
  dispatchMatchIfoodMarketplace,
  type AuditPeriodLite,
} from '@/components/audit/UploadCards';
import AuditNavTabs from '@/components/audit/AuditNavTabs';

type Repasse = {
  id: string;
  store_id_curto: string;
  data_repasse_esperada: string;
  periodo_apuracao_inicio: string | null;
  periodo_apuracao_fim: string | null;
  bruto_venda: number;
  pgto_direto_loja: number;
  comissao: number;
  taxa_transacao: number;
  taxa_conveniencia: number;
  taxa_entrega_ret: number;
  taxa_servico_sob_demanda: number;
  taxa_servico_cliente: number;
  promo_ifood: number;
  promo_loja: number;
  frete_ifood: number;
  cancel_frete: number;
  cancel_total: number;
  cancel_parcial: number;
  ads: number;
  frota_garantida: number;
  ressarc: number;
  ocor_venda: number;
  reembolsos: number;
  mensalidade: number;
  outros: number;
  liquido_esperado: number;
  conta_recebido: number | null;
  conta_data_recebimento: string | null;
  conta_taxa_antecip: number | null;
  liquido_efetivo: number | null;
  status: string;
  diff: number | null;
};

type CrosscheckResult = {
  ok: number;
  missing_in_ifood: Array<{ order_id: string; saipos_total: number; pagamento: string; data_venda?: string }>;
  missing_in_ifood_count: number;
  missing_in_saipos: Array<{ order_id: string; ifood_total_pago: number; ifood_liquido: number; data_pedido?: string; store_id_curto?: string }>;
  missing_in_saipos_count: number;
  // Pedidos no relatório iFood com valor_liquido<0 (ajustes pós-fato:
  // cancelamentos/reembolsos reaparecendo num mês posterior). Não são
  // pedidos novos faltando no Saipos — exibidos separados pra não inflar.
  missing_in_saipos_adjustments?: Array<{ order_id: string; ifood_total_pago: number; ifood_liquido: number; data_pedido?: string; store_id_curto?: string }>;
  missing_in_saipos_adjustments_count?: number;
  value_mismatch: Array<{ order_id: string; saipos_total: number; ifood_total_pago: number; ifood_taxa_servico?: number; diff: number; diff_sem_taxa_servico?: number; data?: string; pagamento_saipos?: string; store_id_curto?: string }>;
  value_mismatch_count: number;
};

const STORE_LABEL: Record<string, string> = {
  '40566': 'Pizzaria Estrela',
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const fmtDate = (iso: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; }
};
const storeName = (sid: string | null) => sid ? (STORE_LABEL[sid] ?? sid) : '—';

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const STATUS_VARIANTS: Record<string, { label: string; className: string }> = {
  matched: { label: '✓ Matched', className: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  matched_aprox: { label: '✓ Aprox', className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  pending: { label: 'Aguardando', className: 'bg-muted text-muted-foreground' },
  unmatched: { label: '⚠ Manual', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  sem_repasse: { label: 'Sem repasse', className: 'bg-rose-500/15 text-rose-700 dark:text-rose-400' },
};

export default function AuditIfoodMarketplace() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const now = new Date();

  const [month, setMonth] = useState<number>(Number(searchParams.get('month')) || now.getMonth() + 1);
  const [year, setYear] = useState<number>(Number(searchParams.get('year')) || now.getFullYear());
  const [tab, setTab] = useState<string>(searchParams.get('aba') ?? 'resumo');
  const [storeFilter, setStoreFilter] = useState<string>(searchParams.get('loja') ?? 'all');

  const [period, setPeriod] = useState<AuditPeriodLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const [repasses, setRepasses] = useState<Repasse[]>([]);
  const [crosscheck, setCrosscheck] = useState<CrosscheckResult | null>(null);
  const [imports, setImports] = useState<Array<{ file_type: string; status: string; created_at: string; imported_rows: number; file_name: string }>>([]);
  const [stores, setStores] = useState<string[]>([]);
  const [matchDebug, setMatchDebug] = useState<any>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  // URL sync
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('month', String(month));
    next.set('year', String(year));
    if (tab === 'resumo') next.delete('aba'); else next.set('aba', tab);
    if (storeFilter === 'all') next.delete('loja'); else next.set('loja', storeFilter);
    setSearchParams(next, { replace: true });
  }, [month, year, tab, storeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async (periodId: string) => {
    // cast pra any: tipos novos (audit_ifood_repasses/lancamentos) ainda não
    // estão no types.ts até Lovable regenerar após aplicar a migration.
    const sb: any = supabase;
    const [{ data: repassesData }, { data: imps }, { data: lojasData }] = await Promise.all([
      sb
        .from('audit_ifood_repasses')
        .select('*')
        .eq('audit_period_id', periodId)
        .order('data_repasse_esperada')
        .order('store_id_curto'),
      supabase
        .from('audit_imports')
        .select('file_type, status, created_at, imported_rows, file_name')
        .eq('audit_period_id', periodId)
        .in('file_type', ['ifood_extrato_detalhado', 'ifood_conta_csv', 'ifood_orders', 'saipos'])
        .order('created_at', { ascending: false }),
      sb
        .from('audit_ifood_lancamentos')
        .select('store_id_curto')
        .eq('audit_period_id', periodId),
    ]);
    setRepasses(((repassesData ?? []) as unknown) as Repasse[]);
    setImports((imps ?? []) as any);
    setStores([...new Set((lojasData ?? []).map((r: any) => r.store_id_curto).filter(Boolean))] as string[]);
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
      else { setRepasses([]); setImports([]); setStores([]); }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isAdmin, month, year]);

  const ensurePeriod = async (): Promise<AuditPeriodLite | null> => {
    if (period) return period;
    const { data, error } = await supabase
      .from('audit_periods').insert({ month, year, status: 'aberto' }).select().single();
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
    const result = await dispatchMatchIfoodMarketplace(period.id);
    if (result) {
      setCrosscheck(result.crosscheck);
      setMatchDebug(result);
      toast.success(result.message);
      await refresh(period.id);
    }
    setRunning(false);
  };

  const onUploadAfter = async () => {
    if (period) await refresh(period.id);
  };

  // Filtra repasses pela loja escolhida
  const repassesFiltrados = useMemo(() => {
    if (storeFilter === 'all') return repasses;
    return repasses.filter(r => r.store_id_curto === storeFilter);
  }, [repasses, storeFilter]);

  // Agregação consolidada (todas datas filtradas pela loja escolhida)
  const totals = useMemo(() => {
    const sum = (k: keyof Repasse) => repassesFiltrados.reduce((s, r) => s + Number(r[k] || 0), 0);
    const bruto_venda = sum('bruto_venda');
    const pgto_direto_loja = sum('pgto_direto_loja');
    const comissao = sum('comissao');
    const taxa_transacao = sum('taxa_transacao');
    const taxa_conveniencia = sum('taxa_conveniencia');
    const taxa_entrega_ret = sum('taxa_entrega_ret');
    const taxa_servico_sob_demanda = sum('taxa_servico_sob_demanda');
    const taxa_servico_cliente = sum('taxa_servico_cliente');
    const promo_ifood = sum('promo_ifood');
    const promo_loja = sum('promo_loja');
    const frete_ifood = sum('frete_ifood');
    const cancel_frete = sum('cancel_frete');
    const cancel_total = sum('cancel_total');
    const cancel_parcial = sum('cancel_parcial');
    const ads = sum('ads');
    const frota_garantida = sum('frota_garantida');
    const ressarc = sum('ressarc');
    const ocor_venda = sum('ocor_venda');
    const reembolsos = sum('reembolsos');
    const mensalidade = sum('mensalidade');
    const outros = sum('outros');
    const liquido_esperado = sum('liquido_esperado');
    const conta_recebido = sum('conta_recebido');
    const conta_taxa_antecip = sum('conta_taxa_antecip');
    const liquido_efetivo = sum('liquido_efetivo');
    // Vendido pelo iFood = SOMENTE online (transacionado pela plataforma).
    // pgto_direto_loja é dinheiro/Pix/maquinininha, já contabilizado em outras
    // categorias do relatório contábil.
    const vendido_total = bruto_venda;

    // Custos que SOMAM no total (sinal negativo no DB → abs pra exibição)
    const custos_taxas = Math.abs(comissao) + Math.abs(taxa_transacao) + Math.abs(taxa_conveniencia)
      + Math.abs(mensalidade) + Math.abs(conta_taxa_antecip || 0);
    const custos_logistica = Math.abs(frete_ifood) + Math.abs(taxa_entrega_ret) + Math.abs(taxa_servico_sob_demanda) + Math.abs(frota_garantida);
    const custos_marketing = Math.abs(ads); // promo_loja é informativo
    const custo_total = custos_taxas + custos_logistica + custos_marketing;

    const taxa_efetiva = vendido_total > 0 ? (custo_total / vendido_total) * 100 : 0;
    return {
      bruto_venda, pgto_direto_loja, vendido_total,
      comissao, taxa_transacao, taxa_conveniencia, taxa_entrega_ret,
      taxa_servico_sob_demanda, taxa_servico_cliente,
      promo_ifood, promo_loja,
      frete_ifood, cancel_frete, cancel_total, cancel_parcial,
      ads, frota_garantida, ressarc, ocor_venda, reembolsos, mensalidade, outros,
      liquido_esperado, conta_recebido, conta_taxa_antecip, liquido_efetivo,
      custos_taxas, custos_logistica, custos_marketing, custo_total,
      taxa_efetiva,
    };
  }, [repassesFiltrados]);

  if (roleLoading || loading) {
    return (
      <AppLayout title="iFood Marketplace">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="iFood Marketplace">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito a administradores.</CardContent></Card>
      </AppLayout>
    );
  }

  const importByType = (t: string) => imports.find(i => i.file_type === t && i.status === 'completed');
  const extratoOk = imports.some(i => i.file_type === 'ifood_extrato_detalhado' && i.status === 'completed');
  const extratoCount = imports.filter(i => i.file_type === 'ifood_extrato_detalhado' && i.status === 'completed').length;
  const ordersOk = imports.some(i => i.file_type === 'ifood_orders' && i.status === 'completed');
  const ordersCount = imports.filter(i => i.file_type === 'ifood_orders' && i.status === 'completed').length;
  const contaOk = imports.some(i => i.file_type === 'ifood_conta_csv' && i.status === 'completed');
  const contaCount = imports.filter(i => i.file_type === 'ifood_conta_csv' && i.status === 'completed').length;
  const saiposOk = !!importByType('saipos');
  const canMatch = extratoOk && ordersOk && contaOk;

  return (
    <AppLayout title="iFood Marketplace" subtitle="Auditoria das vendas online iFood (Estrela + TEMX)">
      <div className="space-y-4">
        <AuditNavTabs />

        {/* Seletor mês + loja + match */}
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
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-muted-foreground">Loja</span>
              <Select value={storeFilter} onValueChange={setStoreFilter}>
                <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Consolidado</SelectItem>
                  {stores.map(s => <SelectItem key={s} value={s}>{storeName(s)} ({s})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {period ? (
              <Badge variant="outline" className="font-medium">
                Período {MONTHS[period.month - 1]} {period.year} — {period.status}
              </Badge>
            ) : (
              <Badge variant="secondary">Sem período (criado no upload)</Badge>
            )}
            <div className="ml-auto flex gap-2">
              {matchDebug && (
                <Button variant="outline" size="sm" onClick={() => setDebugOpen(true)}>
                  Diagnóstico
                </Button>
              )}
              <Button onClick={handleMatch} disabled={!canMatch || running} className="gap-2">
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {running ? 'Executando…' : 'Executar match iFood'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {!canMatch && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-3 text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <span>
                Importe Extrato Detalhado + Relatório de Pedidos + Conta iFood Pago em <a href="/admin/auditoria/importacoes" className="underline font-semibold">Importações</a> antes do match.
              </span>
            </CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-3 w-full md:w-auto">
            <TabsTrigger value="resumo">Resumo</TabsTrigger>
            <TabsTrigger value="repasses">Repasses semanais</TabsTrigger>
            <TabsTrigger value="crosscheck">Cross-check Saipos × iFood</TabsTrigger>
          </TabsList>
        </Tabs>

        {tab === 'resumo' && <ResumoTab totals={totals} repasses={repassesFiltrados} />}
        {tab === 'repasses' && <RepassesTab repasses={repassesFiltrados} />}
        {tab === 'crosscheck' && (
          <CrosscheckTab crosscheck={crosscheck} onRefresh={handleMatch} running={running} canMatch={canMatch} />
        )}

        <Button variant="outline" onClick={() => navigate('/admin/auditoria')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar à Auditoria
        </Button>
      </div>

      <Dialog open={debugOpen} onOpenChange={setDebugOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Diagnóstico do Match (resposta crua da edge)</DialogTitle>
          </DialogHeader>
          <div className="text-xs space-y-2">
            <p className="text-muted-foreground">
              Cole esse JSON para análise. Mostra antecipações encontradas, datas calculadas,
              repasses esperados e contadores. Útil pra debugar quando o match não fecha.
            </p>
            <pre className="bg-muted/40 rounded p-3 overflow-x-auto text-[11px] font-mono">
              {JSON.stringify(matchDebug, null, 2)}
            </pre>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(matchDebug, null, 2));
                toast.success('JSON copiado');
              }}
              className="gap-2"
            >
              <Copy className="h-3 w-3" /> Copiar JSON
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDebugOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Checklist({ label, done, count, target, optional }: { label: string; done: boolean; count?: number; target?: number; optional?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {done
        ? <CheckCircle2 className="h-4 w-4 text-green-600" />
        : <span className="inline-block h-4 w-4 rounded border border-muted-foreground/40" />}
      <span className={done ? 'text-muted-foreground line-through' : ''}>{label}</span>
      {target != null && <span className="text-xs text-muted-foreground">({count ?? 0}/{target})</span>}
      {optional && <Badge variant="outline" className="text-[10px]">opcional</Badge>}
    </div>
  );
}

function ResumoTab({ totals, repasses }: { totals: any; repasses: Repasse[] }) {
  // Conta de ciclos = datas únicas de repasse (não linhas/lojas)
  const ciclosCount = new Set(repasses.map(r => r.data_repasse_esperada)).size;
  // Faturamento total iFood = online + direto loja (universo da plataforma)
  const faturamentoTotalIfood = totals.bruto_venda + totals.pgto_direto_loja;
  const taxaEfetivaSobreTotal = faturamentoTotalIfood > 0
    ? (totals.custo_total / faturamentoTotalIfood) * 100
    : 0;

  // Subtotal único (Taxas + Marketing fundidos)
  const subtotalTaxas = totals.custos_taxas + totals.custos_marketing;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard title="Vendido pelo iFood (online)" value={fmt(totals.vendido_total)} />
        <KpiCard title="Líquido esperado" value={fmt(totals.liquido_esperado)}
          hint={`${ciclosCount} repasses · valor bruto sem antecipação`} />
        <KpiCard title="Custo total iFood" value={fmt(totals.custo_total)}
          hint={`Taxa efetiva: ${taxaEfetivaSobreTotal.toFixed(2).replace('.', ',')}% sobre o faturamento total iFood`}
          className={totals.custo_total > 0 ? 'text-rose-700 dark:text-rose-400' : ''} />
        <KpiCard title="Recebido direto pela loja" value={fmt(totals.pgto_direto_loja)}
          hint="Pgto na entrega + Dinheiro (não passa pelo iFood Pago)" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Taxas</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Comissão iFood" value={fmt(Math.abs(totals.comissao))} />
            <Row label="Taxa de transação" value={fmt(Math.abs(totals.taxa_transacao))} />
            <Row label="Taxa de antecipação" value={fmt(Math.abs(totals.conta_taxa_antecip || 0))} />
            <Row label="Taxa conveniência parcelado" value={fmt(Math.abs(totals.taxa_conveniencia))} />
            <Row label="Mensalidade" value={fmt(Math.abs(totals.mensalidade))} />
            <Row label="ADS" value={fmt(Math.abs(totals.ads))} />
            <hr className="my-1" />
            <Row label="Subtotal" value={fmt(subtotalTaxas)} bold />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Logística</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Frete iFood" value={fmt(Math.abs(totals.frete_ifood))} />
            <Row label="Taxa entrega retenção" value={fmt(Math.abs(totals.taxa_entrega_ret))} />
            <Row label="Taxa serviço Sob Demanda Off" value={fmt(Math.abs(totals.taxa_servico_sob_demanda))} />
            <Row label="Frota Garantida" value={fmt(Math.abs(totals.frota_garantida))} />
            <hr className="my-1" />
            <Row label="Subtotal" value={fmt(totals.custos_logistica)} bold />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Informativo</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <Row label="Cancelamentos (total)" value={fmt(Math.abs(totals.cancel_total))} muted />
            <Row label="Cancelamentos (parcial)" value={fmt(Math.abs(totals.cancel_parcial))} muted />
            <Row label="Reembolsos pra loja" value={fmt(totals.reembolsos)} muted />
            <Row label="Ressarcimentos" value={fmt(totals.ressarc)} muted />
            <Row label="Promo iFood (devolução)" value={fmt(totals.promo_ifood)} muted />
            <Row label="Taxa serviço cliente (retido)" value={fmt(Math.abs(totals.taxa_servico_cliente))} muted />
            <Row label="Promoções loja" value={fmt(Math.abs(totals.promo_loja))} muted />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RepassesTab({ repasses }: { repasses: Repasse[] }) {
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  // Agrupa repasses por data esperada — iFood faz UM PIX por ciclo somando todas
  // as lojas. A tabela mostra 1 linha por data com os valores consolidados.
  const grupos = useMemo(() => {
    const byDate = new Map<string, Repasse[]>();
    for (const r of repasses) {
      const arr = byDate.get(r.data_repasse_esperada) ?? [];
      arr.push(r);
      byDate.set(r.data_repasse_esperada, arr);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, items]) => {
        const totalBruto = items.reduce((s, r) => s + Number(r.liquido_esperado || 0), 0);
        const totalLiquido = items.reduce((s, r) => s + Number(r.liquido_efetivo ?? r.conta_recebido ?? 0), 0);
        const taxaAntecip = items.reduce((s, r) => s + Math.abs(Number(r.conta_taxa_antecip || 0)), 0);
        const dataRecebimento = items.find(r => r.conta_data_recebimento)?.conta_data_recebimento ?? null;
        // periodo: min(inicio) a max(fim) entre lojas
        const inicios = items.map(r => r.periodo_apuracao_inicio).filter(Boolean) as string[];
        const fins = items.map(r => r.periodo_apuracao_fim).filter(Boolean) as string[];
        const periodoIni = inicios.length ? inicios.sort()[0] : null;
        const periodoFim = fins.length ? fins.sort().slice(-1)[0] : null;
        // status agregado: se algum matched_aprox vira aprox, se algum sem_repasse vira sem_repasse, senao matched
        const statuses = new Set(items.map(r => r.status));
        const status = statuses.has('sem_repasse')
          ? 'sem_repasse'
          : statuses.has('unmatched')
          ? 'unmatched'
          : statuses.has('matched_aprox')
          ? 'matched_aprox'
          : 'matched';
        return { data, items, totalBruto, totalLiquido, taxaAntecip, dataRecebimento, periodoIni, periodoFim, status };
      });
  }, [repasses]);

  if (repasses.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-center text-muted-foreground">
          Sem dados. Importe extrato detalhado e execute o match.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Repasses semanais</CardTitle>
        <p className="text-xs text-muted-foreground">
          Cada linha = 1 ciclo de repasse (PIX único do iFood somando as lojas). Ciclo: corte
          domingo (ou último dia do mês), repasse na primeira quarta-feira seguinte (D+3 dom, D+4 sáb).
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data esperada</TableHead>
              <TableHead>Período apuração</TableHead>
              <TableHead className="text-right">Total Bruto</TableHead>
              <TableHead className="text-right">Total Líquido</TableHead>
              <TableHead className="text-right">Taxa de antecipação</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grupos.map(g => {
              const variant = STATUS_VARIANTS[g.status] ?? STATUS_VARIANTS.pending;
              const isExpanded = expandedDate === g.data;
              return (
                <Fragment key={g.data}>
                  <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => setExpandedDate(isExpanded ? null : g.data)}>
                    <TableCell className="font-medium">
                      <span className="mr-1 text-muted-foreground">{isExpanded ? '▼' : '▶'}</span>
                      {fmtDate(g.data)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {g.periodoIni && g.periodoFim
                        ? `${fmtDate(g.periodoIni)} a ${fmtDate(g.periodoFim)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right font-medium">{fmt(g.totalBruto)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {g.totalLiquido > 0 ? (
                        <div>{fmt(g.totalLiquido)}<div className="text-[10px] text-muted-foreground">{g.dataRecebimento ? fmtDate(g.dataRecebimento) : ''}</div></div>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {g.taxaAntecip > 0 ? `−${fmt(g.taxaAntecip)}` : '—'}
                    </TableCell>
                    <TableCell><Badge variant="secondary" className={variant.className}>{variant.label}</Badge></TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow className="bg-muted/20">
                      <TableCell colSpan={6} className="p-3 space-y-4">
                        {g.items.map(r => (
                          <div key={r.id}>
                            <div className="text-xs font-semibold mb-2 text-muted-foreground">
                              {storeName(r.store_id_curto)} · {r.periodo_apuracao_inicio && r.periodo_apuracao_fim
                                ? `${fmtDate(r.periodo_apuracao_inicio)} a ${fmtDate(r.periodo_apuracao_fim)}`
                                : '—'} · Bruto {fmt(Number(r.liquido_esperado))} · Líq {fmt(Number(r.liquido_efetivo ?? r.conta_recebido ?? 0))}
                            </div>
                            <RepasseDetalhe r={r} />
                          </div>
                        ))}
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
  );
}

function RepasseDetalhe({ r }: { r: Repasse }) {
  return (
    <div className="text-xs space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <div className="font-semibold mb-1 text-muted-foreground">RECEITAS</div>
          <DetailRow label="Bruto venda (pgto-app)" value={r.bruto_venda} />
          <DetailRow label="Promo iFood (devolução)" value={r.promo_ifood} />
          <DetailRow label="Reembolsos pra loja" value={r.reembolsos} />
          <DetailRow label="Ressarcimentos" value={r.ressarc} />
          <DetailRow label="Cancel. de frete (estorno)" value={r.cancel_frete} />
          <DetailRow label="Outros (positivo)" value={r.outros > 0 ? r.outros : 0} />
        </div>
        <div>
          <div className="font-semibold mb-1 text-muted-foreground">CUSTOS iFOOD</div>
          <DetailRow label="Comissão iFood" value={r.comissao} />
          <DetailRow label="Taxa de transação" value={r.taxa_transacao} />
          <DetailRow label="Taxa conveniência" value={r.taxa_conveniencia} />
          <DetailRow label="Frete iFood" value={r.frete_ifood} />
          <DetailRow label="Taxa entrega retenção" value={r.taxa_entrega_ret} />
          <DetailRow label="Taxa serviço Sob Demanda" value={r.taxa_servico_sob_demanda} />
          <DetailRow label="ADS" value={r.ads} />
          <DetailRow label="Frota Garantida" value={r.frota_garantida} />
          <DetailRow label="Mensalidade" value={r.mensalidade} />
          <DetailRow label="Tx antecipação (banco)" value={-(r.conta_taxa_antecip ?? 0)} />
        </div>
        <div>
          <div className="font-semibold mb-1 text-muted-foreground">AJUSTES / INFORMATIVO</div>
          <DetailRow label="Tx serviço cliente (retido)" value={r.taxa_servico_cliente} />
          <DetailRow label="Cancelamento total" value={r.cancel_total} />
          <DetailRow label="Cancelamento parcial" value={r.cancel_parcial} />
          <DetailRow label="Ocorrência venda" value={r.ocor_venda} />
          <DetailRow label="Outros (negativo)" value={r.outros < 0 ? r.outros : 0} />
          <hr className="my-1" />
          <DetailRow label="Pgto-direto loja (informativo)" value={r.pgto_direto_loja} muted />
          <DetailRow label="Promo loja (impacto=NÃO)" value={r.promo_loja} muted />
        </div>
      </div>
      <hr />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="font-semibold">Líquido esperado: <span className="text-base">{fmt(r.liquido_esperado)}</span></div>
        <div className="font-semibold">Conta recebido: <span className="text-base">{r.conta_recebido != null ? fmt(r.conta_recebido) : '—'}</span></div>
        <div className="font-semibold">Diferença: <span className={`text-base ${r.diff != null && Math.abs(r.diff) > 0.5 ? 'text-rose-700 dark:text-rose-400' : ''}`}>
          {r.diff != null ? fmt(r.diff) : '—'}
        </span></div>
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
            : 'Importe os documentos e execute o match pra ver o cross-check.'}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <Card className={crosscheck.missing_in_ifood_count > 0 ? 'border-rose-500/40 bg-rose-500/5' : ''}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            {crosscheck.missing_in_ifood_count > 0
              ? <AlertCircle className="h-4 w-4 text-rose-600" />
              : <CheckCircle2 className="h-4 w-4 text-green-600" />}
            Saipos viu, iFood não declarou ({crosscheck.missing_in_ifood_count})
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Pedidos com canal iFood + pagamento "Online Ifood" no PDV que não constam no Relatório.
          </p>
        </CardHeader>
        {crosscheck.missing_in_ifood.length > 0 && (
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
                {crosscheck.missing_in_ifood.map(r => (
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
            <CardTitle className="text-base">Diferença de valor entre Saipos e iFood ({crosscheck.value_mismatch_count})</CardTitle>
            <p className="text-xs text-muted-foreground">
              Tolerância R$ 2,00. iFood inclui taxa de serviço cliente; Saipos não.
              "Diff sem tx" = (Saipos - iFood + tx_serviço). Restantes são divergências reais (taxa de entrega no Saipos, ajustes pós-fato).
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Loja</TableHead>
                  <TableHead>Pgto Saipos</TableHead>
                  <TableHead className="text-right">Saipos</TableHead>
                  <TableHead className="text-right">iFood</TableHead>
                  <TableHead className="text-right">Tx serv.</TableHead>
                  <TableHead className="text-right">Diff</TableHead>
                  <TableHead className="text-right">Diff sem tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crosscheck.value_mismatch.map(r => (
                  <TableRow key={r.order_id}>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(r.data)}</TableCell>
                    <TableCell className="font-mono text-[10px]">{r.order_id}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{storeName(r.store_id_curto ?? null)}</TableCell>
                    <TableCell className="text-[10px]">{r.pagamento_saipos ? <Badge variant="outline" className="text-[10px]">{r.pagamento_saipos}</Badge> : '—'}</TableCell>
                    <TableCell className="text-right">{fmt(r.saipos_total)}</TableCell>
                    <TableCell className="text-right">{fmt(r.ifood_total_pago)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.ifood_taxa_servico != null ? fmt(r.ifood_taxa_servico) : '—'}</TableCell>
                    <TableCell className="text-right font-medium text-amber-700 dark:text-amber-500">{fmt(r.diff)}</TableCell>
                    <TableCell className="text-right">{r.diff_sem_taxa_servico != null ? fmt(r.diff_sem_taxa_servico) : '—'}</TableCell>
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
            <CardTitle className="text-base">iFood declarou, Saipos não tem ({crosscheck.missing_in_saipos_count})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Loja iFood</TableHead>
                  <TableHead className="text-right">Total pago</TableHead>
                  <TableHead className="text-right">Líquido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {crosscheck.missing_in_saipos.map(r => (
                  <TableRow key={r.order_id}>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(r.data_pedido)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.order_id}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{storeName(r.store_id_curto ?? null)}</TableCell>
                    <TableCell className="text-right">{fmt(r.ifood_total_pago)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmt(r.ifood_liquido)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {(crosscheck.missing_in_saipos_adjustments_count ?? 0) > 0 && (
        <Card className="border-dashed border-muted-foreground/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Ajustes pós-fato (líquido negativo) — {crosscheck.missing_in_saipos_adjustments_count}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Cancelamentos/reembolsos do iFood reaparecendo num mês posterior. Não são pedidos novos faltando no Saipos — segregados pra não inflar o cross-check.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Order ID</TableHead>
                  <TableHead>Loja iFood</TableHead>
                  <TableHead className="text-right">Total pago</TableHead>
                  <TableHead className="text-right">Líquido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(crosscheck.missing_in_saipos_adjustments ?? []).map(r => (
                  <TableRow key={r.order_id}>
                    <TableCell className="text-xs whitespace-nowrap">{fmtDateTime(r.data_pedido)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.order_id}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{storeName(r.store_id_curto ?? null)}</TableCell>
                    <TableCell className="text-right">{fmt(r.ifood_total_pago)}</TableCell>
                    <TableCell className="text-right text-rose-600 dark:text-rose-400">{fmt(r.ifood_liquido)}</TableCell>
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

function Row({ label, value, bold, muted }: { label: string; value: string; bold?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-muted-foreground' : ''}`}>
      <span>{label}:</span>
      <span className={bold ? 'font-semibold' : ''}>{value}</span>
    </div>
  );
}

function DetailRow({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-muted-foreground' : ''}`}>
      <span className="text-[11px]">{label}:</span>
      <span className={`font-mono text-[11px] ${value < 0 ? 'text-rose-700 dark:text-rose-400' : value > 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
        {fmt(value)}
      </span>
    </div>
  );
}
