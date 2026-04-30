import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import {
  ArrowLeft, ChevronDown, ChevronRight, FileSpreadsheet, FileText, Landmark, Loader2, UploadCloud,
} from 'lucide-react';
import { extractPdfText } from '@/lib/pdf-text-extract';

type AuditPeriod = { id: string; month: number; year: number; status: string };

type AuditImport = {
  id: string;
  file_type: string;
  file_name: string;
  status: string;
  imported_rows: number;
  total_rows: number;
  created_at: string;
  error_message?: string | null;
};

type Lot = {
  id: string;
  operadora: string;
  numero_reembolso: string;
  numero_contrato: string | null;
  produto: string | null;
  data_corte: string | null;
  data_credito: string;
  subtotal_vendas: number;
  total_descontos: number;
  valor_liquido: number;
  descontos: Record<string, number> | null;
  bb_deposit_id: string | null;
  status: string;
  manual: boolean;
};

type LotItem = {
  id: string;
  lot_id: string;
  data_transacao: string;
  data_postagem: string | null;
  numero_documento: string | null;
  numero_cartao_mascarado: string | null;
  valor: number;
};

type BankDeposit = {
  id: string;
  deposit_date: string;
  description: string | null;
  detail: string | null;
  category: string | null;
  amount: number;
};

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const DISCOUNT_LABELS: Record<string, string> = {
  tarifa_gestao: 'Tarifa de gestão',
  tarifa_transacao: 'Tarifa por transação',
  taxa_tpe: 'Taxa TPE',
  anuidade: 'Anuidade',
  outros: 'Outros',
};

