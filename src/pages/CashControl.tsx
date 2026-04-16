import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon, Plus, Vault, Trash2, Calculator, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import VaultCashCalculator, { VaultBalanceDetail } from '@/components/VaultCashCalculator';
import DenominationCountTable, { DenomCounts, emptyDenomCounts, sumDenomCounts } from '@/components/DenominationCountTable';
import { useBlock1AutoFill } from '@/hooks/useBlock1AutoFill';
import { upsertAberturaFromTrocos } from '@/lib/upsert-abertura-from-trocos';

interface VaultClosing {
  id: string;
  closing_date: string;
  change_salon: number;
  change_tele: number;
  vault_entry: number;
  vault_entry_description: string | null;
  vault_entry_counts: Record<string, number> | null;
  vault_exit: number;
  vault_exit_description: string | null;
  vault_exit_counts: Record<string, number> | null;
  balance: number;
  user_id: string;
  created_at: string;
  contagem_salao: DenomCounts | null;
  contagem_tele: DenomCounts | null;
  contagem_cofre: DenomCounts | null;
  trocos_salao: DenomCounts | null;
  trocos_tele: DenomCounts | null;
  cofre_final: DenomCounts | null;
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

export default function CashControl() {
  const { user } = useAuth();

  // Form state
  const [formDate, setFormDate] = useState<Date>(new Date());
  const [changeSalon, setChangeSalon] = useState('');
  const [changeTele, setChangeTele] = useState('');
  const [vaultEntry, setVaultEntry] = useState('');
  const [vaultEntryDesc, setVaultEntryDesc] = useState('');
  const [vaultEntryCounts, setVaultEntryCounts] = useState<Record<string, number> | null>(null);
  const [vaultExit, setVaultExit] = useState('');
  const [vaultExitDesc, setVaultExitDesc] = useState('');
  const [vaultExitCounts, setVaultExitCounts] = useState<Record<string, number> | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Denomination counting state
  const [contagemSalao, setContagemSalao] = useState<DenomCounts>(emptyDenomCounts());
  const [contagemTele, setContagemTele] = useState<DenomCounts>(emptyDenomCounts());
  const [contagemCofre, setContagemCofre] = useState<DenomCounts>(emptyDenomCounts());
  const [trocosSalao, setTrocosSalao] = useState<DenomCounts>(emptyDenomCounts());
  const [trocosTele, setTrocosTele] = useState<DenomCounts>(emptyDenomCounts());
  const [cofreFinal, setCofreFinal] = useState<DenomCounts>(emptyDenomCounts());

  // Calculator dialogs
  const [showEntryCalc, setShowEntryCalc] = useState(false);
  const [showExitCalc, setShowExitCalc] = useState(false);
  const [showBalanceDetail, setShowBalanceDetail] = useState(false);

  // Misc expense dialog
  const [showExpenseDialog, setShowExpenseDialog] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseOrigin, setExpenseOrigin] = useState('cofre');
  const [savingExpense, setSavingExpense] = useState(false);

  // Data
  const [closings, setClosings] = useState<VaultClosing[]>([]);
  const [expenses, setExpenses] = useState<MiscExpense[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterStart, setFilterStart] = useState<Date | undefined>();
  const [filterEnd, setFilterEnd] = useState<Date | undefined>();

