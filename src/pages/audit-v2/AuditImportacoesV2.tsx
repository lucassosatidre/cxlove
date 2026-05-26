import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import {
  Loader2, CheckCircle2, Circle, Play, FileText, Trash2, AlertTriangle,
  ChevronDown, ChevronRight, Info, CopyCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import AuditNavTabsV2 from '@/components/audit-v2/AuditNavTabsV2';
import {
  UploadMaquinonaCard, UploadCresolCard,
  UploadBBCard, UploadTicketCard, UploadAleloCard, UploadVRCard,
  UploadPluxeeVendasCard, UploadPluxeePagamentosCard,
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

const fmtInt = (v: number) => Number(v || 0).toLocaleString('pt-BR');
const fmtMoney = (v: number) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

type ImportRow = {
  id: string;
  file_type: string;
  status: string;
  imported_rows: number;
  created_at: string;
  file_name: string;
};

type IntakeRow = {
  grupo: string;
  doc: string;
  doc_id: string;
  ym: string;          // 'YYYY-MM'
  linhas: number;
  data_min: string | null;
  data_max: string | null;
  valor: number;
};

type SlotKind = 'comp' | 'post';

type DocSpec = {
  docId: string;                 // bate com RPC doc_id
  label: string;
  format: string;
  slots: SlotKind[];
  filesPerSlot: number;
  fileTypes: string[];           // audit_imports.file_type
  group: 'maquinona' | 'vouchers' | 'brendi' | 'ifood';
  Component: React.ComponentType<{
    period: AuditPeriodLite | null;
    ensurePeriod: () => Promise<AuditPeriodLite | null>;
    onAfter: () => Promise<void> | void;
  }>;
  postUpload?: (periodId: string) => Promise<void>;
  /** Texto curto pra explicar o motivo do mês 'post' */
  postReason?: string;
};

const GROUP_LABELS: Record<DocSpec['group'], string> = {
  maquinona: 'Maquinona iFood',
  vouchers: 'Vouchers',
  brendi: 'Brendi',
  ifood: 'iFood Marketplace',
};

// ───────── helpers de mês ─────────
const ymOf = (year: number, month: number): string =>
  `${year}-${String(month).padStart(2, '0')}`;

const addMonth = (year: number, month: number, delta: number): { year: number; month: number } => {
  const idx = (year * 12 + (month - 1)) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
};

const slotYm = (slot: SlotKind, compYear: number, compMonth: number): string => {
  if (slot === 'comp') return ymOf(compYear, compMonth);
  const { year, month } = addMonth(compYear, compMonth, 1);
  return ymOf(year, month);
};

const ymLabel = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[(m - 1 + 12) % 12]}/${y}`;
};

export default function AuditImportacoesV2() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const now = new Date();

  const [month, setMonth] = useState<number>(Number(searchParams.get('month')) || now.getMonth() + 1);
  const [year, setYear] = useState<number>(Number(searchParams.get('year')) || now.getFullYear());
  const [period, setPeriod] = useState<AuditPeriodLite | null>(null);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [intake, setIntake] = useState<IntakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAudit, setRunningAudit] = useState(false);
  const [toDelete, setToDelete] = useState<ImportRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // URL sync
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('month', String(month));
    next.set('year', String(year));
    setSearchParams(next, { replace: true });
  }, [month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async (periodId: string) => {
    const [impsRes, intakeRes] = await Promise.all([
      supabase
        .from('audit_imports')
        .select('id, file_type, status, imported_rows, created_at, file_name')
        .eq('audit_period_id', periodId)
        .order('created_at', { ascending: false }),
      supabase.rpc('audit_intake_by_month' as any, { p_period: periodId }),
    ]);
    setImports((impsRes.data ?? []) as any);
    if (intakeRes.error) {
      console.warn('[intake_by_month] erro:', intakeRes.error);
      setIntake([]);
    } else {
      setIntake(((intakeRes.data ?? []) as any[]).map(r => ({
        grupo: String(r.grupo ?? ''),
        doc: String(r.doc ?? ''),
        doc_id: String(r.doc_id ?? ''),
        ym: String(r.ym ?? ''),
        linhas: Number(r.linhas ?? 0),
        data_min: r.data_min ?? null,
        data_max: r.data_max ?? null,
        valor: Number(r.valor ?? 0),
      })));
    }
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
      else { setImports([]); setIntake([]); }
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

  const deleteImpactText = (fileType: string): string => {
    switch (fileType) {
      case 'maquinona': return 'As transações da Maquinona usam transaction_id como chave (UPSERT). Re-upload sobrescreve as mesmas linhas.';
      case 'vr_vendas': return 'Itens vinculados a lotes VR não são apagados aqui (vínculo via lot_id). Re-upload reprocessa.';
      case 'cresol':
      case 'bb': return 'Todos os depósitos bancários vinculados a este arquivo serão apagados.';
      case 'ticket':
      case 'alelo':
      case 'pluxee':
      case 'pluxee_vendas':
      case 'pluxee_pagamentos':
      case 'vr': return 'Todos os lotes de voucher e seus itens vinculados a este arquivo serão apagados.';
      case 'brendi': return 'Todos os pedidos Brendi vinculados a este arquivo serão apagados.';
      case 'saipos': return 'Todas as vendas Saipos vinculadas a este arquivo serão apagadas.';
      case 'ifood_orders': return 'Todos os pedidos iFood vinculados a este arquivo serão apagados.';
      case 'ifood_conta_csv': return 'Todos os movimentos da conta iFood Pago vinculados a este arquivo serão apagados.';
      case 'ifood_extrato_detalhado': return 'Todos os lançamentos detalhados E os repasses agregados desta loja (no período) serão apagados.';
      default: return 'Apenas o registro de importação será apagado.';
    }
  };

  const handleDeleteImport = async () => {
    if (!toDelete || !period) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc('delete_audit_import', { p_import_id: toDelete.id });
      if (error) throw error;
      const rows = (data as any)?.deleted_data_rows ?? 0;
      toast.success('Arquivo apagado', {
        description: `${toDelete.file_name} · ${rows} registro(s) vinculado(s) removido(s).`,
      });
      setToDelete(null);
      await refresh(period.id);
    } catch (e: any) {
      toast.error('Falha ao apagar', { description: e?.message ?? 'Erro desconhecido' });
    } finally {
      setDeleting(false);
    }
  };

  const runFullAudit = async () => {
    const p = await ensurePeriod();
    if (!p) return;
    setRunningAudit(true);
    const results: string[] = [];
    try {
      try {
        const { data, error } = await supabase.functions.invoke('run-audit-match', { body: { audit_period_id: p.id } });
        if (error) throw new Error(error.message);
        results.push(data?.success
          ? `Maquinona × Cresol: ${data.daily_matches_count ?? 0} dias casados`
          : `Maquinona × Cresol: ${data?.error || 'falha'}`);
      } catch (e: any) { results.push(`Maquinona × Cresol: erro — ${e?.message ?? 'desconhecido'}`); }

      try {
        await dispatchAutoMatchVouchers(p.id, ['ticket', 'alelo', 'vr', 'pluxee']);
        results.push('Vouchers: match disparado');
      } catch (e: any) { results.push(`Vouchers: erro — ${e?.message ?? 'desconhecido'}`); }

      try {
        const res = await dispatchMatchBrendi(p.id);
        if (res) results.push(`Brendi: ${res.daily.rows} dias · ${res.crosscheck.ok} ok`);
        else results.push('Brendi: erro (ver toasts)');
      } catch (e: any) { results.push(`Brendi: erro — ${e?.message ?? 'desconhecido'}`); }

      try {
        const res = await dispatchMatchIfoodMarketplace(p.id);
        if (res) results.push(`iFood Mkt: ${res.repasses.total} repasses`);
        else results.push('iFood Marketplace: erro (ver toasts)');
      } catch (e: any) { results.push(`iFood Marketplace: erro — ${e?.message ?? 'desconhecido'}`); }

      await refresh(p.id);
      toast.success('✓ Auditoria concluída', { description: results.join(' · '), duration: 8000 });
    } finally {
      setRunningAudit(false);
    }
  };

  const DOCS: DocSpec[] = useMemo(() => [
    // Maquinona
    {
      docId: 'maquinona', label: 'Maquinona iFood', format: '.xlsx',
      slots: ['comp'], filesPerSlot: 1, fileTypes: ['maquinona'],
      group: 'maquinona', Component: UploadMaquinonaCard,
    },
    {
      docId: 'cresol', label: 'Extrato Cresol', format: '.xlsx',
      slots: ['comp', 'post'], filesPerSlot: 1, fileTypes: ['cresol'],
      group: 'maquinona', Component: UploadCresolCard,
      postReason: 'crédito D+1 das vendas do fim do mês',
    },
    // Vouchers
    {
      docId: 'bb', label: 'Extrato Banco do Brasil', format: '.xlsx',
      slots: ['comp', 'post'], filesPerSlot: 1, fileTypes: ['bb'],
      group: 'vouchers', Component: UploadBBCard,
      postReason: 'crédito D+1 dos depósitos voucher',
      postUpload: async (pid) => { await dispatchAutoMatchVouchers(pid, ['ticket', 'alelo', 'pluxee', 'vr']); },
    },
    {
      docId: 'ticket', label: 'Reembolsos Ticket', format: '.pdf',
      slots: ['comp'], filesPerSlot: 1, fileTypes: ['ticket'],
      group: 'vouchers', Component: UploadTicketCard,
      postUpload: async (pid) => { await dispatchAutoMatchVouchers(pid, ['ticket']); },
    },
    {
      docId: 'alelo', label: 'Extrato Alelo', format: '.xlsx',
      slots: ['comp'], filesPerSlot: 1, fileTypes: ['alelo'],
      group: 'vouchers', Component: UploadAleloCard,
      postUpload: async (pid) => { await dispatchAutoMatchVouchers(pid, ['alelo']); },
    },
    {
      docId: 'vr', label: 'Vale Refeição (VR)', format: '.xls',
      slots: ['comp'], filesPerSlot: 2, fileTypes: ['vr', 'vr_vendas'],
      group: 'vouchers', Component: UploadVRCard,
      postUpload: async (pid) => { await dispatchAutoMatchVouchers(pid, ['vr']); },
    },
    {
      docId: 'pluxee_vendas', label: 'Pluxee — Extrato de Vendas', format: '.xlsx',
      slots: ['comp'], filesPerSlot: 1, fileTypes: ['pluxee_vendas'],
      group: 'vouchers', Component: UploadPluxeeVendasCard,
    },
    {
      docId: 'pluxee_pagamentos', label: 'Pluxee — Extrato de Pagamentos', format: '.xlsx',
      slots: ['comp', 'post'], filesPerSlot: 1, fileTypes: ['pluxee_pagamentos'],
      group: 'vouchers', Component: UploadPluxeePagamentosCard,
      postReason: 'pagamento pode cair no mês seguinte',
      postUpload: async (pid) => { await dispatchAutoMatchVouchers(pid, ['pluxee']); },
    },
    // Brendi
    {
      docId: 'brendi', label: 'Pedidos Brendi', format: '.xlsx',
      slots: ['comp'], filesPerSlot: 1, fileTypes: ['brendi'],
      group: 'brendi', Component: UploadBrendiCard,
    },
    {
      docId: 'saipos', label: 'Vendas Saipos', format: '.xlsx',
      slots: ['comp'], filesPerSlot: 1, fileTypes: ['saipos'],
      group: 'brendi', Component: UploadSaiposCard,
    },
    // iFood
    {
      docId: 'ifood_extrato_detalhado', label: 'Extrato Detalhado iFood', format: '.xlsx',
      slots: ['comp'], filesPerSlot: 2, fileTypes: ['ifood_extrato_detalhado'],
      group: 'ifood', Component: UploadIfoodExtratoDetalhadoCard,
    },
    {
      docId: 'ifood_orders', label: 'Relatório de Pedidos iFood', format: '.xlsx',
      slots: ['comp'], filesPerSlot: 2, fileTypes: ['ifood_orders'],
      group: 'ifood', Component: UploadIfoodOrdersCard,
    },
    {
      docId: 'ifood_conta_csv', label: 'Conta iFood Pago (CSV)', format: '.csv',
      slots: ['comp', 'post'], filesPerSlot: 1, fileTypes: ['ifood_conta_csv'],
      group: 'ifood', Component: UploadIfoodContaCsvCard,
      postReason: 'antecipação pode cair no mês seguinte',
    },
  ], []);

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

  // Index pra lookup rápido: doc_id → ym → IntakeRow
  const intakeByDocYm = new Map<string, Map<string, IntakeRow>>();
  for (const row of intake) {
    if (!intakeByDocYm.has(row.doc_id)) intakeByDocYm.set(row.doc_id, new Map());
    intakeByDocYm.get(row.doc_id)!.set(row.ym, row);
  }

  // Imports por file_type (todos os file_types do doc)
  const importsForDoc = (doc: DocSpec) =>
    imports.filter(i => doc.fileTypes.includes(i.file_type) && i.status === 'completed');

  // Detecta duplicatas (mesmo file_type + mesmo imported_rows, ≥2 ocorrências)
  const dupKeys = (doc: DocSpec): Map<string, ImportRow[]> => {
    const m = new Map<string, ImportRow[]>();
    for (const imp of importsForDoc(doc)) {
      const k = `${imp.file_type}|${imp.imported_rows}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(imp);
    }
    for (const [k, list] of m) if (list.length < 2) m.delete(k);
    return m;
  };

  return (
    <AppLayout title="Importações" subtitle="Documentos necessários para a auditoria">
      <div className="space-y-4">
        <AuditNavTabsV2 />

        {/* Legenda */}
        <Card>
          <CardContent className="py-3">
            <div className="flex items-start gap-2 text-xs">
              <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div className="space-y-1 text-muted-foreground">
                <div className="font-medium text-foreground">Como ler esta tela</div>
                <div>• Cada documento mostra os <span className="text-foreground">meses que ele precisa</span> ter.</div>
                <div>• <CheckCircle2 className="inline h-3 w-3 text-green-600 dark:text-green-400" /> <span className="text-foreground">verde</span> = arquivo lido cobrindo o mês certo · <Circle className="inline h-3 w-3" /> <span className="text-foreground">cinza</span> = falta importar · <AlertTriangle className="inline h-3 w-3 text-amber-600 dark:text-amber-400" /> <span className="text-foreground">âmbar</span> = entrou dado de um mês que não devia estar aqui.</div>
                <div>• <span className="text-foreground">"Banco credita D+1"</span>: Cresol e BB do mês seguinte são necessários porque vendas do fim do mês caem na conta só no mês seguinte.</div>
                <div>• Clique <span className="text-foreground">[ver]</span> pra conferir datas e valores que o sistema leu de cada arquivo.</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Seletor de período + Executar */}
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
              <Badge variant="secondary">{MONTHS[month - 1]} {year} · {period.status}</Badge>
            )}
            <div className="ml-auto">
              <Button onClick={runFullAudit} disabled={!period || runningAudit} size="lg" className="gap-2">
                {runningAudit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {runningAudit ? 'Executando auditoria...' : 'Executar Auditoria'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Grupos */}
        {groups.map(group => {
          const docsInGroup = DOCS.filter(d => d.group === group);
          return (
            <Card key={group}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{GROUP_LABELS[group]}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {docsInGroup.map(doc => {
                  const docImports = importsForDoc(doc);
                  const docIntake = intakeByDocYm.get(doc.docId) ?? new Map<string, IntakeRow>();
                  const expectedYms = new Set(doc.slots.map(s => slotYm(s, year, month)));
                  const unexpectedYms = [...docIntake.keys()].filter(ym => !expectedYms.has(ym)).sort();
                  const dups = dupKeys(doc);
                  const Component = doc.Component;

                  return (
                    <div key={doc.docId} className="rounded-md border bg-card/50 p-3 space-y-3">
                      {/* Header */}
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <FileText className="h-4 w-4 text-muted-foreground self-center" />
                        <span className="font-medium">{doc.label}</span>
                        <span className="text-xs text-muted-foreground">({doc.format})</span>
                        {dups.size > 0 && (
                          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] gap-1">
                            <CopyCheck className="h-3 w-3" />
                            {[...dups.values()].reduce((a, l) => a + l.length, 0)} arquivos duplicados — pode apagar os repetidos
                          </Badge>
                        )}
                      </div>

                      {/* Slots esperados */}
                      <div className="space-y-1.5 pl-1">
                        {doc.slots.map(slot => {
                          const ym = slotYm(slot, year, month);
                          const intakeRow = docIntake.get(ym);
                          const filesNeeded = doc.filesPerSlot;
                          // Contagem de imports completados desse file_type (proxy pra slots multi-arquivo)
                          const importsCount = docImports.length;
                          const slotFilled = filesNeeded > 1
                            ? !!intakeRow && importsCount >= filesNeeded
                            : !!intakeRow;
                          const expandKey = `${doc.docId}|${ym}`;
                          const isExpanded = expanded[expandKey];

                          return (
                            <div key={ym} className="rounded border border-border/50 bg-background/40">
                              <div className="flex items-start gap-2 px-2 py-1.5 text-xs flex-wrap">
                                {slotFilled
                                  ? <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                                  : <Circle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
                                <span className="font-medium text-foreground min-w-[110px]">{ymLabel(ym)}</span>
                                {intakeRow ? (
                                  <>
                                    <span className="text-muted-foreground">
                                      lido: <span className="text-foreground">{fmtDate(intakeRow.data_min)}</span> a <span className="text-foreground">{fmtDate(intakeRow.data_max)}</span>
                                      {' · '}
                                      <span className="text-foreground">{fmtInt(intakeRow.linhas)}</span> linhas
                                      {' · '}
                                      <span className="text-foreground">{fmtMoney(intakeRow.valor)}</span>
                                    </span>
                                    {filesNeeded > 1 && (
                                      <Badge variant={importsCount >= filesNeeded ? 'default' : 'outline'} className="text-[10px]">
                                        {Math.min(importsCount, filesNeeded)} de {filesNeeded} arquivos
                                      </Badge>
                                    )}
                                    <Button
                                      variant="ghost" size="sm"
                                      className="h-6 px-2 text-xs ml-auto"
                                      onClick={() => setExpanded(s => ({ ...s, [expandKey]: !s[expandKey] }))}
                                    >
                                      {isExpanded ? <ChevronDown className="h-3 w-3 mr-1" /> : <ChevronRight className="h-3 w-3 mr-1" />}
                                      ver
                                    </Button>
                                  </>
                                ) : (
                                  <span className="text-muted-foreground italic">Falta importar</span>
                                )}
                                {slot === 'post' && doc.postReason && (
                                  <span className="text-[10px] italic text-muted-foreground basis-full pl-6">
                                    ({doc.postReason})
                                  </span>
                                )}
                              </div>

                              {/* Detalhe expandido: lista de imports daquele file_type */}
                              {isExpanded && intakeRow && (
                                <div className="border-t border-border/50 px-2 py-2 space-y-1 text-xs bg-muted/30">
                                  <div className="text-muted-foreground">
                                    Período: <span className="text-foreground">{fmtDate(intakeRow.data_min)} → {fmtDate(intakeRow.data_max)}</span>
                                    {' · '}
                                    <span className="text-foreground">{fmtInt(intakeRow.linhas)}</span> linhas
                                    {' · '}
                                    Total: <span className="text-foreground">{fmtMoney(intakeRow.valor)}</span>
                                  </div>
                                  <div className="pt-1 text-[11px] uppercase text-muted-foreground">Arquivos importados ({doc.fileTypes.join(', ')})</div>
                                  {docImports.length === 0 ? (
                                    <div className="text-muted-foreground italic">Nenhum registro em audit_imports.</div>
                                  ) : docImports.map(imp => (
                                    <div key={imp.id} className="flex items-center gap-2 text-muted-foreground">
                                      <FileText className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0" />
                                      <span className="font-mono text-foreground truncate" title={imp.file_name}>{imp.file_name}</span>
                                      <span>·</span>
                                      <span>{fmtInt(imp.imported_rows)} linhas</span>
                                      <span>·</span>
                                      <span>{new Date(imp.created_at).toLocaleDateString('pt-BR')}</span>
                                      <Button
                                        variant="ghost" size="icon"
                                        className="h-6 w-6 ml-auto text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                                        onClick={() => setToDelete(imp)}
                                        title="Apagar este arquivo"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Linhas inesperadas (spillover) */}
                        {unexpectedYms.map(ym => {
                          const r = docIntake.get(ym)!;
                          return (
                            <div key={`u-${ym}`} className="rounded border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs flex items-start gap-2 flex-wrap">
                              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                              <span className="font-medium text-amber-700 dark:text-amber-300 min-w-[110px]">{ymLabel(ym)}</span>
                              <span className="text-muted-foreground">
                                <span className="text-foreground">{fmtInt(r.linhas)}</span> linhas · <span className="text-foreground">{fmtMoney(r.valor)}</span>
                              </span>
                              <span className="basis-full pl-6 text-amber-700/80 dark:text-amber-300/80 italic">
                                esse documento NÃO deveria ter dados de {ymLabel(ym).split('/')[0].toLowerCase()}. Provável venda de outro mês que entrou aqui — confira na aba do canal.
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Card de upload */}
                      <div className="pl-1">
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

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && !deleting && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar este arquivo importado?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div className="font-mono text-xs bg-muted p-2 rounded break-all">{toDelete?.file_name}</div>
                <p>{toDelete ? deleteImpactText(toDelete.file_type) : ''}</p>
                <p className="text-xs italic">Após apagar, faça o upload da versão atualizada e reexecute a auditoria.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteImport(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
