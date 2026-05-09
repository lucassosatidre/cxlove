import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { Loader2, CheckCircle2, Circle, Play, FileText, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import AuditNavTabs from '@/components/audit/AuditNavTabs';
import {
  UploadMaquinonaCard, UploadCresolCard,
  UploadBBCard, UploadTicketCard, UploadAleloCard, UploadVRCard, UploadPluxeeCard,
  UploadBrendiCard, UploadSaiposCard,
  UploadIfoodExtratoDetalhadoCard, UploadIfoodOrdersCard, UploadIfoodContaCsvCard,
  dispatchAutoMatchVouchers,
  dispatchMatchBrendi,
  dispatchMatchIfoodMarketplace,
  type AuditPeriodLite,
} from '@/components/audit/UploadCards';
import { toast } from 'sonner';

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const fmtInt = (v: number) => v.toLocaleString('pt-BR');

type ImportRow = { file_type: string; status: string; imported_rows: number; created_at: string; file_name: string };

type MonthSlot = 'anterior' | 'comp' | 'posterior';

type DocSpec = {
  id: string;
  /** Indicador na UI (ex: "Maquinona", "Cresol") */
  label: string;
  /** Descrição curta do que é o arquivo */
  description: string;
  /** Formato aceito (.xlsx, .pdf, .csv) */
  format: string;
  /** Slots de mês esperados. Cada slot vira uma linha de checkbox/upload. */
  monthSlots: MonthSlot[];
  /** Pra docs que precisam de N arquivos no MESMO mês (ex: iFood × 2 lojas) */
  filesPerSlot?: number;
  /** file_types correspondentes em audit_imports pra contar progresso */
  fileTypes: string[];
  /** Categoria pra agrupamento visual */
  group: 'maquinona' | 'vouchers' | 'brendi' | 'ifood';
  /** Componente de upload */
  Component: React.ComponentType<{
    period: AuditPeriodLite | null;
    ensurePeriod: () => Promise<AuditPeriodLite | null>;
    onAfter: () => Promise<void> | void;
  }>;
  /** Hook pós-upload (ex: dispatch match) */
  postUpload?: (periodId: string) => Promise<void>;
};

const GROUP_LABELS: Record<DocSpec['group'], string> = {
  maquinona: 'Maquinona iFood',
  vouchers: 'Vouchers',
  brendi: 'Brendi',
  ifood: 'iFood Marketplace',
};

const GROUP_DESCRIPTIONS: Record<DocSpec['group'], string> = {
  maquinona: 'Vendas físicas Crédito/Débito/Pix processadas pela Maquinona iFood (depósito Cresol).',
  vouchers: 'Lotes de vouchers Alelo/Ticket/VR/Pluxee + extrato BB com depósitos correspondentes.',
  brendi: 'Pedidos online Brendi com PIX direto BB + relatório Saipos como fonte da verdade.',
  ifood: 'Vendas online iFood (Estrela + TEMX) com repasses semanais na conta iFood Pago.',
};

export default function AuditImportacoes() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const now = new Date();

  const [month, setMonth] = useState<number>(Number(searchParams.get('month')) || now.getMonth() + 1);
  const [year, setYear] = useState<number>(Number(searchParams.get('year')) || now.getFullYear());
  const [period, setPeriod] = useState<AuditPeriodLite | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAudit, setRunningAudit] = useState(false);

  // URL sync
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('month', String(month));
    next.set('year', String(year));
    setSearchParams(next, { replace: true });
  }, [month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async (periodId: string) => {
    const { data } = await supabase
      .from('audit_imports')
      .select('file_type, status, imported_rows, created_at, file_name')
      .eq('audit_period_id', periodId)
      .order('created_at', { ascending: false });
    setImports((data ?? []) as any);
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

  const ensurePeriod = async (): Promise<AuditPeriodLite | null> => {
    if (period) return period;
    const { data, error } = await supabase
      .from('audit_periods').insert({ month, year, status: 'aberto' }).select().single();
    if (error) return null;
    const p = data as AuditPeriodLite;
    setPeriod(p);
    return p;
  };

  const onUploadAfter = async () => {
    if (period) await refresh(period.id);
  };

  // Executa os 4 matches em sequência: Maquinona×Cresol, Vouchers, Brendi, iFood Marketplace.
  // Cada um roda só com os dados que tem disponíveis. Logs vão como toasts.
  const runFullAudit = async () => {
    const p = await ensurePeriod();
    if (!p) return;
    setRunningAudit(true);
    const results: string[] = [];
    try {
      // 1) Maquinona × Cresol (run-audit-match)
      try {
        const { data, error } = await supabase.functions.invoke('run-audit-match', {
          body: { audit_period_id: p.id },
        });
        if (error) throw new Error(error.message);
        if (data?.success) {
          results.push(`Maquinona × Cresol: ${data.daily_matches_count ?? 0} dias casados`);
        } else {
          results.push(`Maquinona × Cresol: ${data?.error || 'falha'}`);
        }
      } catch (e: any) {
        results.push(`Maquinona × Cresol: erro — ${e?.message ?? 'desconhecido'}`);
      }

      // 2) Vouchers (4 operadoras)
      try {
        await dispatchAutoMatchVouchers(p.id, ['ticket', 'alelo', 'vr', 'pluxee']);
        results.push('Vouchers (Ticket/Alelo/VR/Pluxee): match disparado');
      } catch (e: any) {
        results.push(`Vouchers: erro — ${e?.message ?? 'desconhecido'}`);
      }

      // 3) Brendi
      try {
        const res = await dispatchMatchBrendi(p.id);
        if (res) {
          const cc = res.crosscheck;
          const d = res.daily;
          results.push(`Brendi: ${d.rows} dias · ${cc.ok} ok · taxa ${d.taxa_efetiva_pct}%`);
        } else {
          results.push('Brendi: erro (ver toasts)');
        }
      } catch (e: any) {
        results.push(`Brendi: erro — ${e?.message ?? 'desconhecido'}`);
      }

      // 4) iFood Marketplace
      try {
        const res = await dispatchMatchIfoodMarketplace(p.id);
        if (res) {
          const r = res.repasses;
          results.push(`iFood Marketplace: ${r.total} repasses · recebido R$ ${r.total_conta_recebido}`);
        } else {
          results.push('iFood Marketplace: erro (ver toasts)');
        }
      } catch (e: any) {
        results.push(`iFood Marketplace: erro — ${e?.message ?? 'desconhecido'}`);
      }

      await refresh(p.id);
      toast.success('✓ Auditoria concluída', {
        description: results.join(' · '),
        duration: 8000,
      });
    } finally {
      setRunningAudit(false);
    }
  };

  // Especificação dos documentos. Ordem reflete a ordem visual.
  // monthSlots: meses requeridos relativos ao mês de competência.
  // 'anterior' = mês ANT, 'comp' = COMP, 'posterior' = mês POST.
  const DOCS: DocSpec[] = useMemo(() => [
    // ─── Maquinona — 3 meses (cross-month coverage) ────────────────────────
    {
      id: 'maquinona', label: 'Maquinona iFood',
      description: 'XLSX exportado da Maquinona (aba "Transações") — vendas crédito/débito/Pix/voucher.',
      format: '.xlsx',
      monthSlots: ['anterior', 'comp', 'posterior'],
      fileTypes: ['maquinona'],
      group: 'maquinona', Component: UploadMaquinonaCard,
    },
    {
      id: 'cresol', label: 'Extrato Cresol',
      description: 'XLSX do banco Cresol — depósitos da Maquinona iFood.',
      format: '.xlsx',
      monthSlots: ['anterior', 'comp', 'posterior'],
      fileTypes: ['cresol'],
      group: 'maquinona', Component: UploadCresolCard,
    },
    // ─── Vouchers ──────────────────────────────────────────────────────────
    {
      id: 'bb', label: 'Extrato Banco do Brasil',
      description: 'XLSX do BB com depósitos voucher (alelo/ticket/pluxee/vr/brendi).',
      format: '.xlsx',
      monthSlots: ['comp', 'posterior'],
      fileTypes: ['bb'],
      group: 'vouchers', Component: UploadBBCard,
      postUpload: async (pid) => { await dispatchAutoMatchVouchers(pid, ['ticket', 'alelo', 'pluxee', 'vr']); },
    },
    {
      id: 'ticket', label: 'Reembolsos Ticket',
      description: 'PDF "Extrato de Reembolsos Detalhado" do portal Ticket Edenred.',
      format: '.pdf',
      monthSlots: ['comp'],
      fileTypes: ['ticket'],
      group: 'vouchers', Component: UploadTicketCard,
      postUpload: async (pid) => { await dispatchAutoMatchVouchers(pid, ['ticket']); },
    },
    {
      id: 'alelo', label: 'Extrato Alelo',
      description: 'XLSX exportado do portal Alelo (aba "Extrato").',
      format: '.xlsx',
      monthSlots: ['comp'],
      fileTypes: ['alelo'],
      group: 'vouchers', Component: UploadAleloCard,
      postUpload: async (pid) => { await dispatchAutoMatchVouchers(pid, ['alelo']); },
    },
    {
      id: 'vr', label: 'Vale Refeição (VR)',
      description: 'XLS do portal VR — Guias de Reembolso + Relatório de Transação.',
      format: '.xls',
      monthSlots: ['comp'],
      fileTypes: ['vr', 'vr_vendas'],
      group: 'vouchers', Component: UploadVRCard,
      postUpload: async (pid) => { await dispatchAutoMatchVouchers(pid, ['vr']); },
    },
    {
      id: 'pluxee', label: 'Reembolsos Pluxee',
      description: 'CSV de reembolsos Pluxee/Sodexo (arquivo com prefixo "1976928").',
      format: '.csv',
      monthSlots: ['comp'],
      fileTypes: ['pluxee'],
      group: 'vouchers', Component: UploadPluxeeCard,
      postUpload: async (pid) => { await dispatchAutoMatchVouchers(pid, ['pluxee']); },
    },
    // ─── Brendi ─────────────────────────────────────────────────────────────
    {
      id: 'brendi', label: 'Pedidos Brendi',
      description: 'XLSX "Pedidos" do portal Brendi (aba "Resultado da consulta").',
      format: '.xlsx',
      monthSlots: ['anterior', 'comp', 'posterior'],
      fileTypes: ['brendi'],
      group: 'brendi', Component: UploadBrendiCard,
    },
    {
      id: 'saipos', label: 'Vendas Saipos',
      description: 'XLSX "Vendas por período" do PDV Saipos (compartilhado com iFood Marketplace).',
      format: '.xlsx',
      monthSlots: ['anterior', 'comp', 'posterior'],
      fileTypes: ['saipos'],
      group: 'brendi', Component: UploadSaiposCard,
    },
    // ─── iFood Marketplace ─────────────────────────────────────────────────
    // Extrato/Pedidos: 2 arquivos no MESMO mês (1 por loja: Estrela + TEMX)
    {
      id: 'ifood_extrato', label: 'Extrato Detalhado iFood',
      description: 'XLSX do Portal Parceiro → Financeiro → Extrato Detalhado. 1 arquivo por loja (Estrela + TEMX).',
      format: '.xlsx',
      monthSlots: ['comp'], filesPerSlot: 2,
      fileTypes: ['ifood_extrato_detalhado'],
      group: 'ifood', Component: UploadIfoodExtratoDetalhadoCard,
    },
    {
      id: 'ifood_orders', label: 'Relatório de Pedidos iFood',
      description: 'XLSX do Portal Parceiro → Pedidos → Relatório de Pedidos. 1 por loja (Estrela + TEMX).',
      format: '.xlsx',
      monthSlots: ['comp'], filesPerSlot: 2,
      fileTypes: ['ifood_orders'],
      group: 'ifood', Component: UploadIfoodOrdersCard,
    },
    {
      id: 'ifood_conta', label: 'Conta iFood Pago (CSV)',
      description: 'Extrato CSV da conta iFood Pago — 2 meses (alguns ciclos antecipam no mês posterior).',
      format: '.csv',
      monthSlots: ['comp', 'posterior'],
      fileTypes: ['ifood_conta_csv'],
      group: 'ifood', Component: UploadIfoodContaCsvCard,
    },
  ], []);

  const targetCount = (doc: DocSpec) => doc.monthSlots.length * (doc.filesPerSlot ?? 1);

  const docProgress = (doc: DocSpec) => {
    const completed = imports.filter(i => doc.fileTypes.includes(i.file_type) && i.status === 'completed').length;
    return { completed, isDone: completed >= targetCount(doc) };
  };

  const groupProgress = (group: DocSpec['group']) => {
    const docsInGroup = DOCS.filter(d => d.group === group);
    const done = docsInGroup.filter(d => docProgress(d).isDone).length;
    return { done, total: docsInGroup.length };
  };

  if (roleLoading || loading) {
    return (
      <AppLayout title="Importações">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="Importações">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito a administradores.</CardContent></Card>
      </AppLayout>
    );
  }

  const groups: DocSpec['group'][] = ['maquinona', 'vouchers', 'brendi', 'ifood'];

  return (
    <AppLayout title="Importações" subtitle="Documentos necessários para a auditoria">
      <div className="space-y-4">
        <AuditNavTabs />

        {/* Seletor de período + botão Executar Auditoria */}
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
            {period && (
              <Badge variant="secondary">
                {MONTHS[month - 1]} {year} · {period.status}
              </Badge>
            )}
            <div className="ml-auto">
              <Button
                onClick={runFullAudit}
                disabled={!period || runningAudit}
                size="lg"
                className="gap-2"
              >
                {runningAudit
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Play className="h-4 w-4" />}
                {runningAudit ? 'Executando auditoria...' : 'Executar Auditoria'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Grupos com checklist + uploads */}
        {groups.map(group => {
          const docsInGroup = DOCS.filter(d => d.group === group);
          const prog = groupProgress(group);
          return (
            <Card key={group}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <CardTitle className="text-base">{GROUP_LABELS[group]}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-1">{GROUP_DESCRIPTIONS[group]}</p>
                  </div>
                  <Badge variant={prog.done === prog.total ? 'default' : 'secondary'} className="shrink-0">
                    {prog.done} / {prog.total} documentos
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {docsInGroup.map(doc => {
                  const docImports = imports.filter(
                    i => doc.fileTypes.includes(i.file_type) && i.status === 'completed',
                  );
                  const target = targetCount(doc);
                  const isDone = docImports.length >= target;
                  const Component = doc.Component;

                  return (
                    <div key={doc.id} className="rounded-md border bg-card/50 p-3 space-y-3">
                      {/* Header do documento */}
                      <div className="flex items-start gap-2">
                        {isDone
                          ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                          : <Circle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className={isDone ? 'line-through text-muted-foreground font-medium' : 'font-medium'}>
                              {doc.label}
                            </span>
                            <span className="text-xs text-muted-foreground">{doc.format}</span>
                            <Badge variant={isDone ? 'default' : 'outline'} className="text-[10px]">
                              {docImports.length}/{target} arquivos
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {doc.description}
                            {' · '}
                            <span className="italic">
                              {monthSlotsLabel(doc.monthSlots, doc.filesPerSlot, month)}
                            </span>
                          </p>
                        </div>
                      </div>

                      {/* Lista de arquivos já importados */}
                      {docImports.length > 0 && (
                        <div className="text-xs space-y-1 pl-6">
                          {docImports.slice(0, 10).map((imp, idx) => (
                            <div key={idx} className="flex items-baseline gap-2 text-muted-foreground">
                              <FileText className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0 self-center" />
                              <span className="font-mono text-foreground truncate" title={imp.file_name}>
                                {imp.file_name}
                              </span>
                              <span className="shrink-0">·</span>
                              <span className="shrink-0">{fmtInt(Number(imp.imported_rows ?? 0))} linhas</span>
                              <span className="shrink-0">·</span>
                              <span className="shrink-0">{new Date(imp.created_at).toLocaleDateString('pt-BR')}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Card de upload */}
                      <div className="pl-6">
                        <Component
                          period={period}
                          ensurePeriod={ensurePeriod}
                          onAfter={async () => {
                            await onUploadAfter();
                            if (doc.postUpload && period) {
                              await doc.postUpload(period.id);
                              await onUploadAfter();
                            }
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppLayout>
  );
}

// Helper: gera label "Janeiro + Fevereiro + Março" baseado no mês comp e slots
function monthSlotsLabel(slots: MonthSlot[], filesPerSlot: number | undefined, compMonth: number): string {
  const monthName = (m: number) => MONTHS[((m - 1) % 12 + 12) % 12];
  const labels = slots.map(s => {
    if (s === 'anterior') return monthName(compMonth - 1);
    if (s === 'comp') return monthName(compMonth);
    return monthName(compMonth + 1);
  });
  const joined = labels.join(' + ');
  if (filesPerSlot && filesPerSlot > 1) {
    return `${joined} · ${filesPerSlot} arquivos por mês (1 por loja)`;
  }
  return joined;
}