  const loadData = async () => {
    setLoading(true);
    const [closingsRes, expensesRes] = await Promise.all([
      supabase.from('vault_daily_closings').select('*').order('closing_date', { ascending: false }),
      supabase.from('vault_misc_expenses').select('*').order('created_at', { ascending: false }),
    ]);
    setClosings((closingsRes.data as any[]) || []);
    setExpenses((expensesRes.data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  // Auto-fill Block 1 from cash_snapshots + previous cofre_final
  const autoFill = useBlock1AutoFill(formDate, editingId);

  useEffect(() => {
    if (autoFill.loaded && !editingId) {
      setContagemSalao(autoFill.salao);
      setContagemTele(autoFill.tele);
      setContagemCofre(autoFill.cofre);
    }
  }, [autoFill, editingId]);
  // Saldo Atual = total do cofre_final do último registro
  const currentVaultBalance = useMemo(() => {
    const sorted = [...closings].sort((a, b) => a.closing_date.localeCompare(b.closing_date));
    if (sorted.length === 0) return 0;
    const last = sorted[sorted.length - 1];
    return last.cofre_final ? sumDenomCounts(last.cofre_final) : last.balance;
  }, [closings]);

  const previousBalance = useMemo(() => {
    const dateStr = format(formDate, 'yyyy-MM-dd');
    const sorted = [...closings].sort((a, b) => a.closing_date.localeCompare(b.closing_date));
    const prev = sorted.filter(c => c.closing_date < dateStr);
    return prev.length > 0 ? prev[prev.length - 1].balance : 0;
  }, [closings, formDate]);

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

  const filteredClosings = useMemo(() => {
    let filtered = closings;
    if (filterStart) {
      const startStr = format(filterStart, 'yyyy-MM-dd');
      filtered = filtered.filter(c => c.closing_date >= startStr);
    }
    if (filterEnd) {
      const endStr = format(filterEnd, 'yyyy-MM-dd');
      filtered = filtered.filter(c => c.closing_date <= endStr);
    }
    return filtered;
  }, [closings, filterStart, filterEnd]);

  const loadClosingForEdit = (closing: VaultClosing) => {
    setEditingId(closing.id);
    setFormDate(parseISO(closing.closing_date));
    setChangeSalon(String(closing.change_salon));
    setChangeTele(String(closing.change_tele));
    setVaultEntry(String(closing.vault_entry));
    setVaultEntryDesc(closing.vault_entry_description || '');
    setVaultEntryCounts(closing.vault_entry_counts || null);
    setVaultExit(String(closing.vault_exit));
    setVaultExitDesc(closing.vault_exit_description || '');
    setVaultExitCounts(closing.vault_exit_counts || null);
    setContagemSalao(closing.contagem_salao || emptyDenomCounts());
    setContagemTele(closing.contagem_tele || emptyDenomCounts());
    setContagemCofre(closing.contagem_cofre || emptyDenomCounts());
    setTrocosSalao(closing.trocos_salao || emptyDenomCounts());
    setTrocosTele(closing.trocos_tele || emptyDenomCounts());
    setCofreFinal(closing.cofre_final || emptyDenomCounts());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setEditingId(null);
    setFormDate(new Date());
    setChangeSalon('');
    setChangeTele('');
    setVaultEntry('');
    setVaultEntryDesc('');
    setVaultEntryCounts(null);
    setVaultExit('');
    setVaultExitDesc('');
    setVaultExitCounts(null);
    setContagemSalao(emptyDenomCounts());
    setContagemTele(emptyDenomCounts());
    setContagemCofre(emptyDenomCounts());
    setTrocosSalao(emptyDenomCounts());
    setTrocosTele(emptyDenomCounts());
    setCofreFinal(emptyDenomCounts());
  };

  const handleDenomChange = useCallback((setter: React.Dispatch<React.SetStateAction<DenomCounts>>) => {
    return (_colKey: string, denom: string, value: number) => {
      setter(prev => ({ ...prev, [denom]: value }));
    };
  }, []);

  const handleMultiColDenomChange = useCallback((
    setters: Record<string, React.Dispatch<React.SetStateAction<DenomCounts>>>
  ) => {
    return (colKey: string, denom: string, value: number) => {
      const setter = setters[colKey];
      if (setter) setter(prev => ({ ...prev, [denom]: value }));
    };
  }, []);

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    const record: any = {
      closing_date: format(formDate, 'yyyy-MM-dd'),
      change_salon: parseFloat(changeSalon) || 0,
      change_tele: parseFloat(changeTele) || 0,
      vault_entry: parseFloat(vaultEntry) || 0,
      vault_entry_description: vaultEntryDesc.trim() || null,
      vault_entry_counts: vaultEntryCounts || {},
      vault_exit: parseFloat(vaultExit) || 0,
      vault_exit_description: vaultExitDesc.trim() || null,
      vault_exit_counts: vaultExitCounts || {},
      balance: calculatedBalance,
      user_id: user.id,
      updated_at: new Date().toISOString(),
      contagem_salao: contagemSalao,
      contagem_tele: contagemTele,
      contagem_cofre: contagemCofre,
      trocos_salao: trocosSalao,
      trocos_tele: trocosTele,
      cofre_final: cofreFinal,
    };

    let error;
    if (editingId) {
      ({ error } = await supabase.from('vault_daily_closings').update(record).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('vault_daily_closings').insert(record));
    }

    if (error) {
      if (error.code === '23505') {
        toast.error('Já existe um fechamento para esta data. Clique nele para editar.');
      } else {
        toast.error('Erro ao salvar: ' + error.message);
      }
    } else {
      // Upsert abertura snapshots from Bloco 2 trocos
      const aberturaResult = await upsertAberturaFromTrocos(
        trocosSalao, trocosTele, format(formDate, 'yyyy-MM-dd'), user.id
      );
      if (aberturaResult.error) {
        toast.warning(aberturaResult.error);
      }
      toast.success(editingId ? 'Fechamento atualizado!' : 'Fechamento registrado!');
      resetForm();
      await loadData();
    }
    setSaving(false);
  };

  const handleDeleteClosing = async (id: string) => {
    const { error } = await supabase.from('vault_daily_closings').delete().eq('id', id);
    if (error) toast.error('Erro ao excluir');
    else {
      toast.success('Excluído');
      loadData();
    }
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
      setExpenseAmount('');
      setExpenseDesc('');
      setExpenseOrigin('cofre');
      setShowExpenseDialog(false);
      await loadData();
    }
    setSavingExpense(false);
  };

  const handleDeleteExpense = async (id: string) => {
    const { error } = await supabase.from('vault_misc_expenses').delete().eq('id', id);
    if (error) toast.error('Erro ao excluir');
    else { toast.success('Excluído'); loadData(); }
  };

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const originLabel = (o: string) => o === 'salao' ? 'Salão' : o === 'tele' ? 'Tele' : 'Cofre';

  return (
    <AppLayout title="Controle de Caixa" subtitle="Gerenciamento do cofre e movimentações diárias">
      {/* Saldo Atual no Cofre — single card */}
      <div className="grid grid-cols-1 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Saldo Atual no Cofre</CardTitle>
            <Vault className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className={cn("text-2xl font-bold", currentVaultBalance >= 0 ? 'text-emerald-500' : 'text-destructive')}>
              {fmt(currentVaultBalance)}
            </p>
            <Button variant="ghost" size="sm" className="mt-1 h-7 text-xs text-muted-foreground" onClick={() => setShowBalanceDetail(true)}>
              <Eye className="h-3 w-3 mr-1" /> Ver detalhes
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Daily Record Form */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{editingId ? 'Editar Fechamento' : 'Fechamento do Dia'}</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowExpenseDialog(true)}>
            <Plus className="h-4 w-4 mr-1" /> Saída Avulsa
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Date */}
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

