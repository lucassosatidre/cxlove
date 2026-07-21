// Contas a pagar da Controladoria — lê e grava direto em ctrl_contas_pagar.
// Mesma experiência de LancamentosFinanceiros, sem Saipos.
import { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { TagCombobox } from '@/components/cashflow/TagCombobox';
import { MultiSelectFilter } from '@/components/cashflow/MultiSelectFilter';


type DateKind = 'emissao' | 'vencimento' | 'pagamento';
type StatusFilter = 'todas' | 'pagas' | 'nao_pagas';
type TipoFilter = 'saidas' | 'entradas' | 'todos';
type OrderDir = 'asc' | 'desc';

type OptionKind = 'categoria' | 'metodo' | 'conta' | 'fornecedor' | 'descricao';
type OptionsMap = Record<OptionKind, string[]>;
const EMPTY_OPTIONS: OptionsMap = { categoria: [], metodo: [], conta: [], fornecedor: [], descricao: [] };

type Row = {
  id: string;
  emissao: string | null;
  vencimento: string | null;
  pagamento: string | null;
  paid: boolean;
  amount: number;
  category: string | null;
  payment_method: string | null;
  conta: string | null;
  fornecedor: string | null;
  descricao: string | null;
  numero_nota: string | null;
  nota_chave: string | null;
  source: string;
};


const METODOS = [
  'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto', 'Dinheiro',
  'Débito Automático', 'Tarifas Bancárias', 'Transferência', 'Não informado',
];

const TAG_PALETTE = [
  'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
];
function tagColorClass(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[h % TAG_PALETTE.length];
}
function uniqSort(list: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of list) {
    const t = (v ?? '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (!seen.has(k)) seen.set(k, t);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
function uniqKeepOrder(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    const t = (v ?? '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
function fmtBRL(v: number | null | undefined) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const [y, m, d] = v.split('-');
  return `${d}/${m}/${y}`;
}
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseISO(v: string): Date {
  const [y, m, d] = v.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function firstOfMonth() { const d = new Date(); return toISO(new Date(d.getFullYear(), d.getMonth(), 1)); }
function lastOfMonth() { const d = new Date(); return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }

function DatePickerField({
  value, onChange, placeholder = 'Selecionar',
}: { value: string | null; onChange: (v: string | null) => void; placeholder?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('justify-start text-left font-normal w-full', !value && 'text-muted-foreground')}>
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? format(parseISO(value), 'dd/MM/yyyy', { locale: ptBR }) : <span>{placeholder}</span>}
          {value && (
            <X className="ml-auto h-3 w-3 opacity-50 hover:opacity-100" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onChange(null); }} />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={value ? parseISO(value) : undefined} onSelect={(d) => onChange(d ? toISO(d) : null)} initialFocus className={cn('p-3 pointer-events-auto')} />
      </PopoverContent>
    </Popover>
  );
}

export type SavePayload = {
  emissao: string | null;
  vencimento: string | null;
  pagamento: string | null;
  paid: boolean;
  amount: number;
  category: string | null;
  payment_method: string | null;
  conta: string | null;
  fornecedor: string | null;
  descricao: string | null;
};

function LancamentoDialog({
  open, onOpenChange, row, options, onAddOption, onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: Row | null;
  options: OptionsMap;
  onAddOption: (kind: OptionKind, value: string) => Promise<void>;
  onSubmit: (payload: SavePayload, isNew: boolean, row: Row | null) => Promise<boolean>;
}) {
  const isNew = row === null;
  const [emissao, setEmissao] = useState<string | null>(null);
  const [vencimento, setVencimento] = useState<string | null>(null);
  const [pagamento, setPagamento] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [amountStr, setAmountStr] = useState('');
  const [categoria, setCategoria] = useState('');
  const [metodo, setMetodo] = useState('');
  const [conta, setConta] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [tipoNovo, setTipoNovo] = useState<'saida' | 'entrada'>('saida');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (row) {
      setEmissao(row.emissao);
      setVencimento(row.vencimento);
      setPagamento(row.pagamento);
      setPaid(!!row.paid);
      setAmountStr(String(Math.abs(Number(row.amount ?? 0))).replace('.', ','));
      setCategoria(row.category ?? '');
      setMetodo(row.payment_method ?? '');
      setConta(row.conta ?? '');
      setFornecedor(row.fornecedor ?? '');
      setDescricao(row.descricao ?? '');
      setTipoNovo(Number(row.amount ?? 0) >= 0 ? 'entrada' : 'saida');
    } else {
      setEmissao(todayISO()); setVencimento(null); setPagamento(null); setPaid(false);
      setAmountStr(''); setCategoria(''); setMetodo(''); setConta('');
      setFornecedor(''); setDescricao(''); setTipoNovo('saida');
    }
  }, [open, row]);

  async function handleSave() {
    const amountNum = Number(String(amountStr).replace(/\./g, '').replace(',', '.'));
    if (!isFinite(amountNum) || amountNum === 0) { toast.error('Valor inválido'); return; }
    if (isNew && !emissao) { toast.error('Emissão é obrigatória'); return; }
    setSaving(true);
    try {
      const signed = tipoNovo === 'saida' ? -Math.abs(amountNum) : Math.abs(amountNum);
      const payload: SavePayload = {
        emissao, vencimento, pagamento, paid,
        amount: signed,
        category: categoria || null,
        payment_method: metodo || null,
        conta: conta || null,
        fornecedor: fornecedor || null,
        descricao: descricao || null,
      };
      const ok = await onSubmit(payload, isNew, row);
      if (ok) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Novo lançamento' : 'Editar lançamento'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipoNovo} onValueChange={(v) => setTipoNovo(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="saida">Saída (conta a pagar)</SelectItem>
                <SelectItem value="entrada">Entrada (recebimento)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Emissão {isNew && '*'}</Label><DatePickerField value={emissao} onChange={setEmissao} /></div>
          <div><Label className="text-xs">Vencimento</Label><DatePickerField value={vencimento} onChange={setVencimento} /></div>
          <div><Label className="text-xs">Pagamento</Label><DatePickerField value={pagamento} onChange={setPagamento} /></div>
          <div>
            <Label className="text-xs">Valor (R$)</Label>
            <Input inputMode="decimal" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} placeholder="0,00" />
          </div>
          <div><Label className="text-xs">Categoria</Label><TagCombobox value={categoria} onChange={setCategoria} options={options.categoria} onCreate={(v) => onAddOption('categoria', v)} placeholder="Escolher ou criar" /></div>
          <div><Label className="text-xs">Método</Label><TagCombobox value={metodo} onChange={setMetodo} options={options.metodo} onCreate={(v) => onAddOption('metodo', v)} placeholder="Escolher ou criar" /></div>
          <div><Label className="text-xs">Conta / Banco</Label><TagCombobox value={conta} onChange={setConta} options={options.conta} onCreate={(v) => onAddOption('conta', v)} placeholder="Escolher ou criar" /></div>
          <div><Label className="text-xs">Fornecedor</Label><TagCombobox value={fornecedor} onChange={setFornecedor} options={options.fornecedor} onCreate={(v) => onAddOption('fornecedor', v)} placeholder="Escolher ou criar" /></div>
          <div className="md:col-span-2"><Label className="text-xs">Descrição</Label><TagCombobox value={descricao} onChange={setDescricao} options={options.descricao} onCreate={(v) => onAddOption('descricao', v)} placeholder="Escolher ou criar" /></div>
          <div className="md:col-span-2 flex items-center gap-3">
            <Switch checked={paid} onCheckedChange={setPaid} id="ctrl-paid" />
            <Label htmlFor="ctrl-paid" className="text-sm">Marcar como pago</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


export default function ControladoriaContasPagar() {
  const qc = useQueryClient();

  const [dateKind, setDateKind] = useState<DateKind>('vencimento');
  const [dateStart, setDateStart] = useState<string>(firstOfMonth());
  const [dateEnd, setDateEnd] = useState<string>(lastOfMonth());
  const [status, setStatus] = useState<StatusFilter>('nao_pagas');
  const [conta, setConta] = useState<string[]>([]);
  const [metodo, setMetodo] = useState<string[]>([]);
  const [categoria, setCategoria] = useState<string[]>([]);
  const [tipoFilter, setTipoFilter] = useState<TipoFilter>('saidas');
  const [orderBy, setOrderBy] = useState<DateKind>('vencimento');
  const [orderDir, setOrderDir] = useState<OrderDir>('asc');
  const [busca, setBusca] = useState('');

  const [editRow, setEditRow] = useState<Row | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [payingKey, setPayingKey] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['ctrl_contas_pagar', { dateKind, dateStart, dateEnd, status, conta, metodo, categoria, tipoFilter, orderBy, orderDir }],
    queryFn: async () => {
      let q = (supabase as any)
        .from('ctrl_contas_pagar')
        .select('id,emissao,vencimento,pagamento,paid,amount,category,payment_method,conta,fornecedor,descricao,numero_nota,source')
        .order(orderBy, { ascending: orderDir === 'asc', nullsFirst: false })
        .limit(5000);
      if (dateStart) q = q.gte(dateKind, dateStart);
      if (dateEnd) q = q.lte(dateKind, dateEnd);
      if (status === 'pagas') q = q.eq('paid', true);
      if (status === 'nao_pagas') q = q.eq('paid', false);
      if (conta.length > 0) q = q.in('conta', conta);
      if (metodo.length > 0) q = q.in('payment_method', metodo);
      if (categoria.length > 0) q = q.in('category', categoria);
      if (tipoFilter === 'saidas') q = q.lt('amount', 0);
      if (tipoFilter === 'entradas') q = q.gte('amount', 0);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const distincts = useQuery({
    queryKey: ['ctrl_contas_pagar_distincts'],
    queryFn: async () => {
      const since = new Date(); since.setMonth(since.getMonth() - 12);
      const { data, error } = await (supabase as any)
        .from('ctrl_contas_pagar')
        .select('conta,category,fornecedor,payment_method')
        .gte('emissao', toISO(since))
        .limit(20000);
      if (error) throw error;
      const contas = uniqSort(((data ?? []) as any[]).map(r => r.conta).filter(Boolean));
      const categorias = uniqSort(((data ?? []) as any[]).map(r => r.category).filter(Boolean));
      const fornecedores = uniqSort(((data ?? []) as any[]).map(r => r.fornecedor).filter(Boolean));
      const metodos = uniqSort(((data ?? []) as any[]).map(r => r.payment_method).filter(Boolean));
      return { contas, categorias, fornecedores, metodos };
    },
    staleTime: 5 * 60 * 1000,
  });

  const optionsQuery = useQuery({
    queryKey: ['cashflow_options'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('cashflow_options').select('kind,value').order('value');
      if (error) throw error;
      const grouped: OptionsMap = { categoria: [], metodo: [], conta: [], fornecedor: [], descricao: [] };
      for (const r of (data ?? []) as { kind: OptionKind; value: string }[]) {
        if (grouped[r.kind]) grouped[r.kind].push(r.value);
      }
      return grouped;
    },
    staleTime: 5 * 60 * 1000,
  });

  async function addOption(kind: OptionKind, value: string) {
    const v = value.trim();
    if (!v) return;
    const { data: userRes } = await supabase.auth.getUser();
    const { error } = await (supabase as any)
      .from('cashflow_options')
      .insert({ kind, value: v, created_by: userRes?.user?.id ?? null });
    if (error && !/duplicate|unique/i.test(error.message ?? '')) {
      toast.error(`Erro ao criar opção: ${error.message}`);
      throw error;
    }
    await qc.invalidateQueries({ queryKey: ['cashflow_options'] });
  }

  const rows = useMemo(() => {
    const all = query.data ?? [];
    const q = busca.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => `${r.fornecedor ?? ''} ${r.descricao ?? ''}`.toLowerCase().includes(q));
  }, [query.data, busca]);

  const totais = useMemo(() => {
    let total = 0, pago = 0, aberto = 0;
    for (const r of rows) {
      const v = Math.abs(Number(r.amount ?? 0));
      total += v;
      if (r.paid) pago += v; else aberto += v;
    }
    return { total, pago, aberto, n: rows.length };
  }, [rows]);

  const hojeISO = todayISO();
  const isVencida = (r: Row) => !r.paid && r.vencimento && r.vencimento < hojeISO;

  async function markPaid(r: Row) {
    setPayingKey(r.id);
    try {
      const pgto = r.pagamento ?? todayISO();
      const { error } = await (supabase as any)
        .from('ctrl_contas_pagar')
        .update({ paid: true, pagamento: pgto })
        .eq('id', r.id);
      if (error) throw error;
      toast.success('Marcado como pago');
      refetch();
    } catch (err: any) {
      toast.error(`Erro: ${err?.message || err}`);
    } finally {
      setPayingKey(null);
    }
  }

  function clearFilters() {
    setDateKind('vencimento'); setDateStart(firstOfMonth()); setDateEnd(lastOfMonth());
    setStatus('nao_pagas'); setConta([]); setMetodo([]); setCategoria([]);
    setTipoFilter('saidas'); setOrderBy('vencimento'); setOrderDir('asc'); setBusca('');
  }
  function refetch() {
    qc.invalidateQueries({ queryKey: ['ctrl_contas_pagar'] });
    qc.invalidateQueries({ queryKey: ['ctrl_contas_pagar_distincts'] });
  }

  const dbOpts = optionsQuery.data ?? EMPTY_OPTIONS;
  const categoriasAll = useMemo(() => uniqSort([...(distincts.data?.categorias ?? []), ...dbOpts.categoria]), [distincts.data?.categorias, dbOpts.categoria]);
  const contasAll = useMemo(() => uniqSort([...(distincts.data?.contas ?? []), ...dbOpts.conta]), [distincts.data?.contas, dbOpts.conta]);
  const metodosAll = useMemo(() => uniqKeepOrder([...METODOS, ...(distincts.data?.metodos ?? []), ...dbOpts.metodo]), [distincts.data?.metodos, dbOpts.metodo]);
  const fornecedoresAll = useMemo(() => uniqSort([...(distincts.data?.fornecedores ?? []), ...dbOpts.fornecedor]), [distincts.data?.fornecedores, dbOpts.fornecedor]);
  const descricoesAll = useMemo(() => uniqSort([...dbOpts.descricao]), [dbOpts.descricao]);

  const optionsMap: OptionsMap = useMemo(() => ({
    categoria: categoriasAll, metodo: metodosAll, conta: contasAll,
    fornecedor: fornecedoresAll, descricao: descricoesAll,
  }), [categoriasAll, metodosAll, contasAll, fornecedoresAll, descricoesAll]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Contas a pagar — Controladoria</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Lançamentos gerados a partir da conciliação de notas + entradas manuais.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refetch} disabled={query.isFetching}>Atualizar</Button>
          <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4 mr-1" /> Novo lançamento</Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <Label className="text-xs">Tipo de data (filtro)</Label>
            <Select value={dateKind} onValueChange={(v) => setDateKind(v as DateKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="emissao">Emissão</SelectItem>
                <SelectItem value="vencimento">Vencimento</SelectItem>
                <SelectItem value="pagamento">Pagamento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">De</Label><DatePickerField value={dateStart} onChange={(v) => setDateStart(v ?? '')} /></div>
          <div><Label className="text-xs">Até</Label><DatePickerField value={dateEnd} onChange={(v) => setDateEnd(v ?? '')} /></div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="pagas">Pagas</SelectItem>
                <SelectItem value="nao_pagas">Não pagas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div><Label className="text-xs">Conta</Label><MultiSelectFilter values={conta} onChange={setConta} options={contasAll} allLabel="Todas" /></div>
          <div><Label className="text-xs">Método</Label><MultiSelectFilter values={metodo} onChange={setMetodo} options={metodosAll} allLabel="Todos" /></div>
          <div><Label className="text-xs">Categoria</Label><MultiSelectFilter values={categoria} onChange={setCategoria} options={categoriasAll} allLabel="Todas" /></div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={tipoFilter} onValueChange={(v) => setTipoFilter(v as TipoFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="saidas">Saídas</SelectItem>
                <SelectItem value="entradas">Entradas</SelectItem>
                <SelectItem value="todos">Tudo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Ordenar por</Label>
            <Select value={orderBy} onValueChange={(v) => setOrderBy(v as DateKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="emissao">Emissão</SelectItem>
                <SelectItem value="vencimento">Vencimento</SelectItem>
                <SelectItem value="pagamento">Pagamento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Ordem</Label>
            <Select value={orderDir} onValueChange={(v) => setOrderDir(v as OrderDir)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">Crescente</SelectItem>
                <SelectItem value="desc">Decrescente</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Busca (fornecedor ou descrição)</Label>
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={clearFilters} className="w-full">Limpar filtros</Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Total filtrado</div>
            <div className="font-mono text-lg font-semibold">{fmtBRL(totais.total)}</div>
            <div className="text-[11px] text-muted-foreground">{totais.n} lançamento(s)</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Pago</div>
            <div className="font-mono text-lg font-semibold text-emerald-600 dark:text-emerald-400">{fmtBRL(totais.pago)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Em aberto</div>
            <div className="font-mono text-lg font-semibold text-destructive">{fmtBRL(totais.aberto)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Período</div>
            <div className="text-sm font-medium">{fmtDate(dateStart)} → {fmtDate(dateEnd)}</div>
            <div className="text-[11px] text-muted-foreground capitalize">por {dateKind}</div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-border">
          <Table className="w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Emissão</TableHead>
                <TableHead className="whitespace-nowrap">Vencimento</TableHead>
                <TableHead className="whitespace-nowrap">Pagamento</TableHead>
                <TableHead className="min-w-[220px]">Fornecedor / Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Método</TableHead>
                <TableHead>Banco</TableHead>
                <TableHead className="text-right whitespace-nowrap">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Carregando…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Nenhum lançamento encontrado.</TableCell></TableRow>
              ) : rows.map((r) => {
                const vencida = isVencida(r);
                const isSaida = Number(r.amount ?? 0) < 0;
                const linha = r.numero_nota
                  ? `${r.source === 'nfse' ? 'NFS-e' : r.source === 'nfe' ? 'NF-e' : ''} ${r.numero_nota} ${r.fornecedor ?? ''}`.trim()
                  : [r.fornecedor, r.descricao].map((s) => (s ?? '').trim()).filter(Boolean).join(' — ') || '—';
                return (
                  <TableRow key={r.id} className={cn(vencida && 'bg-destructive/5 hover:bg-destructive/10')}>
                    <TableCell className="text-xs whitespace-nowrap align-top">{fmtDate(r.emissao)}</TableCell>
                    <TableCell className={cn('text-xs whitespace-nowrap align-top', vencida && 'text-destructive font-medium')}>{fmtDate(r.vencimento)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap align-top">{fmtDate(r.pagamento)}</TableCell>
                    <TableCell className="text-sm align-top">
                      <div className="whitespace-normal break-words">{linha}</div>
                    </TableCell>
                    <TableCell className="align-top">
                      {r.category ? (
                        <span className={cn('inline-block rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-normal break-words', tagColorClass(r.category))}>
                          {r.category}
                        </span>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs align-top whitespace-normal break-words">{r.payment_method || '—'}</TableCell>
                    <TableCell className="text-xs align-top whitespace-normal break-words">{r.conta || '—'}</TableCell>
                    <TableCell className={cn('text-right font-mono text-sm whitespace-nowrap align-top', isSaida && 'text-destructive')}>
                      {isSaida ? '- ' : ''}{fmtBRL(Math.abs(Number(r.amount ?? 0)))}
                    </TableCell>
                    <TableCell className="align-top">
                      {r.paid ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">Pago</Badge>
                      ) : (
                        <Button
                          size="sm" variant="outline"
                          className="h-7 px-2 text-xs border-emerald-600/40 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10 whitespace-nowrap"
                          onClick={() => markPaid(r)}
                          disabled={payingKey === r.id}
                        >
                          {payingKey === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="h-3 w-3 mr-1" /> Marcar pago</>}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <Button variant="ghost" size="icon" onClick={() => { setEditRow(r); setDialogOpen(true); }} title="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <LancamentoDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditRow(null); }}
        row={editRow}
        options={optionsMap}
        onAddOption={addOption}
        onSaved={refetch}
      />
      <LancamentoDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        row={null}
        options={optionsMap}
        onAddOption={addOption}
        onSaved={refetch}
      />
    </Card>
  );
}
