import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, AlertCircle, CheckCircle2, Banknote, Calculator, ChevronDown, ChevronRight, FileText, Trash2, Lock, Unlock, QrCode, CreditCard, Globe, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { useUserRole } from '@/hooks/useUserRole';
import { formatCurrency } from '@/lib/payment-utils';
import MachineReadingsSection from '@/components/MachineReadingsSection';
import { getLatestCashSnapshots } from '@/lib/cash-snapshot-utils';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

interface SalonOrder {
  id: string;
  order_type: string;
  sale_time: string | null;
  sale_date: string | null;
  payment_method: string;
  total_amount: number;
}

interface ClosingData {
  id: string;
  closing_date: string;
  status: string;
}

export default function SalonClosing() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<SalonOrder[]>([]);
  const [closing, setClosing] = useState<ClosingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [machineReadingsCount, setMachineReadingsCount] = useState(0);
  const [imports, setImports] = useState<any[]>([]);
  const [showImports, setShowImports] = useState(false);
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const [finalizing, setFinalizing] = useState(false);

  // Cash calculator state - Abertura
  const CASH_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.50, 0.25, 0.10, 0.05];
  const [showCashCalcAbertura, setShowCashCalcAbertura] = useState(false);
  const [cashCountsAbertura, setCashCountsAbertura] = useState<Record<number, number>>({});
  const cashTotalAbertura = useMemo(() => CASH_DENOMINATIONS.reduce((sum, d) => sum + d * (cashCountsAbertura[d] || 0), 0), [cashCountsAbertura]);
  const [cashSnapshotSavedAbertura, setCashSnapshotSavedAbertura] = useState(false);
  const [cashSnapshotDataAbertura, setCashSnapshotDataAbertura] = useState<{ counts: Record<string, number>; total: number; updated_at: string } | null>(null);
  const [savingCashAbertura, setSavingCashAbertura] = useState(false);
  const [expectedCash, setExpectedCash] = useState<{ counts: Record<string, number>; total: number } | null>(null);

  // Cash calculator state - Fechamento
  const [showCashCalcFechamento, setShowCashCalcFechamento] = useState(false);
  const [cashCountsFechamento, setCashCountsFechamento] = useState<Record<number, number>>({});
  const cashTotalFechamento = useMemo(() => CASH_DENOMINATIONS.reduce((sum, d) => sum + d * (cashCountsFechamento[d] || 0), 0), [cashCountsFechamento]);
  const [cashSnapshotSavedFechamento, setCashSnapshotSavedFechamento] = useState(false);
  const [cashSnapshotDataFechamento, setCashSnapshotDataFechamento] = useState<{ counts: Record<string, number>; total: number; updated_at: string } | null>(null);
  const [savingCashFechamento, setSavingCashFechamento] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  const loadData = async () => {
    const [{ data: closingData }, { data: ordersData }, { data: machineData }, { data: importsData }] = await Promise.all([
      supabase.from('salon_closings').select('*').eq('id', id!).single(),
      supabase.from('salon_orders').select('*').eq('salon_closing_id', id!).order('sale_time', { ascending: true }),
      supabase.from('machine_readings').select('id').eq('salon_closing_id', id!),
      supabase.from('salon_imports').select('*').eq('salon_closing_id', id!).order('created_at', { ascending: false }),
    ]);
    setClosing(closingData as ClosingData | null);
    setOrders((ordersData as SalonOrder[]) || []);
    setMachineReadingsCount((machineData || []).length);
    setImports(importsData || []);

    // Load saved cash snapshots
    if (id) {
      const { data: snapList } = await supabase
        .from('cash_snapshots')
        .select('counts, total, updated_at, snapshot_type')
        .eq('salon_closing_id', id)
        .order('updated_at', { ascending: false });

      setCashSnapshotDataAbertura(null);
      setCashSnapshotSavedAbertura(false);
      setCashCountsAbertura({});
      setCashSnapshotDataFechamento(null);
      setCashSnapshotSavedFechamento(false);
      setCashCountsFechamento({});

      const latestSnapshots = getLatestCashSnapshots(snapList || []);

      if (latestSnapshots.abertura) {
        const counts = latestSnapshots.abertura.counts as Record<string, number>;
        const restored: Record<number, number> = {};
        for (const [k, v] of Object.entries(counts)) {
          restored[parseFloat(k)] = v;
        }
        setCashSnapshotDataAbertura({
          counts,
          total: Number(latestSnapshots.abertura.total),
          updated_at: latestSnapshots.abertura.updated_at,
        });
        setCashSnapshotSavedAbertura(true);
        setCashCountsAbertura(restored);
      }

      if (latestSnapshots.fechamento) {
        const counts = latestSnapshots.fechamento.counts as Record<string, number>;
        const restored: Record<number, number> = {};
        for (const [k, v] of Object.entries(counts)) {
          restored[parseFloat(k)] = v;
        }
        setCashSnapshotDataFechamento({
          counts,
          total: Number(latestSnapshots.fechamento.total),
          updated_at: latestSnapshots.fechamento.updated_at,
        });
        setCashSnapshotSavedFechamento(true);
        setCashCountsFechamento(restored);
      }
    }

    // Load admin's expected cash for salon sector
    if (closingData?.closing_date) {
      const { data: expectation } = await supabase
        .from('cash_expectations')
        .select('counts, total')
        .eq('closing_date', closingData.closing_date)
        .eq('sector', 'salao')
        .maybeSingle();

      if (expectation) {
        setExpectedCash({
          counts: expectation.counts as Record<string, number>,
          total: Number(expectation.total),
        });
      }
    }

    setLoading(false);
  };

  const saveCashSnapshot = useCallback(async (
    snapshotType: 'abertura' | 'fechamento',
    counts: Record<number, number>,
    total: number,
  ) => {
    if (!id || !user) return { error: new Error('Missing closing or user') };

    const countsJson: Record<string, number> = {};
    for (const [k, v] of Object.entries(counts)) {
      if (v > 0) countsJson[k] = v;
    }

    const now = new Date().toISOString();
    const basePayload = {
      salon_closing_id: id,
      user_id: user.id,
      counts: countsJson,
      total,
      updated_at: now,
      snapshot_type: snapshotType,
    };

    const { data: existingSnapshot, error: fetchError } = await supabase
      .from('cash_snapshots')
      .select('id')
      .eq('salon_closing_id', id)
      .eq('user_id', user.id)
      .eq('snapshot_type', snapshotType)
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      return { error: fetchError };
    }

    if (existingSnapshot?.id) {
      const { error } = await supabase
        .from('cash_snapshots')
        .update(basePayload)
        .eq('id', existingSnapshot.id);

      return { error, countsJson, updatedAt: now };
    }

    const { error } = await supabase
      .from('cash_snapshots')
      .insert(basePayload);

    return { error, countsJson, updatedAt: now };
  }, [id, user]);

  const handleSaveCashSnapshotAbertura = useCallback(async () => {
    setSavingCashAbertura(true);
    const result = await saveCashSnapshot('abertura', cashCountsAbertura, cashTotalAbertura);

    if (result.error) {
      toast.error('Erro ao salvar contagem de abertura.');
    } else {
      setCashSnapshotSavedAbertura(true);
      setCashSnapshotDataAbertura({ counts: result.countsJson || {}, total: cashTotalAbertura, updated_at: result.updatedAt || new Date().toISOString() });
      toast.success(`Contagem abertura salva: ${formatCurrency(cashTotalAbertura)}`);
      setShowCashCalcAbertura(false);
    }

    setSavingCashAbertura(false);
  }, [saveCashSnapshot, cashCountsAbertura, cashTotalAbertura]);

  const handleSaveCashSnapshotFechamento = useCallback(async () => {
    setSavingCashFechamento(true);
    const result = await saveCashSnapshot('fechamento', cashCountsFechamento, cashTotalFechamento);

    if (result.error) {
      toast.error('Erro ao salvar contagem de fechamento.');
    } else {
      setCashSnapshotSavedFechamento(true);
      setCashSnapshotDataFechamento({ counts: result.countsJson || {}, total: cashTotalFechamento, updated_at: result.updatedAt || new Date().toISOString() });
      toast.success(`Contagem fechamento salva: ${formatCurrency(cashTotalFechamento)}`);
      setShowCashCalcFechamento(false);
    }

    setSavingCashFechamento(false);
  }, [saveCashSnapshot, cashCountsFechamento, cashTotalFechamento]);

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  const orderTypes = useMemo(() => [...new Set(orders.map(o => o.order_type))].sort(), [orders]);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (search) {
        const s = search.toLowerCase();
        if (!o.order_type.toLowerCase().includes(s) &&
            !(o.sale_time || '').includes(s) &&
            !o.payment_method.toLowerCase().includes(s)) return false;
      }
      if (filterType && filterType !== '__all__' && o.order_type !== filterType) return false;
      return true;
    });
  }, [orders, search, filterType]);

  const totalAmount = useMemo(() => filtered.reduce((sum, o) => sum + o.total_amount, 0), [filtered]);

  // Build display rows: split rateio into separate lines
  const displayRows = useMemo(() => {
    const rows: { orderId: string; order_type: string; sale_time: string | null; payment_method: string; amount: number; isRateio: boolean; rateioIndex: number; rateioTotal: number }[] = [];
    filtered.forEach(order => {
      const methods = order.payment_method.split(',').map(s => s.trim()).filter(Boolean);
      if (methods.length > 1) {
        const splitAmount = Math.round((order.total_amount / methods.length) * 100) / 100;
        methods.forEach((method, i) => {
          const amount = i === methods.length - 1
            ? Math.round((order.total_amount - splitAmount * (methods.length - 1)) * 100) / 100
            : splitAmount;
          rows.push({
            orderId: order.id, order_type: order.order_type, sale_time: order.sale_time,
            payment_method: method, amount, isRateio: true, rateioIndex: i, rateioTotal: methods.length,
          });
        });
      } else {
        rows.push({
          orderId: order.id, order_type: order.order_type, sale_time: order.sale_time,
          payment_method: methods[0] || order.payment_method, amount: order.total_amount,
          isRateio: false, rateioIndex: 0, rateioTotal: 1,
        });
      }
    });
    return rows;
  }, [filtered]);

  // Payment summary from Saipos data
  const OFFLINE_CATEGORIES = ['(COBRAR) Pix', 'Crédito', 'Débito', 'Voucher'] as const;

  const { offlineMethodTotals, onlineCategories } = useMemo(() => {
    const totals: Record<string, number> = {};
    OFFLINE_CATEGORIES.forEach(c => totals[c] = 0);
    const onlineMap: Record<string, number> = {};

    displayRows.forEach(r => {
      const pm = (r.payment_method || '');
      const pmLower = pm.toLowerCase();
      const isOnline = pmLower.includes('online') || pmLower.includes('(pago)') || pmLower.includes('pago online');

      if (isOnline) {
        if (!onlineMap[pm]) onlineMap[pm] = 0;
        onlineMap[pm] += r.amount;
      } else if (pmLower.includes('dinheiro')) {
        totals['Dinheiro'] += r.amount;
      } else if (pmLower.includes('pix')) {
        totals['(COBRAR) Pix'] += r.amount;
      } else if (pmLower.includes('créd') || pmLower.includes('cred')) {
        totals['Crédito'] += r.amount;
      } else if (pmLower.includes('déb') || pmLower.includes('deb')) {
        totals['Débito'] += r.amount;
      } else if (pmLower.includes('voucher') || pmLower.includes('vale') || pmLower.includes('vr') || pmLower.includes('va')) {
        totals['Voucher'] += r.amount;
      }
    });

    const onlineSorted = Object.entries(onlineMap).sort((a, b) => b[1] - a[1]);
    return { offlineMethodTotals: totals, onlineCategories: onlineSorted };
  }, [displayRows]);

  const getOrderTypeBadge = (orderType: string) => {
    const isNumber = /^\d+$/.test(orderType.trim());
    if (orderType.toLowerCase() === 'ficha') return <Badge className="bg-foreground text-background border-transparent text-xs">Ficha</Badge>;
    if (isNumber) return <Badge className="bg-foreground text-warning border-transparent text-xs">Retirada</Badge>;
    if (orderType.toLowerCase() === 'salão' || orderType.toLowerCase() === 'salao') return <Badge className="bg-warning text-foreground border-transparent text-xs">Salão</Badge>;
    return <Badge variant="outline" className="text-xs">{orderType}</Badge>;
  };

  const getFilterLabel = (t: string) => {
    if (t.toLowerCase() === 'ficha') return 'Ficha';
    if (/^\d+$/.test(t.trim())) return 'Retirada';
    if (t.toLowerCase() === 'salão' || t.toLowerCase() === 'salao') return 'Salão';
    return t;
  };

  if (loading) {
    return (
      <AppLayout title="Carregando...">
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </AppLayout>
    );
  }

  if (!closing) {
    return (
      <AppLayout title="Não encontrado">
        <p className="text-muted-foreground">Fechamento não encontrado.</p>
      </AppLayout>
    );
  }

  const isCompleted = closing?.status === 'completed';

  // Validation for Conciliação button
  const validationAlerts: string[] = [];
  if (!cashSnapshotSavedAbertura) validationAlerts.push('Preencha a contagem de abertura');
  if (!cashSnapshotSavedFechamento) validationAlerts.push('Preencha a contagem de fechamento');
  if (machineReadingsCount === 0) validationAlerts.push('Adicione ao menos uma maquininha');
  const canNavigateReconciliation = validationAlerts.length === 0;
  const canFinalize = canNavigateReconciliation;

  const handleFinalize = async () => {
    if (!id) return;
    setFinalizing(true);
    const { error } = await supabase
      .from('salon_closings')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      toast.error('Erro ao finalizar fechamento.');
    } else {
      setClosing(prev => prev ? { ...prev, status: 'completed' } : prev);
      toast.success('Fechamento finalizado com sucesso!');
    }
    setFinalizing(false);
  };

  const handleReopen = async () => {
    if (!id) return;
    setFinalizing(true);
    const { error } = await supabase
      .from('salon_closings')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      toast.error('Erro ao reabrir fechamento.');
    } else {
      setClosing(prev => prev ? { ...prev, status: 'pending' } : prev);
      toast.success('Fechamento reaberto.');
    }
    setFinalizing(false);
  };

  const handleDeleteSelectedImports = async () => {
    const importIds = Array.from(selectedImports);
    if (importIds.length === 0) return;

    const { data: ordersToDelete } = await supabase
      .from('salon_orders')
      .select('id')
      .in('salon_import_id', importIds);

    if (ordersToDelete?.length) {
      const orderIds = ordersToDelete.map(o => o.id);
      await supabase.from('salon_order_payments').delete().in('salon_order_id', orderIds);
      await supabase.from('salon_orders').delete().in('salon_import_id', importIds);
    }
    await supabase.from('salon_imports').delete().in('id', importIds);

    setSelectedImports(new Set());
    toast.success(`${importIds.length} importação(ões) excluída(s)`);
    loadData();
  };

  return (
    <AppLayout
      title={`Salão — ${formatDate(closing.closing_date)}`}
      subtitle={`${orders.length} pedidos`}
      headerActions={
        <div className="flex items-center gap-2">
          {isCompleted ? (
            isAdmin && (
              <Button variant="outline" onClick={handleReopen} disabled={finalizing}>
                <Unlock className="h-4 w-4 mr-1" />
                {finalizing ? 'Reabrindo...' : 'Reabrir Fechamento'}
              </Button>
            )
          ) : (
            <div className="relative group">
              <Button
                variant="default"
                onClick={handleFinalize}
                disabled={(!canFinalize && !isAdmin) || finalizing}
              >
                <Lock className="h-4 w-4 mr-1" />
                {finalizing ? 'Finalizando...' : 'Finalizar Fechamento'}
              </Button>
              {!canFinalize && !isAdmin && (
                <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block bg-destructive/10 border border-destructive/30 rounded-lg p-2 min-w-[250px]">
                  {validationAlerts.map((alert, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-destructive py-0.5">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {alert}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {isAdmin && (
            <div className="relative group">
              <Button
                variant="secondary"
                onClick={() => navigate(`/salon/reconciliation/${id}`)}
              >
                Conciliação Salão
              </Button>
              {!canNavigateReconciliation && (
                <div className="absolute right-0 top-full mt-1 z-50 hidden group-hover:block bg-destructive/10 border border-destructive/30 rounded-lg p-2 min-w-[250px]">
                  {validationAlerts.map((alert, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-destructive py-0.5">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {alert}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <Button variant="outline" onClick={() => navigate('/salon')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>
        </div>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-card rounded-xl shadow-card p-4 border border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Total Vendas</p>
          <p className="text-2xl font-bold text-foreground">
            R$ {totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-card rounded-xl shadow-card p-4 border border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Pedidos</p>
          <p className="text-2xl font-bold text-foreground">{filtered.length}</p>
        </div>
        <div className="bg-card rounded-xl shadow-card p-4 border border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Status</p>
          <Badge className={isCompleted ? 'bg-success text-success-foreground' : 'bg-warning/15 text-warning border-warning/30'}>
            {isCompleted ? 'Concluído' : 'Pendente'}
          </Badge>
        </div>
      </div>

      {/* Cash Snapshot - Abertura */}
      <div className="bg-card rounded-xl shadow-card border border-border p-4 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-success" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Contagem de Dinheiro na Abertura</span>
          </div>
          {cashSnapshotSavedAbertura ? (
            <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />Salvo</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-warning"><AlertCircle className="h-3.5 w-3.5" />Não salvo</span>
          )}
        </div>
        {cashSnapshotDataAbertura ? (
          <div className="mt-2 flex items-center gap-4">
            <span className="text-lg font-bold text-foreground font-mono">{formatCurrency(cashSnapshotDataAbertura.total)}</span>
            <span className="text-xs text-muted-foreground">Salvo em {new Date(cashSnapshotDataAbertura.updated_at).toLocaleString('pt-BR')}</span>
            <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setShowCashCalcAbertura(true)}>
              <Calculator className="h-3.5 w-3.5 mr-1" />Ver detalhes
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Nenhuma contagem salva ainda.</span>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowCashCalcAbertura(true)}>
              <Calculator className="h-3.5 w-3.5 mr-1" />Abrir Calculadora
            </Button>
          </div>
        )}
      </div>

      {/* Cash Snapshot - Fechamento */}
      <div className="bg-card rounded-xl shadow-card border border-border p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Contagem de Dinheiro no Fechamento</span>
          </div>
          {cashSnapshotSavedFechamento ? (
            <span className="flex items-center gap-1 text-xs text-success"><CheckCircle2 className="h-3.5 w-3.5" />Salvo</span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-warning"><AlertCircle className="h-3.5 w-3.5" />Não salvo</span>
          )}
        </div>
        {cashSnapshotDataFechamento ? (
          <div className="mt-2 flex items-center gap-4">
            <span className="text-lg font-bold text-foreground font-mono">{formatCurrency(cashSnapshotDataFechamento.total)}</span>
            <span className="text-xs text-muted-foreground">Salvo em {new Date(cashSnapshotDataFechamento.updated_at).toLocaleString('pt-BR')}</span>
            <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setShowCashCalcFechamento(true)}>
              <Calculator className="h-3.5 w-3.5 mr-1" />Ver detalhes
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Nenhuma contagem salva ainda.</span>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowCashCalcFechamento(true)}>
              <Calculator className="h-3.5 w-3.5 mr-1" />Abrir Calculadora
            </Button>
          </div>
        )}
      </div>

      {/* Machine Readings */}
      {id && (
        <div className="bg-card rounded-xl shadow-card border border-border mb-6 overflow-hidden">
          <MachineReadingsSection
            salonClosingId={id}
            deliveryPersons={[]}
            isCompleted={isCompleted}
            personLabel="Garçom"
          />
        </div>
      )}

      {/* Payment Totals */}
      <div className="bg-card rounded-xl shadow-card border border-border p-4 mb-6">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Total Teórico via Saipos</p>
        <div className="flex flex-wrap gap-3">
          {OFFLINE_CATEGORIES.map(cat => {
            const total = offlineMethodTotals[cat];
            const iconMap: Record<string, React.ReactNode> = {
              'Dinheiro': <Banknote className="h-4 w-4 text-success" />,
              '(COBRAR) Pix': <QrCode className="h-4 w-4 text-primary" />,
              'Crédito': <CreditCard className="h-4 w-4 text-accent-foreground" />,
              'Débito': <CreditCard className="h-4 w-4 text-muted-foreground" />,
              'Voucher': <CreditCard className="h-4 w-4 text-warning" />,
            };
            return (
              <div key={cat} className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[150px]">
                {iconMap[cat]}
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">{cat}</p>
                  <p className="text-sm font-semibold text-foreground font-mono">{formatCurrency(total)}</p>
                </div>
              </div>
            );
          })}
          {onlineCategories.map(([name, total]) => (
            <div key={name} className="flex items-center gap-2 bg-primary/5 rounded-lg px-3 py-2 border border-primary/20 min-w-[150px]">
              <Globe className="h-4 w-4 text-primary" />
              <div>
                <p className="text-[10px] text-primary/70 leading-tight">{name}</p>
                <p className="text-sm font-semibold text-foreground font-mono">{formatCurrency(total)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Validation alerts */}
      {validationAlerts.length > 0 && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-3 mb-4 space-y-1">
          {validationAlerts.map((alert, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {alert}
            </div>
          ))}
        </div>
      )}

      {/* Import History */}
      <div className="bg-card rounded-xl shadow-card border border-border mb-4 overflow-hidden">
        <button
          className="w-full flex items-center gap-2 px-4 py-3 hover:bg-muted/50 transition-colors"
          onClick={() => setShowImports(!showImports)}
        >
          {showImports ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Histórico de Importações
          </span>
          <span className="text-xs text-muted-foreground">({imports.length})</span>
        </button>
        {showImports && (
          <div className="border-t border-border px-4 py-3 space-y-2">
            {imports.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma importação encontrada.</p>
            ) : (
              <>
                {imports.map((imp) => (
                  <div key={imp.id} className="flex items-center gap-3 bg-muted/30 rounded-lg px-3 py-2">
                    <Checkbox
                      checked={selectedImports.has(imp.id)}
                      onCheckedChange={(checked) => {
                        setSelectedImports(prev => {
                          const next = new Set(prev);
                          checked ? next.add(imp.id) : next.delete(imp.id);
                          return next;
                        });
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground truncate">{imp.file_name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {imp.total_rows} lidos · {imp.new_rows} novos · {imp.duplicate_rows} duplicados
                        {' · '}
                        {new Date(imp.created_at).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[10px]">{imp.status}</Badge>
                  </div>
                ))}
                {selectedImports.size > 0 && (
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                    <span className="text-xs text-muted-foreground">{selectedImports.size} selecionada(s)</span>
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSelectedImports(new Set())}>
                      Cancelar
                    </Button>
                    <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={handleDeleteSelectedImports}>
                      <Trash2 className="h-3 w-3 mr-1" />
                      Apagar
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Todos os tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os tipos</SelectItem>
            {orderTypes.map(t => (
              <SelectItem key={t} value={t}>{getFilterLabel(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table - Read-only */}
      <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Tipo</TableHead>
                <TableHead className="w-[60px]">Hora</TableHead>
                <TableHead>Pgto Saipos</TableHead>
                <TableHead className="text-right w-[120px]">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    Nenhum pedido encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                displayRows.map((row, idx) => (
                  <TableRow key={`${row.orderId}-${row.rateioIndex}`} className={row.isRateio && row.rateioIndex > 0 ? 'border-t-0' : ''}>
                    <TableCell>
                      {row.rateioIndex === 0 ? getOrderTypeBadge(row.order_type) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.rateioIndex === 0 ? (row.sale_time || '—') : null}
                    </TableCell>
                    <TableCell className="text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-foreground">{row.payment_method}</span>
                        {row.isRateio && (
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-muted-foreground border-muted-foreground/30">
                            {row.rateioIndex + 1}/{row.rateioTotal}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-sm">
                      R$ {row.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Cash Calculator Dialog - Abertura */}
      <Dialog open={showCashCalcAbertura} onOpenChange={setShowCashCalcAbertura}>
        <DialogContent className={expectedCash ? "sm:max-w-2xl" : "sm:max-w-md"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Calculadora de Dinheiro — Abertura (Salão)
            </DialogTitle>
            {expectedCash && (
              <p className="text-xs text-muted-foreground mt-1">
                Valores esperados definidos pelo administrador estão exibidos ao lado.
              </p>
            )}
          </DialogHeader>
          <div className="space-y-2">
            <div className={`grid ${expectedCash ? 'grid-cols-[1fr_80px_1fr_1fr]' : 'grid-cols-[1fr_80px_1fr]'} gap-2 items-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-1`}>
              <span>Cédula/Moeda</span><span className="text-center">Qtd</span><span className="text-right">Subtotal</span>
              {expectedCash && <span className="text-right text-warning">Esperado</span>}
            </div>
            {CASH_DENOMINATIONS.map(denom => {
              const expectedCount = expectedCash?.counts?.[String(denom)] || 0;
              const expectedSubtotal = denom * expectedCount;
              const actualSubtotal = denom * (cashCountsAbertura[denom] || 0);
              return (
                <div key={denom} className={`grid ${expectedCash ? 'grid-cols-[1fr_80px_1fr_1fr]' : 'grid-cols-[1fr_80px_1fr]'} gap-2 items-center`}>
                  <span className="text-sm font-medium text-foreground">{formatCurrency(denom)}</span>
                  <Input type="number" min={0} value={cashCountsAbertura[denom] || ''} onChange={(e) => setCashCountsAbertura(prev => ({ ...prev, [denom]: Math.max(0, parseInt(e.target.value) || 0) }))} className="h-8 text-center text-sm" placeholder="0" />
                  <span className="text-sm text-right font-mono text-foreground">{formatCurrency(actualSubtotal)}</span>
                  {expectedCash && (
                    <span className={`text-sm text-right font-mono ${expectedCount > 0 ? (actualSubtotal === expectedSubtotal ? 'text-success' : 'text-warning') : 'text-muted-foreground'}`}>
                      {expectedCount > 0 ? `${expectedCount}× = ${formatCurrency(expectedSubtotal)}` : '—'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="border-t border-border pt-3 mt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Total em espécie:</span>
              <span className="text-xl font-bold text-primary font-mono">{formatCurrency(cashTotalAbertura)}</span>
            </div>
            {expectedCash && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-muted-foreground">Total esperado (admin):</span>
                <span className={`text-sm font-medium font-mono ${Math.abs(cashTotalAbertura - expectedCash.total) < 0.01 ? 'text-success' : 'text-warning'}`}>
                  {formatCurrency(expectedCash.total)}
                </span>
              </div>
            )}
            {expectedCash && cashTotalAbertura > 0 && Math.abs(cashTotalAbertura - expectedCash.total) >= 0.01 && (
              <div className="mt-2 bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 text-xs text-warning">
                ⚠️ Diferença de {formatCurrency(Math.abs(cashTotalAbertura - expectedCash.total))} entre o valor contado e o esperado.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCashCountsAbertura({})}>Limpar</Button>
            <Button size="sm" onClick={handleSaveCashSnapshotAbertura} disabled={savingCashAbertura}>
              {savingCashAbertura ? 'Salvando...' : cashSnapshotSavedAbertura ? 'Atualizar Contagem' : 'Salvar Contagem'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cash Calculator Dialog - Fechamento */}
      <Dialog open={showCashCalcFechamento} onOpenChange={setShowCashCalcFechamento}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Calculadora de Dinheiro — Fechamento (Salão)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
              <span>Cédula/Moeda</span><span className="text-center">Qtd</span><span className="text-right">Subtotal</span>
            </div>
            {CASH_DENOMINATIONS.map(denom => (
              <div key={denom} className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center">
                <span className="text-sm font-medium text-foreground">{formatCurrency(denom)}</span>
                <Input type="number" min={0} value={cashCountsFechamento[denom] || ''} onChange={(e) => setCashCountsFechamento(prev => ({ ...prev, [denom]: Math.max(0, parseInt(e.target.value) || 0) }))} className="h-8 text-center text-sm" placeholder="0" />
                <span className="text-sm text-right font-mono text-foreground">{formatCurrency(denom * (cashCountsFechamento[denom] || 0))}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-3 mt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Total em espécie:</span>
              <span className="text-xl font-bold text-primary font-mono">{formatCurrency(cashTotalFechamento)}</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCashCountsFechamento({})}>Limpar</Button>
            <Button size="sm" onClick={handleSaveCashSnapshotFechamento} disabled={savingCashFechamento}>
              {savingCashFechamento ? 'Salvando...' : cashSnapshotSavedFechamento ? 'Atualizar Contagem' : 'Salvar Contagem'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
