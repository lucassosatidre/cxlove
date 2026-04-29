// rebuild trigger
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from '@/hooks/use-toast';
import { Plus, ArrowRight, FileSpreadsheet, Loader2, Play, RefreshCw, AlertTriangle, Download, Lock, LockOpen, History, Search, UploadCloud } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { generateAuditPdf, periodFileTag, periodLabel as makePeriodLabel, type AuditPdfData } from '@/lib/audit-pdf';
import {
  generateContabilPdf,
  CATEGORIAS_ORDEM,
  CATEGORIA_LABELS,
  type ContabilCategoria,
  type ContabilResumoRow,
  type ContabilDetalhamento,
} from '@/lib/audit-pdf-contabil';
import { CloseConfirmDialog, ReopenDialog } from '@/components/audit/PeriodCloseDialog';

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FileText, ChevronDown } from 'lucide-react';
import * as XLSX from 'xlsx';

type AuditPeriod = {
  id: string;
  month: number;
  year: number;
  status: 'aberto' | 'importado' | 'conciliado' | 'fechado';
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
};

type ImportSource =
  | 'maquinona' | 'cresol' | 'bb'
  | 'pluxee' | 'alelo' | 'vr' | 'ticket';

type AuditImport = {
  file_type: 'maquinona' | 'cresol' | 'bb';
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

const FILE_LABELS: Record<ImportSource, string> = {
  maquinona: 'Maquinona',
  cresol: 'Cresol (iFood)',
  bb: 'Banco do Brasil',
  pluxee: 'Pluxee',
  alelo: 'Alelo',
  vr: 'VR',
  ticket: 'Ticket',
};

const SOURCE_GROUPS: { label: string; sources: ImportSource[] }[] = [
  { label: 'Vendas & bancos', sources: ['maquinona', 'cresol', 'bb'] },
  { label: 'Extratos das operadoras de voucher', sources: ['pluxee', 'alelo', 'vr', 'ticket'] },
];

const ACCEPT_BY_SOURCE: Record<ImportSource, string> = {
  maquinona: '.xlsx',
  cresol: '.xlsx',
  bb: '.xlsx',
  pluxee: '.csv',
  alelo: '.xlsx',
  vr: '.xls,.xlsx',
  ticket: '.xlsx',
};

const FUNCTION_BY_SOURCE: Record<ImportSource, string> = {
  maquinona: 'import-maquinona',
  cresol: 'import-cresol',
  bb: 'import-bb',
  pluxee: 'import-voucher-pluxee',
  alelo: 'import-voucher-alelo',
  vr: 'import-voucher-vr',
  ticket: 'import-voucher-ticket',
};

async function readAsTextDetect(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('latin1').decode(bytes);
  }
}

async function buildUploadPayload(src: ImportSource, periodId: string, file: File): Promise<any> {
  const base = { audit_period_id: periodId, file_name: file.name };

  if (src === 'maquinona') {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheetName = wb.SheetNames.find(
      n => n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase() === 'transacoes'
    );
    if (!sheetName) throw new Error('Aba "Transações" não encontrada no arquivo Maquinona.');
    const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[sheetName], { defval: null, raw: false });
    return { ...base, rows };
  }

  if (src === 'cresol') {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
    return { ...base, rows };
  }

  if (src === 'bb') {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheetName = wb.SheetNames.find(n => /extrato/i.test(n)) ?? wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
    return { ...base, rows };
  }

  if (src === 'pluxee') {
    const text = await readAsTextDetect(file);
    const sep = text.split('\n')[0].includes(';') ? ';' : ',';
    const rows = text.split('\n').map(l => l.split(sep).map(c => c.trim()));
    return { ...base, rows };
  }

  if (src === 'alelo') {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const recebimentosSheet = wb.SheetNames.find(n => /recebimentos/i.test(n)) ?? wb.SheetNames[1];
    const outrasSheet = wb.SheetNames.find(n => /outras/i.test(n));
    return {
      ...base,
      recebimentos_rows: recebimentosSheet
        ? XLSX.utils.sheet_to_json(wb.Sheets[recebimentosSheet], { header: 1, defval: null, raw: true })
        : [],
      outras_rows: outrasSheet
        ? XLSX.utils.sheet_to_json(wb.Sheets[outrasSheet], { header: 1, defval: null, raw: true })
        : [],
    };
  }

  if (src === 'vr') {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
    return { ...base, rows };
  }

  if (src === 'ticket') {
    const file_base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const result = r.result as string;
        resolve(result.substring(result.indexOf(',') + 1));
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    return { ...base, file_base64 };
  }

  throw new Error(`Source desconhecido: ${src}`);
}