const CATEGORY_LABELS: Record<string, string> = {
  ticket: 'Ticket',
  alelo: 'Alelo',
  pluxee: 'Pluxee',
  vr: 'VR',
  brendi: 'Brendi',
  outro: 'Outro',
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (iso: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export default function AuditVouchers() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, loading: roleLoading } = useUserRole();

  const now = new Date();
  const [month, setMonth] = useState<number>(Number(searchParams.get('month')) || now.getMonth() + 1);
  const [year, setYear] = useState<number>(Number(searchParams.get('year')) || now.getFullYear());

  const [period, setPeriod] = useState<AuditPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [lots, setLots] = useState<Lot[]>([]);
  const [imports, setImports] = useState<AuditImport[]>([]);
  const [deposits, setDeposits] = useState<BankDeposit[]>([]);
  const [expandedLot, setExpandedLot] = useState<string | null>(null);
  const [itemsByLot, setItemsByLot] = useState<Record<string, LotItem[]>>({});
  const [categoryFilter, setCategoryFilter] = useState<string>('ticket');

  const refresh = async (periodId: string) => {
    const [lotsRes, importsRes, depRes] = await Promise.all([
      supabase
        .from('audit_voucher_lots')
        .select('id, operadora, numero_reembolso, numero_contrato, produto, data_corte, data_credito, subtotal_vendas, total_descontos, valor_liquido, descontos, bb_deposit_id, status, manual')
        .eq('audit_period_id', periodId)
        .order('data_credito', { ascending: true }),
      supabase
        .from('audit_imports')
        .select('id, file_type, file_name, status, imported_rows, total_rows, created_at, error_message')
        .eq('audit_period_id', periodId)
        .in('file_type', ['bb', 'ticket', 'alelo', 'pluxee', 'vr'])
        .order('created_at', { ascending: false }),
      supabase
        .from('audit_bank_deposits')
        .select('id, deposit_date, description, detail, category, amount')
        .eq('audit_period_id', periodId)
        .eq('bank', 'bb')
        .order('deposit_date', { ascending: true }),
    ]);
    setLots((lotsRes.data ?? []) as Lot[]);
    setImports((importsRes.data ?? []) as AuditImport[]);
    setDeposits((depRes.data ?? []) as BankDeposit[]);
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
      else { setLots([]); setImports([]); setDeposits([]); }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isAdmin, month, year]);

  // Sincroniza search params
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('month', String(month));
    next.set('year', String(year));
    setSearchParams(next, { replace: true });
  }, [month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadItems = async (lotId: string) => {
    if (itemsByLot[lotId]) {
      setExpandedLot(expandedLot === lotId ? null : lotId);
      return;
    }
    const { data } = await supabase
      .from('audit_voucher_lot_items')
      .select('id, lot_id, data_transacao, data_postagem, numero_documento, numero_cartao_mascarado, valor')
      .eq('lot_id', lotId)
      .order('data_transacao', { ascending: true });
    setItemsByLot(s => ({ ...s, [lotId]: (data ?? []) as LotItem[] }));
    setExpandedLot(lotId);
  };

  // Cria período se não existir
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

  const ticketLots = useMemo(() => lots.filter(l => l.operadora === 'ticket'), [lots]);
  const ticketStats = useMemo(() => {
    const subtotal = ticketLots.reduce((s, l) => s + Number(l.subtotal_vendas), 0);
    const descontos = ticketLots.reduce((s, l) => s + Number(l.total_descontos), 0);
    const liquido = ticketLots.reduce((s, l) => s + Number(l.valor_liquido), 0);
    const matched = ticketLots.filter(l => l.bb_deposit_id).length;
    return { count: ticketLots.length, subtotal, descontos, liquido, matched };
  }, [ticketLots]);

  const filteredDeposits = useMemo(() => {
    if (categoryFilter === 'todos') return deposits;
    return deposits.filter(d => d.category === categoryFilter);
  }, [deposits, categoryFilter]);

  if (roleLoading || loading) {
    return (
      <AppLayout title="Vouchers" subtitle="Auditoria de Taxas (Estágio 2)">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="Vouchers">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito a administradores.</CardContent></Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Vouchers" subtitle="Auditoria de Taxas (Estágio 2)">
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink onClick={() => navigate('/admin/auditoria')} className="cursor-pointer">
                Auditoria
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Vouchers</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 text-sm">
            <strong>Em construção (Estágio 2).</strong> Esta aba é independente da auditoria iFood/Cresol.
            Por enquanto apenas <strong>Ticket</strong> está habilitado. Match BB ↔ lote ainda não conectado.
          </CardContent>
        </Card>

        {/* Seletor de período */}
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
              <Badge variant="secondary">Sem período (será criado no primeiro upload)</Badge>
            )}
          </CardContent>
        </Card>

        {/* Cards de upload */}
        <div className="grid gap-4 md:grid-cols-2">
          <UploadBBCard period={period} ensurePeriod={ensurePeriod} onAfter={() => period && refresh(period.id)} />
          <UploadTicketCard period={period} ensurePeriod={ensurePeriod} onAfter={() => period && refresh(period.id)} />
        </div>

        {/* Stats Ticket */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Ticket — Lotes do período</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-5 mb-4 text-sm">
              <Stat label="Lotes" value={String(ticketStats.count)} />
              <Stat label="Subtotal vendas" value={fmt(ticketStats.subtotal)} />
              <Stat label="Total descontos" value={fmt(ticketStats.descontos)} className="text-amber-700 dark:text-amber-400" />
              <Stat label="Valor líquido" value={fmt(ticketStats.liquido)} className="text-emerald-700 dark:text-emerald-400" />
              <Stat label="Pareados c/ BB" value={`${ticketStats.matched} / ${ticketStats.count}`} />
            </div>

            {ticketLots.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nenhum lote Ticket importado neste período.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Reembolso</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Corte</TableHead>
                    <TableHead>Crédito BB</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead className="text-right">Descontos</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead>Match BB</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ticketLots.map(l => {
                    const expanded = expandedLot === l.id;
                    return (
                      <Fragment key={l.id}>
                        <TableRow className="cursor-pointer hover:bg-muted/30" onClick={() => loadItems(l.id)}>
                          <TableCell>
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{l.numero_reembolso}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono">{l.produto ?? '—'}</Badge>
                          </TableCell>
                          <TableCell>{fmtDate(l.data_corte)}</TableCell>
                          <TableCell>{fmtDate(l.data_credito)}</TableCell>
                          <TableCell className="text-right">{fmt(Number(l.subtotal_vendas))}</TableCell>
                          <TableCell className="text-right text-amber-700 dark:text-amber-400">{fmt(Number(l.total_descontos))}</TableCell>
                          <TableCell className="text-right font-medium">{fmt(Number(l.valor_liquido))}</TableCell>
                          <TableCell>
                            {l.bb_deposit_id ? (
                              <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">✓ Pareado</Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">Pendente</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={9} className="p-0">
                              <LotDetail lot={l} items={itemsByLot[l.id] ?? []} />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Depósitos BB */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 flex-wrap space-y-0">
            <CardTitle className="text-base">Depósitos BB</CardTitle>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas categorias</SelectItem>
                <SelectItem value="ticket">Ticket</SelectItem>
                <SelectItem value="alelo">Alelo</SelectItem>
                <SelectItem value="pluxee">Pluxee</SelectItem>
                <SelectItem value="vr">VR</SelectItem>
                <SelectItem value="brendi">Brendi</SelectItem>
                <SelectItem value="outro">Outros</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {filteredDeposits.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nenhum depósito BB nesta categoria.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Detalhe</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeposits.map(d => (
                    <TableRow key={d.id}>
                      <TableCell>{fmtDate(d.deposit_date)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{d.category ? (CATEGORY_LABELS[d.category] ?? d.category) : '—'}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs">{d.description ?? '—'}</TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">{d.detail ?? '—'}</TableCell>
                      <TableCell className="text-right font-medium">{fmt(Number(d.amount))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Histórico de imports */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Histórico de imports</CardTitle></CardHeader>
          <CardContent>
            {imports.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Sem imports voucher neste período.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Linhas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imports.map(i => (
                    <TableRow key={i.id}>
                      <TableCell>{fmtDateTime(i.created_at)}</TableCell>
                      <TableCell><Badge variant="outline">{i.file_type}</Badge></TableCell>
                      <TableCell className="max-w-[300px] truncate text-xs">{i.file_name}</TableCell>
                      <TableCell>
                        {i.status === 'completed' ? (
                          <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">completed</Badge>
                        ) : i.status === 'error' ? (
                          <Badge variant="destructive">error</Badge>
                        ) : (
                          <Badge variant="outline">{i.status}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {i.imported_rows} / {i.total_rows}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`text-base font-semibold ${className ?? ''}`}>{value}</div>
    </div>
  );
}

function LotDetail({ lot, items }: { lot: Lot; items: LotItem[] }) {
  const descontos = lot.descontos ?? {};
  const descKeys = Object.keys(descontos);
  return (
    <div className="px-4 py-3 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="text-xs uppercase text-muted-foreground mb-1">Vendas do lote ({items.length})</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Doc</TableHead>
                <TableHead>Cartão</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(it => (
                <TableRow key={it.id}>
                  <TableCell className="text-xs">{fmtDate(it.data_transacao)}</TableCell>
                  <TableCell className="font-mono text-xs">{it.numero_documento ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{it.numero_cartao_mascarado ?? '—'}</TableCell>
                  <TableCell className="text-right text-xs">{fmt(Number(it.valor))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div>
          <div className="text-xs uppercase text-muted-foreground mb-1">Descontos</div>
          {descKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem descontos detalhados.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {descKeys.map(k => (
                  <TableRow key={k}>
                    <TableCell className="text-xs">{DISCOUNT_LABELS[k] ?? k}</TableCell>
                    <TableCell className="text-right text-xs text-amber-700 dark:text-amber-400">
                      {fmt(Number(descontos[k]))}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="text-xs font-semibold">Total</TableCell>
                  <TableCell className="text-right text-xs font-semibold text-amber-700 dark:text-amber-400">
                    {fmt(Number(lot.total_descontos))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border px-2 py-1">
              <div className="text-muted-foreground">Contrato</div>
              <div className="font-mono">{lot.numero_contrato ?? '—'}</div>
            </div>
            <div className="rounded border px-2 py-1">
              <div className="text-muted-foreground">Líquido</div>
              <div className="font-semibold text-emerald-700 dark:text-emerald-400">{fmt(Number(lot.valor_liquido))}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// Cards de upload
// =====================================================

function UploadBBCard({
  period, ensurePeriod, onAfter,
}: {
  period: AuditPeriod | null;
  ensurePeriod: () => Promise<AuditPeriod | null>;
  onAfter: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.error('Apenas .xlsx é aceito');
      return;
    }
    setUploading(true);
    try {
      const p = await ensurePeriod();
      if (!p) return;

      const buf = await file.arrayBuffer();
      const workbook = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error('Arquivo sem abas');
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
      if (!rows.length) throw new Error('Arquivo vazio');

      const { data, error } = await supabase.functions.invoke('import-bb', {
        body: { audit_period_id: p.id, rows, file_name: file.name },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Falha na importação');

      toast.success(data.message ?? `${data.imported_rows} créditos importados`, {
        description: `Categorias: ${Object.entries(data.breakdown_by_category ?? {})
          .filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k}=${n}`).join(', ') || '—'}`,
      });
      await onAfter();
    } catch (e: any) {
      toast.error('Erro no import BB', { description: e?.message ?? 'Erro inesperado' });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <Landmark className="h-5 w-5 text-blue-600" />
        <CardTitle className="text-base">Extrato BB (.xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Extrato Banco do Brasil — depósitos voucher categorizados automaticamente
          por descrição (alelo / ticket / pluxee / vr / brendi / outros).
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <Button
          variant="default"
          className="gap-2"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading ? 'Importando…' : 'Selecionar XLSX'}
        </Button>
      </CardContent>
    </Card>
  );
}

function UploadTicketCard({
  period, ensurePeriod, onAfter,
}: {
  period: AuditPeriod | null;
  ensurePeriod: () => Promise<AuditPeriod | null>;
  onAfter: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Apenas .pdf é aceito');
      return;
    }
    setUploading(true);
    try {
      const p = await ensurePeriod();
      if (!p) return;

      const rawText = await extractPdfText(file);

      const { data, error } = await supabase.functions.invoke('import-ticket-pdf', {
        body: { audit_period_id: p.id, file_name: file.name, raw_text: rawText },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Falha no import Ticket');

      const integrity = (data.integrity_errors ?? []) as string[];
      const warnings = (data.warnings ?? []) as string[];
      toast.success(data.message, {
        description: integrity.length > 0
          ? `⚠ ${integrity.length} divergências de integridade. Veja console.`
          : warnings.length > 0
            ? `${warnings.length} warnings (não crítico)`
            : 'Sem divergências',
      });
      if (integrity.length > 0) console.warn('Integrity:', integrity);
      if (warnings.length > 0) console.info('Warnings:', warnings);
      await onAfter();
    } catch (e: any) {
      toast.error('Erro no import Ticket', { description: e?.message ?? 'Erro inesperado' });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <FileText className="h-5 w-5 text-amber-600" />
        <CardTitle className="text-base">Reembolsos Ticket (.pdf)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          PDF "Extrato de Reembolsos Detalhado" do portal Ticket Edenred.
          Cada Nº Reembolso vira 1 lote = 1 depósito esperado no BB.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        <Button
          variant="default"
          className="gap-2"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading ? 'Importando…' : 'Selecionar PDF'}
        </Button>
      </CardContent>
    </Card>
  );
}
