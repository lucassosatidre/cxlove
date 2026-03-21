import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CalendarDays, Store, Bike, ChevronRight, CheckCircle2, Clock, Vault,
  CalendarIcon, Plus, ArrowUpCircle, ArrowDownCircle, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import CashExpectationDialog from '@/components/CashExpectationDialog';

// ── Types ──────────────────────────────────────────────

interface ClosingRow {
  id: string;
  closing_date: string;
  status: string;
  reconciliation_status: string;
}

interface DayEntry {
  date: string;
  tele: ClosingRow | null;
  salon: ClosingRow | null;
}

interface VaultClosing {
  id: string;
  closing_date: string;
  change_salon: number;
  change_tele: number;
  vault_entry: number;
  vault_entry_description: string | null;
  vault_exit: number;
  vault_exit_description: string | null;
  balance: number;
  user_id: string;
  created_at: string;
}

interface MiscExpense {
  id: string;
  expense_date: string;
  amount: number;
  description: string;
  origin: string;
  user_id: string;
  created_at: string;
}

// ── Component ──────────────────────────────────────────

export default function Overview() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();

  // ─ Overview state
  const [teleClosings, setTeleClosings] = useState<ClosingRow[]>([]);
  const [salonClosings, setSalonClosings] = useState<ClosingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCashExpectation, setShowCashExpectation] = useState(false);

  // ─ Cash Control state
  const [formDate, setFormDate] = useState<Date>(new Date());
  const [changeSalon, setChangeSalon] = useState('');
  const [changeTele, setChangeTele] = useState('');
  const [vaultEntry, setVaultEntry] = useState('');
  const [vaultEntryDesc, setVaultEntryDesc] = useState('');
  const [vaultExit, setVaultExit] = useState('');
  const [vaultExitDesc, setVaultExitDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseOrigin, setExpenseOrigin] = useState('cofre');
  const [savingExpense, setSavingExpense] = useState(false);
  const [vaultClosings, setVaultClosings] = useState<VaultClosing[]>([]);
  const [expenses, setExpenses] = useState<MiscExpense[]>([]);
  const [loadingVault, setLoadingVault] = useState(true);
  const [filterStart, setFilterStart] = useState<Date | undefined>();
  const [filterEnd, setFilterEnd] = useState<Date | undefined>();

  // ─ Data loading
  useEffect(() => {
    loadOverviewData();
    if (isAdmin) loadVaultData();
  }, [isAdmin]);

  const loadOverviewData = async () => {
    const [{ data: tele }, { data: salon }] = await Promise.all([
      supabase.from('daily_closings').select('id, closing_date, status, reconciliation_status').order('closing_date', { ascending: false }),
      supabase.from('salon_closings').select('id, closing_date, status, reconciliation_status').order('closing_date', { ascending: false }),
    ]);
    setTeleClosings((tele as ClosingRow[]) || []);
    setSalonClosings((salon as ClosingRow[]) || []);
    setLoading(false);
  };

  const loadVaultData = async () => {
    setLoadingVault(true);
    const [closingsRes, expensesRes] = await Promise.all([
      supabase.from('vault_daily_closings').select('*').order('closing_date', { ascending: false }),
      supabase.from('vault_misc_expenses').select('*').order('created_at', { ascending: false }),
    ]);
    setVaultClosings((closingsRes.data as any[]) || []);
    setExpenses((expensesRes.data as any[]) || []);
    setLoadingVault(false);
  };

  // ── Overview logic ───────────────────────────────────

  const days = useMemo(() => {
    const dateMap = new Map<string, DayEntry>();
    teleClosings.forEach(c => {
      if (!dateMap.has(c.closing_date)) dateMap.set(c.closing_date, { date: c.closing_date, tele: null, salon: null });
      dateMap.get(c.closing_date)!.tele = c;
    });
    salonClosings.forEach(c => {
      if (!dateMap.has(c.closing_date)) dateMap.set(c.closing_date, { date: c.closing_date, tele: null, salon: null });
      dateMap.get(c.closing_date)!.salon = c;
    });
    return [...dateMap.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [teleClosings, salonClosings]);

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  const getWeekday = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('pt-BR', { weekday: 'short' });
  };

  const getProgress = (closing: ClosingRow | null) => {
    if (!closing) return 0;
    let p = 0;
    if (closing.status === 'completed') p += 50;
    if (closing.reconciliation_status === 'completed') p += 50;
    return p;
  };

  const totalDays = days.length;
  const fullyComplete = days.filter(d => getProgress(d.tele) === 100 && getProgress(d.salon) === 100).length;

  const StatusBadge = ({ closing, label }: { closing: ClosingRow | null; label: string }) => {
    if (!closing) return <Badge className="bg-muted text-muted-foreground text-[10px]">Sem {label}</Badge>;
    const confDone = closing.status === 'completed';
    const reconcDone = closing.reconciliation_status === 'completed';
    if (confDone && reconcDone) return <Badge className="bg-success/15 text-success border-success/30 text-[10px]">100%</Badge>;
    if (confDone) return <Badge className="bg-warning/15 text-warning border-warning/30 text-[10px]">50%</Badge>;
    return <Badge className="bg-muted text-muted-foreground text-[10px]">0%</Badge>;
  };

  // ── Cash Control logic ───────────────────────────────

  const previousBalance = useMemo(() => {
    const dateStr = format(formDate, 'yyyy-MM-dd');
    const sorted = [...vaultClosings].sort((a, b) => a.closing_date.localeCompare(b.closing_date));
    const prev = sorted.filter(c => c.closing_date < dateStr);
    return prev.length > 0 ? prev[prev.length - 1].balance : 0;
  }, [vaultClosings, formDate]);

  const dayExpenses = useMemo(() => {
    const dateStr = format(formDate, 'yyyy-MM-dd');
    return expenses.filter(e => e.expense_date === dateStr);
  }, [expenses, formDate]);

  const totalDayExpenses = useMemo(() => dayExpenses.reduce((s, e) => s + Number(e.amount), 0), [dayExpenses]);

  const calculatedBalance = useMemo(() => {
    const entry = parseFloat(vaultEntry) || 0;
    const exit = parseFloat(vaultExit) || 0;
    const cs = parseFloat(changeSalon) || 0;
    const ct = parseFloat(changeTele) || 0;
    return previousBalance + entry - exit - cs - ct - totalDayExpenses;
  }, [previousBalance, vaultEntry, vaultExit, changeSalon, changeTele, totalDayExpenses]);

  const monthlySummary = useMemo(() => {
    const now = new Date();
    const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
    const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd');
    const monthClosings = vaultClosings.filter(c => c.closing_date >= monthStart && c.closing_date <= monthEnd);
    const monthExpenses = expenses.filter(e => e.expense_date >= monthStart && e.expense_date <= monthEnd);
    const totalEntries = monthClosings.reduce((s, c) => s + Number(c.vault_entry), 0);
    const totalExits = monthClosings.reduce((s, c) => s + Number(c.vault_exit), 0)
      + monthExpenses.reduce((s, e) => s + Number(e.amount), 0)
      + monthClosings.reduce((s, c) => s + Number(c.change_salon) + Number(c.change_tele), 0);
    const sorted = [...vaultClosings].sort((a, b) => a.closing_date.localeCompare(b.closing_date));
    const currentBalance = sorted.length > 0 ? sorted[sorted.length - 1].balance : 0;
    return { currentBalance, totalEntries, totalExits };
  }, [vaultClosings, expenses]);

  const filteredVaultClosings = useMemo(() => {
    let filtered = vaultClosings;
    if (filterStart) filtered = filtered.filter(c => c.closing_date >= format(filterStart, 'yyyy-MM-dd'));
    if (filterEnd) filtered = filtered.filter(c => c.closing_date <= format(filterEnd, 'yyyy-MM-dd'));
    return filtered;
  }, [vaultClosings, filterStart, filterEnd]);

  const loadClosingForEdit = (closing: VaultClosing) => {
    setEditingId(closing.id);
    setFormDate(parseISO(closing.closing_date));
    setChangeSalon(String(closing.change_salon));
    setChangeTele(String(closing.change_tele));
    setVaultEntry(String(closing.vault_entry));
    setVaultEntryDesc(closing.vault_entry_description || '');
    setVaultExit(String(closing.vault_exit));
    setVaultExitDesc(closing.vault_exit_description || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setEditingId(null);
    setFormDate(new Date());
    setChangeSalon('');
    setChangeTele('');
    setVaultEntry('');
    setVaultEntryDesc('');
    setVaultExit('');
    setVaultExitDesc('');
  };

  const handleSave = async () => {
    if (!user) return;
    const exitVal = parseFloat(vaultExit) || 0;
    if (exitVal > 0 && !vaultExitDesc.trim()) {
      toast.error('Descrição obrigatória para saída do cofre');
      return;
    }
    setSaving(true);
    const record = {
      closing_date: format(formDate, 'yyyy-MM-dd'),
      change_salon: parseFloat(changeSalon) || 0,
      change_tele: parseFloat(changeTele) || 0,
      vault_entry: parseFloat(vaultEntry) || 0,
      vault_entry_description: vaultEntryDesc.trim() || null,
      vault_exit: exitVal,
      vault_exit_description: vaultExitDesc.trim() || null,
      balance: calculatedBalance,
      user_id: user.id,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (editingId) {
      ({ error } = await supabase.from('vault_daily_closings').update(record).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('vault_daily_closings').insert(record));
    }
    if (error) {
      if (error.code === '23505') toast.error('Já existe um fechamento para esta data. Clique nele para editar.');
      else toast.error('Erro ao salvar: ' + error.message);
    } else {
      toast.success(editingId ? 'Fechamento atualizado!' : 'Fechamento registrado!');
      resetForm();
      await loadVaultData();
    }
    setSaving(false);
  };

  const handleDeleteClosing = async (id: string) => {
    const { error } = await supabase.from('vault_daily_closings').delete().eq('id', id);
    if (error) toast.error('Erro ao excluir');
    else { toast.success('Excluído'); loadVaultData(); }
  };

  const handleSaveExpense = async () => {
    if (!user) return;
    if (!expenseDesc.trim()) { toast.error('Descrição obrigatória'); return; }
    if (!expenseAmount || parseFloat(expenseAmount) <= 0) { toast.error('Valor inválido'); return; }
    setSavingExpense(true);
    const { error } = await supabase.from('vault_misc_expenses').insert({
      expense_date: format(formDate, 'yyyy-MM-dd'),
      amount: parseFloat(expenseAmount),
      description: expenseDesc.trim(),
      origin: expenseOrigin,
      user_id: user.id,
    });
    if (error) toast.error('Erro: ' + error.message);
    else {
      toast.success('Saída avulsa registrada!');
      setExpenseAmount(''); setExpenseDesc(''); setExpenseOrigin('cofre');
      setShowExpenseDialog(false);
      await loadVaultData();
    }
    setSavingExpense(false);
  };

  const handleDeleteExpense = async (id: string) => {
    const { error } = await supabase.from('vault_misc_expenses').delete().eq('id', id);
    if (error) toast.error('Erro ao excluir');
    else { toast.success('Excluído'); loadVaultData(); }
  };

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const originLabel = (o: string) => o === 'salao' ? 'Salão' : o === 'tele' ? 'Tele' : 'Cofre';

  // ── Render ───────────────────────────────────────────

  return (
    <AppLayout
      title="Visão Geral"
      subtitle="Acompanhamento diário — Conferência, Conciliação & Cofre"
    >
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="overview">
            <CalendarDays className="h-4 w-4 mr-2" />
            Conferências
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="vault">
              <Vault className="h-4 w-4 mr-2" />
              Controle de Caixa
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="cash-expectation" onClick={(e) => { e.preventDefault(); setShowCashExpectation(true); }}>
              <Vault className="h-4 w-4 mr-2" />
              Abrir Caixa
            </TabsTrigger>
          )}
        </TabsList>

        {/* ═══ Tab: Overview ═══ */}
        <TabsContent value="overview">
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-card rounded-xl shadow-card p-5 border border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dias registrados</span>
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-3xl font-bold text-foreground">{totalDays}</p>
            </div>
            <div className="bg-card rounded-xl shadow-card p-5 border border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">100% Concluídos</span>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-3xl font-bold text-foreground">{fullyComplete}</p>
            </div>
            <div className="bg-card rounded-xl shadow-card p-5 border border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pendentes</span>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-3xl font-bold text-foreground">{totalDays - fullyComplete}</p>
            </div>
          </div>

          {/* Days list */}
          <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold text-foreground">Todos os Dias</h2>
            </div>
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : days.length === 0 ? (
              <div className="text-center py-16">
                <CalendarDays className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-foreground mb-2">Nenhum dia registrado</h3>
                <p className="text-sm text-muted-foreground">Importe dados na aba Tele ou Salão para começar.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {days.map((day) => {
                  const teleProgress = getProgress(day.tele);
                  const salonProgress = getProgress(day.salon);
                  const totalProgress = Math.round(((day.tele ? teleProgress : 0) + (day.salon ? salonProgress : 0)) / ((day.tele ? 1 : 0) + (day.salon ? 1 : 0) || 1));
                  return (
                    <div key={day.date} className="p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                            <CalendarDays className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-semibold text-foreground">{formatDate(day.date)}</p>
                            <p className="text-xs text-muted-foreground capitalize">{getWeekday(day.date)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground tabular-nums">{totalProgress}%</span>
                          <Progress value={totalProgress} className="w-24 h-2" />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {day.tele && (
                          <button onClick={() => navigate(`/reconciliation/${day.tele!.id}`)} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2.5 hover:bg-muted transition-colors group text-left">
                            <div className="flex items-center gap-2">
                              <Bike className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <p className="text-xs font-semibold text-foreground">Tele</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[10px] text-muted-foreground">Conf: {day.tele.status === 'completed' ? '✅' : '⏳'}</span>
                                  <span className="text-[10px] text-muted-foreground">Conc: {day.tele.reconciliation_status === 'completed' ? '✅' : '⏳'}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusBadge closing={day.tele} label="Tele" />
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                            </div>
                          </button>
                        )}
                        {day.salon && (
                          <button onClick={() => navigate(`/salon/closing/${day.salon!.id}`)} className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2.5 hover:bg-muted transition-colors group text-left">
                            <div className="flex items-center gap-2">
                              <Store className="h-4 w-4 text-muted-foreground" />
                              <div>
                                <p className="text-xs font-semibold text-foreground">Salão</p>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-[10px] text-muted-foreground">Conf: {day.salon.status === 'completed' ? '✅' : '⏳'}</span>
                                  <span className="text-[10px] text-muted-foreground">Conc: {day.salon.reconciliation_status === 'completed' ? '✅' : '⏳'}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusBadge closing={day.salon} label="Salão" />
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                            </div>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ═══ Tab: Controle de Caixa ═══ */}
        {isAdmin && (
          <TabsContent value="vault">
            {/* Monthly Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Saldo Atual no Cofre</CardTitle>
                  <Vault className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className={cn("text-2xl font-bold", monthlySummary.currentBalance >= 0 ? 'text-emerald-500' : 'text-destructive')}>
                    {fmt(monthlySummary.currentBalance)}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Entradas no Mês</CardTitle>
                  <ArrowUpCircle className="h-4 w-4 text-emerald-500" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-emerald-500">{fmt(monthlySummary.totalEntries)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Saídas no Mês</CardTitle>
                  <ArrowDownCircle className="h-4 w-4 text-destructive" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-destructive">{fmt(monthlySummary.totalExits)}</p>
                </CardContent>
              </Card>
            </div>

            {/* Daily Record Form */}
            <Card className="mb-6">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{editingId ? 'Editar Fechamento' : 'Novo Registro Diário'}</CardTitle>
                <Button size="sm" variant="outline" onClick={() => setShowExpenseDialog(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Saída Avulsa
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>📅 Data</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !formDate && "text-muted-foreground")}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(formDate, "dd/MM/yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={formDate} onSelect={(d) => d && setFormDate(d)} className="p-3 pointer-events-auto" locale={ptBR} />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1.5">
                    <Label>💵 Troco Salão (R$)</Label>
                    <Input type="number" step="0.01" placeholder="0,00" value={changeSalon} onChange={e => setChangeSalon(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>💵 Troco Tele (R$)</Label>
                    <Input type="number" step="0.01" placeholder="0,00" value={changeTele} onChange={e => setChangeTele(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>⬆️ Entrada Cofre (R$)</Label>
                    <Input type="number" step="0.01" placeholder="0,00" value={vaultEntry} onChange={e => setVaultEntry(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Descrição entrada (opcional)</Label>
                    <Input placeholder="Ex: depósito do dia" value={vaultEntryDesc} onChange={e => setVaultEntryDesc(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>⬇️ Saída Cofre (R$)</Label>
                    <Input type="number" step="0.01" placeholder="0,00" value={vaultExit} onChange={e => setVaultExit(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Descrição saída (obrigatório)</Label>
                    <Input placeholder="Ex: pagamento fornecedor" value={vaultExitDesc} onChange={e => setVaultExitDesc(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>💰 Saldo Calculado</Label>
                    <div className={cn("h-10 flex items-center px-3 rounded-md border bg-muted font-bold", calculatedBalance >= 0 ? 'text-emerald-500' : 'text-destructive')}>
                      {fmt(calculatedBalance)}
                    </div>
                    <p className="text-[10px] text-muted-foreground">Anterior ({fmt(previousBalance)}) + Entradas - Saídas - Trocos - Avulsas ({fmt(totalDayExpenses)})</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>👤 Responsável</Label>
                    <div className="h-10 flex items-center px-3 rounded-md border bg-muted text-sm">
                      {user?.email?.split('@')[0] || 'Usuário'}
                    </div>
                  </div>
                </div>

                {dayExpenses.length > 0 && (
                  <div className="mt-4 border rounded-lg p-3">
                    <p className="text-xs font-semibold text-muted-foreground mb-2">Saídas avulsas do dia</p>
                    {dayExpenses.map(e => (
                      <div key={e.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                        <span className="text-muted-foreground">{originLabel(e.origin)}</span>
                        <span className="flex-1 mx-3 truncate">{e.description}</span>
                        <span className="font-medium text-destructive mr-2">-{fmt(e.amount)}</span>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleDeleteExpense(e.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? 'Salvando...' : editingId ? 'Atualizar Fechamento' : 'Registrar Fechamento'}
                  </Button>
                  {editingId && <Button variant="outline" onClick={resetForm}>Cancelar edição</Button>}
                </div>
              </CardContent>
            </Card>

            {/* History */}
            <Card>
              <CardHeader>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                  <CardTitle className="text-base">Histórico de Fechamentos</CardTitle>
                  <div className="flex gap-2 items-center">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className={cn(!filterStart && "text-muted-foreground")}>
                          <CalendarIcon className="h-3.5 w-3.5 mr-1" />
                          {filterStart ? format(filterStart, 'dd/MM/yy') : 'Início'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={filterStart} onSelect={setFilterStart} className="p-3 pointer-events-auto" locale={ptBR} />
                      </PopoverContent>
                    </Popover>
                    <span className="text-muted-foreground text-xs">até</span>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className={cn(!filterEnd && "text-muted-foreground")}>
                          <CalendarIcon className="h-3.5 w-3.5 mr-1" />
                          {filterEnd ? format(filterEnd, 'dd/MM/yy') : 'Fim'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={filterEnd} onSelect={setFilterEnd} className="p-3 pointer-events-auto" locale={ptBR} />
                      </PopoverContent>
                    </Popover>
                    {(filterStart || filterEnd) && (
                      <Button variant="ghost" size="sm" onClick={() => { setFilterStart(undefined); setFilterEnd(undefined); }}>Limpar</Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingVault ? (
                  <div className="flex justify-center py-8">
                    <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
                  </div>
                ) : filteredVaultClosings.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">Nenhum fechamento registrado</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Data</TableHead>
                          <TableHead className="text-right">Troco Salão</TableHead>
                          <TableHead className="text-right">Troco Tele</TableHead>
                          <TableHead className="text-right">Entradas</TableHead>
                          <TableHead className="text-right">Saídas</TableHead>
                          <TableHead className="text-right">Avulsas</TableHead>
                          <TableHead className="text-right">Saldo</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredVaultClosings.map(c => {
                          const dateExpenses = expenses.filter(e => e.expense_date === c.closing_date);
                          const totalMisc = dateExpenses.reduce((s, e) => s + Number(e.amount), 0);
                          return (
                            <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => loadClosingForEdit(c)}>
                              <TableCell className="font-medium">{format(parseISO(c.closing_date), 'dd/MM/yyyy')}</TableCell>
                              <TableCell className="text-right">{fmt(c.change_salon)}</TableCell>
                              <TableCell className="text-right">{fmt(c.change_tele)}</TableCell>
                              <TableCell className="text-right text-emerald-500">{fmt(c.vault_entry)}</TableCell>
                              <TableCell className="text-right text-destructive">{fmt(c.vault_exit)}</TableCell>
                              <TableCell className="text-right text-destructive">{totalMisc > 0 ? fmt(totalMisc) : '-'}</TableCell>
                              <TableCell className={cn("text-right font-bold", c.balance >= 0 ? 'text-emerald-500' : 'text-destructive')}>{fmt(c.balance)}</TableCell>
                              <TableCell>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); handleDeleteClosing(c.id); }}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Dialogs */}
      <CashExpectationDialog open={showCashExpectation} onOpenChange={setShowCashExpectation} />

      <Dialog open={showExpenseDialog} onOpenChange={setShowExpenseDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova Saída Avulsa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Valor (R$)</Label>
              <Input type="number" step="0.01" placeholder="0,00" value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea placeholder='Ex: "fita dupla face", "pagar free"' value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Origem</Label>
              <Select value={expenseOrigin} onValueChange={setExpenseOrigin}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cofre">Cofre</SelectItem>
                  <SelectItem value="salao">Salão</SelectItem>
                  <SelectItem value="tele">Tele</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Data: {format(formDate, 'dd/MM/yyyy')} • Responsável: {user?.email?.split('@')[0]}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExpenseDialog(false)}>Cancelar</Button>
            <Button onClick={handleSaveExpense} disabled={savingExpense}>
              {savingExpense ? 'Salvando...' : 'Registrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
