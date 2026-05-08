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
import AuditNavTabs from '@/components/audit/AuditNavTabs';
import { buildContabilData, generateContabilReport } from '@/lib/contabil-data-builder';
import { ContabilReportView } from '@/components/audit/ContabilReportView';
import { CloseConfirmDialog, ReopenDialog } from '@/components/audit/PeriodCloseDialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ContabilPdfData } from '@/lib/audit-pdf-contabil';

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

type AuditPeriod = { id: string; month: number; year: number; status: string };

export default function AuditRelatorios() {
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
    if (data) setPeriod(data as AuditPeriod);
  };

  const handleClose = async () => {
    if (!period || !user) return;
    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('audit_periods')
      .update({ status: 'fechado', closed_at: nowIso, closed_by: user.id, updated_at: nowIso })
      .eq('id', period.id);
    if (error) {
      toast.error('Erro ao fechar', { description: error.message });
      return;
    }
    await supabase.from('audit_period_log').insert({
      audit_period_id: period.id, action: 'fechado', user_id: user.id, reason: null,
    });
    toast.success(`✓ Período ${MONTHS[month - 1]}/${year} fechado`);
    setCloseOpen(false);
    await reloadPeriod();
  };

  const handleReopen = async (reason: string) => {
    if (!period || !user) return;
    const { error } = await supabase
      .from('audit_periods')
      .update({ status: 'conciliado', closed_at: null, closed_by: null, updated_at: new Date().toISOString() })
      .eq('id', period.id);
    if (error) {
      toast.error('Erro ao reabrir', { description: error.message });
      return;
    }
    await supabase.from('audit_period_log').insert({
      audit_period_id: period.id, action: 'reaberto', user_id: user.id, reason,
    });
    toast.success('✓ Período reaberto');
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
      setPeriod((data as AuditPeriod) ?? null);
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
        <AuditNavTabs />

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
              {period && isClosed && (
                <Button variant="outline" onClick={() => setReopenOpen(true)} className="gap-2">
                  <LockOpen className="h-4 w-4" /> Reabrir Período
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Relatórios — collapsibles com visualização inline */}
        {canGenerate && (
          <>
            {loadingData && (
              <Card>
                <CardContent className="py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando dados do período…
                </CardContent>
              </Card>
            )}

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
              ⚠ Período <strong>aberto</strong>. Execute a auditoria em <a href="/admin/auditoria/importacoes" className="underline font-semibold">Importações</a> antes de gerar o relatório contábil.
            </CardContent>
          </Card>
        )}
        {!period && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="py-3 text-sm">
              ⚠ Período {MONTHS[month - 1]}/{year} não foi criado. Vá em <a href="/admin/auditoria/importacoes" className="underline font-semibold">Importações</a> e importe os arquivos do mês.
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