            {/* Troco Salão */}
            <div className="space-y-1.5">
              <Label>💵 Troco Salão (R$)</Label>
              <Input type="number" step="0.01" placeholder="0,00" value={changeSalon} onChange={e => setChangeSalon(e.target.value)} />
            </div>

            {/* Troco Tele */}
            <div className="space-y-1.5">
              <Label>💵 Troco Tele (R$)</Label>
              <Input type="number" step="0.01" placeholder="0,00" value={changeTele} onChange={e => setChangeTele(e.target.value)} />
            </div>

            {/* Entrada cofre */}
            <div className="space-y-1.5">
              <Label>⬆️ Entrada Cofre (R$)</Label>
              <div className="flex gap-2">
                <Input type="number" step="0.01" placeholder="0,00" value={vaultEntry} onChange={e => { setVaultEntry(e.target.value); setVaultEntryCounts(null); }} className="flex-1" />
                <Button variant="outline" size="icon" className="shrink-0" onClick={() => setShowEntryCalc(true)} title="Calculadora de cédulas">
                  <Calculator className="h-4 w-4" />
                </Button>
              </div>
              {vaultEntryCounts && Object.keys(vaultEntryCounts).length > 0 && (
                <p className="text-[10px] text-emerald-600">✓ Contagem detalhada salva</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Descrição entrada (opcional)</Label>
              <Input placeholder="Ex: depósito do dia" value={vaultEntryDesc} onChange={e => setVaultEntryDesc(e.target.value)} />
            </div>

            {/* Saída cofre */}
            <div className="space-y-1.5">
              <Label>⬇️ Saída Cofre (R$)</Label>
              <div className="flex gap-2">
                <Input type="number" step="0.01" placeholder="0,00" value={vaultExit} onChange={e => { setVaultExit(e.target.value); setVaultExitCounts(null); }} className="flex-1" />
                <Button variant="outline" size="icon" className="shrink-0" onClick={() => setShowExitCalc(true)} title="Calculadora de cédulas">
                  <Calculator className="h-4 w-4" />
                </Button>
              </div>
              {vaultExitCounts && Object.keys(vaultExitCounts).length > 0 && (
                <p className="text-[10px] text-emerald-600">✓ Contagem detalhada salva</p>
              )}
            </div>

            {/* Saldo */}
            <div className="space-y-1.5">
              <Label>💰 Saldo</Label>
              <div className={cn("h-10 flex items-center px-3 rounded-md border bg-muted font-bold", calculatedBalance >= 0 ? 'text-emerald-500' : 'text-destructive')}>
                {fmt(calculatedBalance)}
              </div>
              <p className="text-[10px] text-muted-foreground">Anterior ({fmt(previousBalance)}) + Entradas - Saídas - Trocos - Avulsas ({fmt(totalDayExpenses)})</p>
            </div>

            {/* Responsável */}
            <div className="space-y-1.5">
              <Label>👤 Responsável</Label>
              <div className="h-10 flex items-center px-3 rounded-md border bg-muted text-sm">
                {user?.email?.split('@')[0] || 'Usuário'}
              </div>
            </div>
          </div>

          {/* Day expenses list */}
          {dayExpenses.length > 0 && (
            <div className="border rounded-lg p-3">
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

          {/* ── Denomination Counting Blocks ── */}
          <div className="space-y-6 pt-4 border-t">
            <h2 className="text-base font-semibold text-foreground">Contagem por Nota</h2>

            {/* Bloco 1 — Sobra dos Caixas + Cofre */}
            <DenominationCountTable
              title="Bloco 1 — Sobra dos Caixas + Cofre"
              columns={[
                { key: 'salao', label: 'Salão (R$)' },
                { key: 'tele', label: 'Tele (R$)' },
                { key: 'cofre', label: 'Cofre (R$)' },
              ]}
              values={{ salao: contagemSalao, tele: contagemTele, cofre: contagemCofre }}
              onChange={handleMultiColDenomChange({ salao: setContagemSalao, tele: setContagemTele, cofre: setContagemCofre })}
              showTotalColumn
            />

            {/* Bloco 2 — Trocos do Próximo Dia */}
            <DenominationCountTable
              title="Bloco 2 — Trocos do Próximo Dia"
              columns={[
                { key: 'salao', label: 'Salão (R$)' },
                { key: 'tele', label: 'Tele (R$)' },
              ]}
              values={{ salao: trocosSalao, tele: trocosTele }}
              onChange={handleMultiColDenomChange({ salao: setTrocosSalao, tele: setTrocosTele })}
            />

            {/* Bloco 3 — Cofre Final */}
            <DenominationCountTable
              title="Bloco 3 — Cofre Final"
              columns={[{ key: 'cofre', label: 'Cofre (R$)' }]}
              values={{ cofre: cofreFinal }}
              onChange={handleDenomChange(setCofreFinal)}
            />
          </div>

          <div className="flex gap-2 mt-4">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : editingId ? 'Atualizar Fechamento' : 'Registrar Fechamento'}
            </Button>
            {editingId && (
              <Button variant="outline" onClick={resetForm}>Cancelar edição</Button>
            )}
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
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-6 w-6 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : filteredClosings.length === 0 ? (
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
                    <TableHead className="text-right">Cofre Final</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClosings.map(c => {
                    const dateExpenses = expenses.filter(e => e.expense_date === c.closing_date);
                    const totalMisc = dateExpenses.reduce((s, e) => s + Number(e.amount), 0);
                    const cofreFinalTotal = c.cofre_final ? sumDenomCounts(c.cofre_final) : 0;
                    return (
                      <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => loadClosingForEdit(c)}>
                        <TableCell className="font-medium">{format(parseISO(c.closing_date), 'dd/MM/yyyy')}</TableCell>
                        <TableCell className="text-right">{fmt(c.change_salon)}</TableCell>
                        <TableCell className="text-right">{fmt(c.change_tele)}</TableCell>
                        <TableCell className="text-right text-emerald-500">{fmt(c.vault_entry)}</TableCell>
                        <TableCell className="text-right text-destructive">{fmt(c.vault_exit)}</TableCell>
                        <TableCell className="text-right text-destructive">{totalMisc > 0 ? fmt(totalMisc) : '-'}</TableCell>
                        <TableCell className={cn("text-right font-bold", c.balance >= 0 ? 'text-emerald-500' : 'text-destructive')}>{fmt(c.balance)}</TableCell>
                        <TableCell className="text-right font-bold text-primary">{cofreFinalTotal > 0 ? fmt(cofreFinalTotal) : '-'}</TableCell>
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

      {/* Misc Expense Dialog */}
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

      {/* Entry Cash Calculator */}
      <VaultCashCalculator
        open={showEntryCalc}
        onOpenChange={setShowEntryCalc}
        title="Contagem de Cédulas — Entrada Cofre"
        initialCounts={vaultEntryCounts || undefined}
        onSave={(counts, total) => {
          setVaultEntryCounts(counts);
          setVaultEntry(String(total));
          toast.success('Contagem de entrada salva!');
        }}
      />

      {/* Exit Cash Calculator */}
      <VaultCashCalculator
        open={showExitCalc}
        onOpenChange={setShowExitCalc}
        title="Contagem de Cédulas — Saída Cofre"
        initialCounts={vaultExitCounts || undefined}
        onSave={(counts, total) => {
          setVaultExitCounts(counts);
          setVaultExit(String(total));
          toast.success('Contagem de saída salva!');
        }}
      />

      {/* Balance Detail */}
      <VaultBalanceDetail
        open={showBalanceDetail}
        onOpenChange={setShowBalanceDetail}
        balance={currentVaultBalance}
        entryCounts={closings.length > 0 ? (closings.sort((a, b) => a.closing_date.localeCompare(b.closing_date))[closings.length - 1].cofre_final || null) : null}
      />
    </AppLayout>
  );
}
