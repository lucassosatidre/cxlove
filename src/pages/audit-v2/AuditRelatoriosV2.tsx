import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import { Loader2, FileText, Download, Lock, LockOpen, ChevronDown, ChevronRight } from 'lucide-react';
import AuditNavTabsV2 from '@/components/audit-v2/AuditNavTabsV2';
import { buildContabilData, generateContabilReport } from '@/lib/contabil-data-builder';
import { ContabilReportView } from '@/components/audit/ContabilReportView';
import { CloseConfirmDialog, ReopenDialog } from '@/components/audit/PeriodCloseDialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { generateContabilPdf, type ContabilPdfData } from '@/lib/audit-pdf-contabil';

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// Backup do relatório gravado em audit_periods.closed_snapshot no "Fechar Período"
type ClosedSnapshot = {
  resumido: ContabilPdfData;
  detalhado: ContabilPdfData;
  saved_at: string;
};

type AuditPeriod = {
  id: string;
  month: number;
  year: number;
  status: string;
  closed_at?: string | null;
  closed_snapshot?: ClosedSnapshot | null;
};

export default function AuditRelatoriosV2() {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const now = new Date();

  const [month, setMonth] = useState<number>(Number(searchParams.get('month')) || now.getMonth() + 1);
  const [year, setYear] = useState<number>(Number(searchParams.get('year')) || now.getFullYear());
  const [period, setPeriod] = useState<AuditPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<'resumido' | 'detalhado' | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);

  const [resumidoData, setResumidoData] = useState<ContabilPdfData | null>(null);
  const [detalhadoData, setDetalhadoData] = useState<ContabilPdfData | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  const [expandedResumido, setExpandedResumido] = useState(false);
  const [expandedDetalhado, setExpandedDetalhado] = useState(false);

  const reloadPeriod = async () => {
    if (!period) return;
    const { data } = await supabase.from('audit_periods').select('*').eq('id', period.id).maybeSingle();
    if (data) setPeriod(data as unknown as AuditPeriod);
  };

  const handleClose = async () => {
    if (!period || !user) return;

    // Congela o relatório do mês: monta os dados (resumido + detalhado) e grava
    // em closed_snapshot. Com o período fechado, a tela renderiza desse backup.
    let res = resumidoData;
    let det = detalhadoData;
    try {
      if (!res || !det) {
        [res, det] = await Promise.all([
          buildContabilData({ periodId: period.id, month, year, emittedBy: user?.email ?? 'Admin', mode: 'resumido' }),
          buildContabilData({ periodId: period.id, month, year, emittedBy: user?.email ?? 'Admin', mode: 'detalhado' }),
        ]);
      }
    } catch (e: any) {
      toast.error('Erro ao montar o backup do relatório', { description: e?.message ?? 'Erro desconhecido' });
      return;
    }

    const nowIso = new Date().toISOString();
    const snapshot: ClosedSnapshot = { resumido: res, detalhado: det, saved_at: nowIso };
    const { error } = await supabase
      .from('audit_periods')
      .update({
        status: 'fechado', closed_at: nowIso, closed_by: user.id, updated_at: nowIso,
        closed_snapshot: snapshot,
      } as any)
      .eq('id', period.id);
    if (error) {
      toast.error('Erro ao fechar', { description: error.message });
      return;
    }
    await supabase.from('audit_period_log').insert({
      audit_period_id: period.id, action: 'fechado', user_id: user.id,
      reason: 'Backup do relatório contábil salvo no fechamento (closed_snapshot)',
    });
    toast.success(`✓ Período ${MONTHS[month - 1]}/${year} fechado e travado`, {
      description: 'Backup do relatório salvo. Os números não mudam mais até reabrir.',
    });
    setCloseOpen(false);
    await reloadPeriod();
  };

  const handleReopen = async (reason: string) => {
    if (!period || !user) return;
    // Volta pra 'aberto' (precisa reexecutar a auditoria em Importações).
    // O closed_snapshot é MANTIDO como backup do fechamento anterior.
    const { error } = await supabase
      .from('audit_periods')
      .update({ status: 'aberto', closed_at: null, closed_by: null, updated_at: new Date().toISOString() })
      .eq('id', period.id);
    if (error) {
      toast.error('Erro ao reabrir', { description: error.message });
      return;
    }
    await supabase.from('audit_period_log').insert({
      audit_period_id: period.id, action: 'reaberto', user_id: user.id, reason,
    });
    toast.success('✓ Mês reaberto', {
      description: 'O backup do fechamento foi mantido. Reexecute a auditoria em Importações.',
    });
    setReopenOpen(false);
    await reloadPeriod();
  };

  // URL sync
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('month', String(month));
    next.set('year', String(year));
    setSearchParams(next, { replace: true });
  }, [month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('audit_periods').select('*').eq('month', month).eq('year', year).maybeSingle();
      if (!active) return;
      setPeriod((data as unknown as AuditPeriod) ?? null);
      setResumidoData(null);
      setDetalhadoData(null);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isAdmin, month, year]);

  // Carrega ambos os dados (resumido + detalhado) quando o período tem
  // status que permite gerar relatório. Carrega só uma vez por mudança
  // de período pra evitar requests duplicados.
  useEffect(() => {
    if (!period || period.status === 'aberto') return;
    // Mês TRAVADO: renderiza do snapshot salvo no fechamento — não recalcula ao vivo.
    if (period.status === 'fechado' && period.closed_snapshot?.resumido) {
      setResumidoData(period.closed_snapshot.resumido);
      setDetalhadoData(period.closed_snapshot.detalhado ?? null);
      return;
    }
    let active = true;
    (async () => {
      setLoadingData(true);
      try {
        const [resData, detData] = await Promise.all([
          buildContabilData({
            periodId: period.id, month, year,
            emittedBy: user?.email ?? 'Admin', mode: 'resumido',
          }),
          buildContabilData({
            periodId: period.id, month, year,
            emittedBy: user?.email ?? 'Admin', mode: 'detalhado',
          }),
        ]);
        if (!active) return;
        setResumidoData(resData);
        setDetalhadoData(detData);
      } catch (e: any) {
        if (active) toast.error('Erro ao carregar dados do relatório', { description: e?.message });
      } finally {
        if (active) setLoadingData(false);
      }
    })();
    return () => { active = false; };
  }, [period, month, year, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = async (mode: 'resumido' | 'detalhado') => {
    if (!period) {
      toast.error('Crie/abra o período antes de gerar o relatório');
      return;
    }
    setGenerating(mode);
    try {
      // Mês travado: o PDF sai do snapshot do fechamento, não do cálculo ao vivo
      const snapData = period.status === 'fechado' ? period.closed_snapshot?.[mode] : null;
      if (snapData) {
        generateContabilPdf(mode, snapData);
        toast.success('✓ Relatório Contábil gerado (do backup do fechamento)');
        return;
      }
      await generateContabilReport({
        periodId: period.id,
        month,
        year,
        emittedBy: user?.email ?? 'Admin',
        mode,
      });
      toast.success('✓ Relatório Contábil gerado');
    } catch (e: any) {
      toast.error('Erro ao gerar relatório', { description: e.message ?? 'Erro desconhecido' });
    } finally {
      setGenerating(null);
    }
  };

  if (roleLoading || loading) {
    return (
      <AppLayout title="Relatórios">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="Relatórios">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito a administradores.</CardContent></Card>
      </AppLayout>
    );
  }

  const canGenerate = !!period && period.status !== 'aberto';
  const isClosed = period?.status === 'fechado';
  const isConciliated = period?.status === 'conciliado';
  const periodLabelStr = `${MONTHS[month - 1]} / ${year}`;

  return (
    <AppLayout title="Relatórios" subtitle="Geração de relatórios contábeis do período">
      <div className="space-y-4">
        <AuditNavTabsV2 />

        {/* Seletor de período */}
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
                <SelectTrigger className="w-[100px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[year - 1, year, year + 1].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {period ? (
              <Badge variant="secondary" className="ml-2">
                Período {MONTHS[month - 1]} {year} — {period.status}
              </Badge>
            ) : (
              <Badge variant="outline" className="ml-2">Período não criado</Badge>
            )}
            <div className="ml-auto flex items-center gap-2">
              {period && isConciliated && !isClosed && (
                <Button onClick={() => setCloseOpen(true)} className="gap-2">
                  <Lock className="h-4 w-4" /> Fechar Período
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Mês travado — banner do snapshot + Reabrir */}
        {isClosed && (
          <Card className="border-green-600/30 bg-green-500/5">
            <CardContent className="py-3 flex flex-wrap items-center gap-3 text-sm">
              <Lock className="h-4 w-4 text-green-700 dark:text-green-400 shrink-0" />
              <span>
                ✅ Mês auditado e travado em{' '}
                <strong>
                  {period?.closed_at
                    ? new Date(period.closed_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                    : '—'}
                </strong>{' '}
                — backup salvo.
                {period?.closed_snapshot?.resumido
                  ? ' Os números abaixo vêm do backup do fechamento (não são recalculados).'
                  : ' (Fechado antes da trava por snapshot — exibindo cálculo ao vivo.)'}
              </span>
              <Button variant="outline" size="sm" onClick={() => setReopenOpen(true)} className="gap-2 ml-auto">
                <LockOpen className="h-4 w-4" /> Reabrir o mês
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Relatórios — KPIs do mês + collapsibles com visualização inline */}
        {canGenerate && (
          <>
            {loadingData && (
              <Card>
                <CardContent className="py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando dados do período…
                </CardContent>
              </Card>
            )}

            {resumidoData && (() => {
              const data = resumidoData;
              const baseSum = data.resumoPorCategoria.reduce((acc, r) => ({
                qtd: acc.qtd + r.qtd,
                vendido: acc.vendido + r.vendido,
                recebido: acc.recebido + r.recebido,
                custo: acc.custo + r.custo,
              }), { qtd: 0, vendido: 0, recebido: 0, custo: 0 });
              const brSum = data.brendi ? {
                qtd: data.brendi.pedidos_count_mes,
                vendido: data.brendi.vendido_bruto,
                recebido: data.brendi.recebido_bb,
                custo: data.brendi.custo_total,
              } : { qtd: 0, vendido: 0, recebido: 0, custo: 0 };
              const ifSum = data.ifood ? {
                qtd: data.ifood.pedidos_count,
                vendido: data.ifood.vendido_bruto,
                recebido: data.ifood.liquido_efetivo,
                custo: data.ifood.custo_total,
              } : { qtd: 0, vendido: 0, recebido: 0, custo: 0 };
              const totQtd = baseSum.qtd + brSum.qtd + ifSum.qtd;
              const totVendido = baseSum.vendido + brSum.vendido + ifSum.vendido;
              const totRecebido = baseSum.recebido + brSum.recebido + ifSum.recebido;
              const totCusto = baseSum.custo + brSum.custo + ifSum.custo;
              const totPct = totVendido > 0 ? (totCusto / totVendido) * 100 : 0;
              const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
              const fmtPct = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-md border bg-card pl-3 pr-3 py-3 border-l-[3px] border-l-primary">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Faturamento bruto</div>
                    <div className="text-lg font-bold mt-1">{fmt(totVendido)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{totQtd.toLocaleString('pt-BR')} transações no período</div>
                  </div>
                  <div className="rounded-md border bg-card pl-3 pr-3 py-3 border-l-[3px] border-l-green-600 dark:border-l-green-400">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Líquido efetivo</div>
                    <div className="text-lg font-bold mt-1">{fmt(totRecebido)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Após custos e antecipações</div>
                  </div>
                  <div className="rounded-md border bg-card pl-3 pr-3 py-3 border-l-[3px] border-l-rose-600 dark:border-l-rose-400">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Custo total</div>
                    <div className="text-lg font-bold mt-1">{fmt(totCusto)} · {fmtPct(totPct)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Taxa efetiva sobre faturamento bruto</div>
                  </div>
                </div>
              );
            })()}

            {/* Resumido */}
            <Collapsible open={expandedResumido} onOpenChange={setExpandedResumido}>
              <Card>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <CollapsibleTrigger className="flex items-center gap-2 text-left flex-1 min-w-0">
                      {expandedResumido
                        ? <ChevronDown className="h-4 w-4 shrink-0" />
                        : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <FileText className="h-5 w-5 text-primary shrink-0" />
                      <div className="min-w-0">
                        <CardTitle className="text-base">Controle de Taxas — Resumido</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Capa + 5 seções (Resumo, Maquinona, Vouchers, Brendi, iFood Marketplace)
                        </p>
                      </div>
                    </CollapsibleTrigger>
                    <Button
                      onClick={() => handleGenerate('resumido')}
                      disabled={generating !== null}
                      size="sm"
                      className="gap-2"
                    >
                      {generating === 'resumido'
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Download className="h-4 w-4" />}
                      {generating === 'resumido' ? 'Gerando...' : 'Baixar PDF'}
                    </Button>
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    {resumidoData
                      ? <ContabilReportView data={resumidoData} mode="resumido" />
                      : <p className="text-sm text-muted-foreground">Aguardando carregamento…</p>}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Detalhado */}
            <Collapsible open={expandedDetalhado} onOpenChange={setExpandedDetalhado}>
              <Card>
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <CollapsibleTrigger className="flex items-center gap-2 text-left flex-1 min-w-0">
                      {expandedDetalhado
                        ? <ChevronDown className="h-4 w-4 shrink-0" />
                        : <ChevronRight className="h-4 w-4 shrink-0" />}
                      <FileText className="h-5 w-5 text-primary shrink-0" />
                      <div className="min-w-0">
                        <CardTitle className="text-base">Controle de Taxas — Detalhado</CardTitle>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Resumido + breakdown diário por categoria (Crédito/Débito/Pix/Vouchers)
                        </p>
                      </div>
                    </CollapsibleTrigger>
                    <Button
                      onClick={() => handleGenerate('detalhado')}
                      disabled={generating !== null}
                      size="sm"
                      variant="outline"
                      className="gap-2"
                    >
                      {generating === 'detalhado'
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Download className="h-4 w-4" />}
                      {generating === 'detalhado' ? 'Gerando...' : 'Baixar PDF'}
                    </Button>
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    {detalhadoData
                      ? <ContabilReportView data={detalhadoData} mode="detalhado" />
                      : <p className="text-sm text-muted-foreground">Aguardando carregamento…</p>}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </>
        )}

        {!canGenerate && period && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-3 text-sm">
              ⚠ Período <strong>aberto</strong>. Execute a auditoria em <a href="/admin/auditoria-v2/importacoes" className="underline font-semibold">Importações</a> antes de gerar o relatório contábil.
            </CardContent>
          </Card>
        )}
        {!period && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-3 text-sm">
              ⚠ Período {MONTHS[month - 1]}/{year} não foi criado. Vá em <a href="/admin/auditoria-v2/importacoes" className="underline font-semibold">Importações</a> e importe os arquivos do mês.
            </CardContent>
          </Card>
        )}

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
      </div>
    </AppLayout>
  );
}
