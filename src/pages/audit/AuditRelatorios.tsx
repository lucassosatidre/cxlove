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
import { Loader2, FileText, Download, Lock, LockOpen } from 'lucide-react';
import AuditNavTabs from '@/components/audit/AuditNavTabs';
import { generateContabilReport } from '@/lib/contabil-data-builder';
import { CloseConfirmDialog, ReopenDialog } from '@/components/audit/PeriodCloseDialog';

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
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isAdmin, month, year]);

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

        {/* Cards de relatório */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Controle de Taxas — Resumido</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Capa + 5 páginas (Resumo Consolidado, Maquinona, Vouchers, Brendi, iFood Marketplace).
                Cada categoria com 3 KPIs principais e tabela de detalhamento por adquirente/operadora.
              </p>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => handleGenerate('resumido')}
                disabled={!canGenerate || generating !== null}
                className="gap-2"
              >
                {generating === 'resumido'
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Download className="h-4 w-4" />}
                {generating === 'resumido' ? 'Gerando...' : 'Gerar PDF Resumido'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Controle de Taxas — Detalhado</CardTitle>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Mesmo conteúdo do resumido + páginas extras com breakdown diário por categoria
                (Crédito/Débito/Pix/Vouchers, dia a dia do mês). Útil pra arquivamento contábil.
              </p>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => handleGenerate('detalhado')}
                disabled={!canGenerate || generating !== null}
                variant="outline"
                className="gap-2"
              >
                {generating === 'detalhado'
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Download className="h-4 w-4" />}
                {generating === 'detalhado' ? 'Gerando...' : 'Gerar PDF Detalhado'}
              </Button>
            </CardContent>
          </Card>
        </div>

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