const COMPANY_LABELS: Record<string, string> = {
  alelo: 'Alelo', ticket: 'Ticket', pluxee: 'Pluxee', vr: 'VR',
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
  const [voucherMatches, setVoucherMatches] = useState<Array<{
    company: string;
    sold_amount: number;
    sold_count: number;
    deposited_amount: number;
    deposit_count: number;
    difference: number;
    effective_tax_rate: number;
    status: string;
  }>>([]);
  const [depositRows, setDepositRows] = useState<{ category: string | null; bank: string | null; match_status?: string | null; total_amount: number; deposit_count: number }[]>([]);
  const [ifoodCompetencia, setIfoodCompetencia] = useState(0);
  const [ifoodAdjacente, setIfoodAdjacente] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [userNamesById, setUserNamesById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingContabil, setExportingContabil] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [uploadingSource, setUploadingSource] = useState<ImportSource | null>(null);
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
    const [{ data: imps }, { data: allImps }, { data: totalsRpc }, { data: depsRpc }, { data: dMatches }, { data: vMatches }, { data: logRows }, { data: ifoodCompRows }] = await Promise.all([
      supabase.from('audit_imports').select('file_type,status,file_name,imported_rows,created_at').eq('audit_period_id', periodId).order('created_at', { ascending: false }),
      supabase.from('vw_period_imports' as any).select('*').eq('audit_period_id', periodId).order('created_at', { ascending: false }),
      supabase.rpc('get_audit_period_totals', { p_period_id: periodId }),
      supabase.rpc('get_audit_period_deposits', { p_period_id: periodId }),
      supabase.from('audit_daily_matches').select('match_date,expected_amount,deposited_amount,difference,transaction_count,status').eq('audit_period_id', periodId).order('match_date'),
      supabase.from('audit_voucher_matches').select('company,sold_amount,sold_count,deposited_amount,deposit_count,difference,effective_tax_rate,status').eq('audit_period_id', periodId),
      supabase.from('audit_period_log').select('id,action,user_id,reason,created_at').eq('audit_period_id', periodId).order('created_at', { ascending: true }),
      supabase.from('audit_bank_deposits').select('matched_competencia_amount,matched_adjacente_amount').eq('audit_period_id', periodId).eq('bank', 'cresol').eq('category', 'ifood'),
    ]);
    setImports((imps as AuditImport[]) ?? []);
    setAllImports(((allImps as unknown) as PeriodImportRow[]) ?? []);

    const t = (totalsRpc as any[])?.[0] ?? {};
    const bruto = Number(t.total_bruto ?? 0);
    const liquidoDeclarado = Number(t.total_liquido_declarado ?? 0);
    const liquidoIfood = Number(t.total_liquido_ifood ?? 0);
    const brutoIfood = Number(t.total_bruto_ifood ?? 0);
    const taxa = Number(t.total_taxa_declarada ?? 0);
    const promocao = Number(t.total_promocao ?? 0);
    const txCount = Number(t.total_count ?? 0);
    const custoDeclarado = Math.max(bruto - liquidoDeclarado, 0);

    const depRows = (depsRpc as { category: string | null; bank: string | null; match_status?: string | null; total_amount: number; deposit_count: number }[]) ?? [];

    // iFood matched de COMPETÊNCIA (sem overshoot de meses adjacentes)
    const ifoodComp = ((ifoodCompRows as any[]) ?? []).reduce(
      (s, d) => s + Number(d.matched_competencia_amount || 0), 0
    );
    const ifoodAdj = ((ifoodCompRows as any[]) ?? []).reduce(
      (s, d) => s + Number(d.matched_adjacente_amount || 0), 0
    );
    setIfoodCompetencia(ifoodComp);
    setIfoodAdjacente(ifoodAdj);

    // Voucher matched (BB) — usa valor cheio do depósito (sem split adjacente)
    const voucherMatched = depRows
      .filter(d => d.bank === 'bb' && d.match_status === 'matched')
      .reduce((s, d) => s + Number(d.total_amount || 0), 0);

    const recebido = ifoodComp + voucherMatched;
    const custoReal = Math.max(bruto - recebido, 0);
    const taxaEfetiva = bruto > 0 ? (custoReal / bruto) * 100 : 0;

    setTotals({
      vendido: bruto, recebido, custo: custoReal, taxaPct: taxaEfetiva,
      txCount, bruto, taxa: taxa + promocao, liquidoDeclarado, custoDeclarado,
      liquidoIfood, brutoIfood,
    });
    setDepositRows(depRows);
    
    setDailyMatches((dMatches as DailyMatch[]) ?? []);
    setVoucherMatches((vMatches as any[])?.map(m => ({
      company: m.company,
      sold_amount: Number(m.sold_amount ?? 0),
      sold_count: Number(m.sold_count ?? 0),
      deposited_amount: Number(m.deposited_amount ?? 0),
      deposit_count: Number(m.deposit_count ?? 0),
      difference: Number(m.difference ?? 0),
      effective_tax_rate: Number(m.effective_tax_rate ?? 0),
      status: m.status,
    })) ?? []);
    setLogs((logRows as LogEntry[]) ?? []);
  };

  const handleUpload = async (src: ImportSource, files: FileList | null) => {
    if (!files || files.length === 0 || !period) return;
    setUploadingSource(src);
    let okCount = 0;
    let errCount = 0;
    try {
      for (const file of Array.from(files)) {
        try {
          const body = await buildUploadPayload(src, period.id, file);
          const { data, error } = await supabase.functions.invoke(FUNCTION_BY_SOURCE[src], { body });
          if (error) throw new Error(error.message);
          if ((data as any)?.error) throw new Error((data as any).error);
          if (data && (data as any).success === false) throw new Error((data as any).error || 'Falha na importação');
          okCount++;
        } catch (e: any) {
          errCount++;
          toast({
            title: `Erro em "${file.name}"`,
            description: e?.message ?? 'Erro inesperado',
            variant: 'destructive',
          });
        }
      }
      if (okCount > 0) {
        toast({
          title: `✓ ${FILE_LABELS[src]}`,
          description: `${okCount} arquivo(s) importado(s)${errCount > 0 ? ` · ${errCount} com erro` : ''}`,
        });
        await loadPeriodData(period.id);
      }
    } finally {
      setUploadingSource(null);
    }
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
        setVoucherMatches([]);
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

  const importByType = (t: 'maquinona' | 'cresol' | 'bb') => imports.find(i => i.file_type === t);
  const allImported = ['maquinona', 'cresol', 'bb'].every(t => importByType(t as any)?.status === 'completed');
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
        description: `${(data as any).daily_matches_count} matches diários · ${(data as any).voucher_matches_count} matches voucher`,
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

  const buildPdfData = async (): Promise<AuditPdfData> => {
    // Detalhamento diário iFood: vendas competência + somente depósitos matched
    const { data: dailyDetail } = await supabase
      .rpc('get_audit_ifood_daily_detail' as any, { p_period_id: period!.id });

    const dailyRows = ((dailyDetail as Array<{
      match_date: string;
      vendas_count: number;
      bruto: number;
      liquido: number;
      deposito: number;
      diferenca: number;
      status: string;
    }>) ?? []).map(r => ({
      match_date: r.match_date,
      transaction_count: Number(r.vendas_count || 0),
      gross: Number(r.bruto || 0),
      expected_amount: Number(r.liquido || 0),
      deposited_amount: Number(r.deposito || 0),
      difference: Number(r.diferenca || 0),
      status: r.status,
    }));

    // Recebido iFood matched (Cresol) — somente valor de competência
    const recebidoCresol = ifoodCompetencia;

    return {
      periodLabel: makePeriodLabel(month, year),
      periodFileTag: periodFileTag(month, year),
      emittedBy: user?.email ?? 'Admin',
      totals: {
        vendido: totals.vendido,
        recebido: totals.recebido,
        custoTotal: totals.custo,
        taxaEfetiva: totals.taxaPct,
      },
      criticalVouchers: [],
      ifoodSummary: {
        bruto: totals.brutoIfood,
        taxaDeclarada: Math.max(totals.brutoIfood - totals.liquidoIfood, 0),
        liquidoEsperado: totals.liquidoIfood,
        depositoCresol: recebidoCresol,
        diferenca: recebidoCresol - totals.liquidoIfood,
      },
      dailyRows,
      voucherRows: [],
    };
  };

  const handleExportPdf = async () => {
    if (!canExport) return;
    setExportingPdf(true);
    try {
      const pdfData = await buildPdfData();
      generateAuditPdf('completo', pdfData);
      toast({ title: '✓ Relatório exportado' });
    } catch (e: any) {
      toast({ title: 'Erro ao gerar PDF', description: e.message ?? 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportContabil = async (mode: 'resumido' | 'detalhado') => {
    if (!period) return;
    setExportingContabil(true);
    try {
      const { data: breakdown, error } = await supabase
        .rpc('get_audit_contabil_breakdown' as any, { p_period_id: period.id });
      if (error) throw error;

      const rows = (breakdown as Array<{ categoria: string; dia: number; qtd: number; bruto: number; liquido: number; taxa: number }>) ?? [];
      const validCats = new Set<ContabilCategoria>(CATEGORIAS_ORDEM);

      // Aggregate per categoria
      const resumoMap = new Map<ContabilCategoria, ContabilResumoRow>();
      for (const r of rows) {
        if (!validCats.has(r.categoria as ContabilCategoria)) continue;
        const cat = r.categoria as ContabilCategoria;
        const cur = resumoMap.get(cat) ?? {
          categoria: cat, nome: CATEGORIA_LABELS[cat], qtd: 0, bruto: 0, liquido: 0, taxa: 0,
        };
        cur.qtd += Number(r.qtd ?? 0);
        cur.bruto += Number(r.bruto ?? 0);
        cur.liquido += Number(r.liquido ?? 0);
        cur.taxa += Number(r.taxa ?? 0);
        resumoMap.set(cat, cur);
      }
      const resumoPorCategoria: ContabilResumoRow[] = CATEGORIAS_ORDEM
        .filter(c => c !== 'brendi')
        .map(c => resumoMap.get(c) ?? {
          categoria: c, nome: CATEGORIA_LABELS[c], qtd: 0, bruto: 0, liquido: 0, taxa: 0,
        });

      const monthDays = new Date(year, month, 0).getDate();

      let detalhamentoDiario: ContabilDetalhamento[] | undefined;
      if (mode === 'detalhado') {
        const detMap = new Map<ContabilCategoria, Map<number, { qtd: number; bruto: number; liquido: number; taxa: number }>>();
        for (const r of rows) {
          if (!validCats.has(r.categoria as ContabilCategoria)) continue;
          const cat = r.categoria as ContabilCategoria;
          if (!detMap.has(cat)) detMap.set(cat, new Map());
          detMap.get(cat)!.set(Number(r.dia), {
            qtd: Number(r.qtd ?? 0),
            bruto: Number(r.bruto ?? 0),
            liquido: Number(r.liquido ?? 0),
            taxa: Number(r.taxa ?? 0),
          });
        }
        detalhamentoDiario = CATEGORIAS_ORDEM
          .filter(c => c !== 'brendi')
          .map(cat => ({
            categoria: cat,
            dias: Array.from({ length: monthDays }, (_, i) => {
              const d = i + 1;
              const v = detMap.get(cat)?.get(d);
              return { dia: d, qtd: v?.qtd ?? 0, bruto: v?.bruto ?? 0, liquido: v?.liquido ?? 0, taxa: v?.taxa ?? 0 };
            }),
          }));
      }

      generateContabilPdf(mode, {
        periodLabel: makePeriodLabel(month, year),
        periodFileTag: periodFileTag(month, year),
        monthDays,
        emittedBy: user?.email ?? 'Admin',
        resumoPorCategoria,
        detalhamentoDiario,
      });
      toast({ title: '✓ Relatório Contábil gerado' });
    } catch (e: any) {
      toast({ title: 'Erro ao gerar relatório', description: e.message ?? 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setExportingContabil(false);
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
  const criticalVouchers = voucherMatches.filter(v => v.status === 'critico');

  const ifoodGap = dailyMatches.reduce((s, m) => s + Number(m.difference || 0), 0);
  const custoReal = isConciliated || isClosed
    ? Math.abs(Math.min(ifoodGap, 0)) + (totals.recebido > 0 ? Math.max(0, totals.vendido - totals.recebido) : 0)
    : totals.custo;

  // Breakdown of bank deposits by match_status (for iFood and Voucher cards)
  const sumDeposits = (filterFn: (d: typeof depositRows[number]) => boolean) =>
    depositRows.filter(filterFn).reduce((s, d) => s + Number(d.total_amount || 0), 0);

  // iFood: matched usa SOMENTE valor de competência; adjacente vem do state ifoodAdjacente
  const ifoodMatched = ifoodCompetencia;
  const ifoodNaoId = sumDeposits(d => d.bank === 'cresol' && d.category === 'ifood' && d.match_status === 'nao_identificado');

  const voucherDepBy = (company: string, status: string) =>
    sumDeposits(d => d.bank === 'bb' && d.category === company && d.match_status === status);

  const periodLabelStr = makePeriodLabel(month, year);

  const exportBtn = (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="outline"
              onClick={handleExportPdf}
              disabled={!canExport || exportingPdf}
              className="gap-2"
            >
              {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exportingPdf ? 'Gerando PDF...' : 'Exportar PDF'}
            </Button>
          </span>
        </TooltipTrigger>
        {!canExport && (
          <TooltipContent>Execute a conciliação antes de exportar</TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );

  const maquinonaImported = importByType('maquinona')?.status === 'completed';
  const contabilBtn = (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  disabled={!maquinonaImported || exportingContabil}
                  className="gap-2"
                >
                  {exportingContabil ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  {exportingContabil ? 'Gerando...' : 'Relatório Contábil'}
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExportContabil('resumido')}>
                  Resumido
                  <span className="ml-2 text-xs text-muted-foreground">1 página · totais</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportContabil('detalhado')}>
                  Detalhado
                  <span className="ml-2 text-xs text-muted-foreground">dia-a-dia por categoria</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </TooltipTrigger>
        {!maquinonaImported && (
          <TooltipContent>Importe a Maquinona para habilitar</TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );

  return (
    <AppLayout title="Auditoria de Taxas" subtitle="Conciliação Maquinona × Bancos">
      <div className="space-y-6">
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

        {/* Critical alert */}
        {criticalVouchers.length > 0 && (
          <Card className="border-red-500 bg-red-500/5">
            <CardContent className="py-3 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-sm">
                <p className="font-semibold text-red-700 dark:text-red-400">
                  🚨 ATENÇÃO: {criticalVouchers.map(v => COMPANY_LABELS[v.company]?.toUpperCase()).join(', ')} {criticalVouchers.length === 1 ? 'está retendo' : 'estão retendo'} acima do esperado
                </p>
                {criticalVouchers.map(v => (
                  <p key={v.company} className="text-muted-foreground mt-0.5">
                    <strong>{COMPANY_LABELS[v.company]}</strong>: {Number(v.effective_tax_rate).toFixed(1)}% · Esperado {formatCurrency(Number(v.sold_amount))} · Recebido {formatCurrency(Number(v.deposited_amount))} · Gap {formatCurrency(Number(v.difference))}
                  </p>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => navigate(`/admin/auditoria/voucher?period=${period?.id}`)}>
                Investigar
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
              {period && exportBtn}
              {period && contabilBtn}
              {period && (
                <Button
                  variant="outline"
                  className="gap-2"
                  disabled={!isConciliated && !isClosed}
                  onClick={() => navigate(`/admin/auditoria/match?period=${period.id}`)}
                >
                  <Search className="h-4 w-4" /> Auditar Match
                </Button>
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


        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard title="Vendido" value={formatCurrency(totals.vendido)} />
          <SummaryCard title="Recebido" value={formatCurrency(totals.recebido)} />
          <SummaryCard title="Custo" value={formatCurrency(custoReal)} />
          <SummaryCard title="Taxa efetiva" value={`${totals.taxaPct.toFixed(2).replace('.', ',')}%`} />
        </div>

        {/* iFood + Voucher detail entries */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">iFood</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {totals.liquidoIfood === 0 && depositRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Importe a Maquinona para ver o líquido esperado.</p>
              ) : (() => {
                const liquidoEsperado = totals.liquidoIfood;
                const recebidoMatched = ifoodMatched;
                const gap = recebidoMatched - liquidoEsperado;
                return (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Líquido esperado:</span><span className="font-medium">{formatCurrency(liquidoEsperado)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Recebido competência:</span><span className="font-medium">{formatCurrency(recebidoMatched)}</span></div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Gap real:</span>
                      <span className={`font-semibold ${gap < -0.5 ? 'text-red-600 dark:text-red-400' : gap > 0.5 ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>{formatCurrency(gap)}</span>
                    </div>
                    {(ifoodAdjacente > 0 || ifoodNaoId > 0) && (
                      <div className="pt-2 mt-1 border-t border-border/50 space-y-0.5 text-xs text-muted-foreground">
                        {ifoodAdjacente > 0 && (
                          <div className="flex justify-between">
                            <span>ℹ Recebido outras comp.:</span>
                            <span>{formatCurrency(ifoodAdjacente)}</span>
                          </div>
                        )}
                        {ifoodNaoId > 0 && (
                          <div className="flex justify-between">
                            <span>⚠ Não identificado:</span>
                            <span className="text-red-600 dark:text-red-400">{formatCurrency(ifoodNaoId)}</span>
                          </div>
                        )}
                        {ifoodAdjacente > 0 && (
                          <p className="italic pt-1">Parcelas de meses adjacentes (fev/abr) recebidas neste mês.</p>
                        )}
                      </div>
                    )}
                    {gap < -0.5 && (
                      <p className="text-xs text-muted-foreground italic pt-1">⚠ Gap negativo indica custo oculto (ex: taxa de antecipação iFood).</p>
                    )}
                  </div>
                );
              })()}
              <Button variant="ghost" size="sm" className="gap-1 text-primary" disabled={!canExport} onClick={() => navigate(`/admin/auditoria/ifood?period=${period?.id}`)}>
                Ver detalhes <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Vouchers (BB)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {voucherMatches.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conciliação executada.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {['alelo', 'ticket', 'pluxee', 'vr'].map(c => {
                    const v = voucherMatches.find(m => m.company === c);
                    if (!v) return <div key={c} className="rounded border p-2 opacity-50"><div className="font-semibold">{COMPANY_LABELS[c]}</div><div className="text-muted-foreground">—</div></div>;
                    const cls = v.status === 'critico' ? 'border-red-500 bg-red-500/5' : v.status === 'alerta' ? 'border-yellow-500/50 bg-yellow-500/5' : v.status === 'divergente' ? 'border-blue-500/50 bg-blue-500/5' : 'border-green-500/50 bg-green-500/5';
                    const matched = voucherDepBy(c, 'matched');
                    const fora = voucherDepBy(c, 'fora_periodo');
                    return (
                      <div key={c} className={`rounded border p-2 ${cls} space-y-0.5`}>
                        <div className="font-semibold">{COMPANY_LABELS[c]}</div>
                        <div>Matched: <strong>{formatCurrency(matched)}</strong></div>
                        {fora > 0 && <div className="text-muted-foreground">Fora: {formatCurrency(fora)}</div>}
                        <div className="text-muted-foreground uppercase">{v.status}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button variant="ghost" size="sm" className="gap-1 text-primary" disabled={!canExport} onClick={() => navigate(`/admin/auditoria/voucher?period=${period?.id}`)}>
                Ver detalhes <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Imports — bloco unificado v4 (vw_period_imports) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Importações do período</CardTitle>
            <p className="text-xs text-muted-foreground">
              7 fontes: Maquinona + Cresol + Banco do Brasil + 4 extratos das operadoras de voucher.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              💡 <strong>Para auditoria precisa, importe 3 meses</strong> de cada fonte: mês ANTERIOR + mês de COMPETÊNCIA + mês POSTERIOR.
              Selecione múltiplos arquivos no botão "Importar" — eles são processados em sequência.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {isClosed && (
              <p className="text-xs text-muted-foreground italic">Este período está fechado. Para importar novos arquivos, reabra o período.</p>
            )}
            {SOURCE_GROUPS.map(group => (
              <div key={group.label} className="space-y-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{group.label}</p>
                {group.sources.map(src => {
                  const rowsForSource = allImports.filter(i => i.source === src && i.status === 'completed');
                  const latest = rowsForSource[0];
                  const totalRows = rowsForSource.reduce((s, i) => s + Number(i.imported_rows || 0), 0);
                  const fileCount = rowsForSource.length;
                  const isCompleted = fileCount > 0;
                  const isUploading = uploadingSource === src;
                  const inputId = `upload-input-${src}`;

                  return (
                    <div key={src} className="flex items-center justify-between rounded-md border bg-card px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium">{FILE_LABELS[src]}</span>
                        {isCompleted && latest ? (
                          <Badge variant="secondary" className="bg-green-500/15 text-green-700 dark:text-green-400 truncate">
                            ✓ {fileCount} {fileCount === 1 ? 'arquivo' : 'arquivos'} · último {formatDateTime(latest.created_at)} ({totalRows} linhas)
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-muted text-muted-foreground">não importado</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          id={inputId}
                          type="file"
                          multiple
                          accept={ACCEPT_BY_SOURCE[src]}
                          className="hidden"
                          onChange={(e) => {
                            const files = e.target.files;
                            handleUpload(src, files);
                            e.currentTarget.value = '';
                          }}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!period || isClosed || isUploading}
                          className="gap-1.5"
                          onClick={() => document.getElementById(inputId)?.click()}
                        >
                          {isUploading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <UploadCloud className="h-3.5 w-3.5" />
                          )}
                          {isUploading ? 'Importando...' : (isCompleted ? 'Re-importar' : 'Importar')}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {!period && (<p className="text-xs text-muted-foreground pt-1">Crie o período acima antes de importar arquivos.</p>)}
          </CardContent>
        </Card>


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
