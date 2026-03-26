import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ArrowLeft, Upload, Search, CheckCircle2, AlertTriangle, Link2, Unlink,
  CreditCard, Clock, GripVertical, Undo2, FileSpreadsheet, Store,
  ShieldCheck, RotateCcw, Banknote, DollarSign, Globe, QrCode, Wallet,
  ChevronUp, ChevronDown,
} from 'lucide-react';
import MachineReadingsSection from '@/components/MachineReadingsSection';
import { toast } from 'sonner';
import AppSidebar from '@/components/AppSidebar';
import { parseSalonCardTransactionFile } from '@/lib/card-transaction-parser';
import { matchSalonTransactionsToOrders, classifyOrder, type OrderClassification, type PendingReason } from '@/lib/salon-matching';
import { formatCurrency } from '@/lib/payment-utils';
import { buildWaiterMap } from '@/lib/waiter-labels';
import { useUserRole } from '@/hooks/useUserRole';
import { getLatestCashSnapshots } from '@/lib/cash-snapshot-utils';

interface SalonOrder {
  id: string;
  order_type: string;
  sale_time: string | null;
  total_amount: number;
  payment_method: string;
  discount_amount: number;
}

interface SalonPayment {
  salon_order_id: string;
  payment_method: string;
  amount: number;
}

interface SalonCardTx {
  id: string;
  sale_date: string | null;
  sale_time: string | null;
  payment_method: string;
  brand: string | null;
  gross_amount: number;
  net_amount: number;
  machine_serial: string | null;
  transaction_id: string | null;
  matched_order_id: string | null;
  match_type: string | null;
  match_confidence: string | null;
}

interface UndoAction {
  type: 'match' | 'unmatch';
  transactionId: string;
  orderId: string;
  previousMatchType: string | null;
  previousConfidence: string | null;
}

const PENDING_REASON_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  external_cash: { label: 'Pagamento em Dinheiro', icon: <DollarSign className="h-3 w-3" />, color: 'bg-muted text-muted-foreground' },
  external_online: { label: 'Pagamento Online/Externo', icon: <Globe className="h-3 w-3" />, color: 'bg-muted text-muted-foreground' },
  mixed_partial: { label: 'Pgto misto (parte cartão)', icon: <CreditCard className="h-3 w-3" />, color: 'bg-primary/10 text-primary' },
  awaiting_group_2: { label: 'Aguardando grupo de 2 linhas', icon: <AlertTriangle className="h-3 w-3" />, color: 'bg-warning/10 text-warning' },
  awaiting_group_3: { label: 'Aguardando grupo de 3 linhas', icon: <AlertTriangle className="h-3 w-3" />, color: 'bg-warning/10 text-warning' },
  awaiting_group_4: { label: 'Aguardando grupo de 4+ linhas', icon: <AlertTriangle className="h-3 w-3" />, color: 'bg-warning/10 text-warning' },
  approx_possible: { label: 'Match aproximado possível', icon: <Search className="h-3 w-3" />, color: 'bg-accent text-accent-foreground' },
  divergence: { label: 'Divergência real', icon: <AlertTriangle className="h-3 w-3" />, color: 'bg-destructive/10 text-destructive' },
};

export default function SalonReconciliation() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const navigate = useNavigate();

  const [orders, setOrders] = useState<SalonOrder[]>([]);
  const [payments, setPayments] = useState<SalonPayment[]>([]);
  const [transactions, setTransactions] = useState<SalonCardTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [closingDate, setClosingDate] = useState('');
  const [reconciliationStatus, setReconciliationStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [filterMatch, setFilterMatch] = useState('all');
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [dragTxId, setDragTxId] = useState<string | null>(null);
  const [cashSnapshotAbertura, setCashSnapshotAbertura] = useState<{ total: number; updated_at: string } | null>(null);
  const [cashSnapshotFechamento, setCashSnapshotFechamento] = useState<{ total: number; updated_at: string } | null>(null);
  const [orderClassifications, setOrderClassifications] = useState<Map<string, OrderClassification>>(new Map());
  const [showCashDetailsAbertura, setShowCashDetailsAbertura] = useState(false);
  const [showCashDetailsFechamento, setShowCashDetailsFechamento] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  const loadData = async () => {
    const [{ data: closing }, { data: ordData }, { data: txData }] = await Promise.all([
      supabase.from('salon_closings').select('closing_date, reconciliation_status').eq('id', id!).single(),
      supabase.from('salon_orders').select('id, order_type, sale_time, total_amount, payment_method, discount_amount').eq('salon_closing_id', id!),
      supabase.from('salon_card_transactions').select('*').eq('salon_closing_id', id!),
    ]);

    setClosingDate(closing?.closing_date || '');
    setReconciliationStatus(closing?.reconciliation_status || 'pending');
    const ordersList = (ordData || []).map((o: any) => ({
      ...o,
      discount_amount: Number(o.discount_amount || 0),
    })) as SalonOrder[];
    setOrders(ordersList);
    setTransactions((txData || []) as SalonCardTx[]);

    if (ordersList.length > 0) {
      const orderIds = ordersList.map(o => o.id);
      const { data: payData } = await supabase
        .from('salon_order_payments')
        .select('salon_order_id, payment_method, amount')
        .in('salon_order_id', orderIds);
      setPayments((payData || []).map(p => ({ ...p, amount: Number(p.amount) })));
    }

    // Classify orders
    const clsMap = new Map<string, OrderClassification>();
    for (const o of ordersList) {
      clsMap.set(o.id, classifyOrder({
        id: o.id, order_type: o.order_type, total_amount: o.total_amount,
        discount_amount: o.discount_amount, sale_time: o.sale_time, payment_method: o.payment_method,
      }));
    }
    setOrderClassifications(clsMap);

    // Load cash snapshots
    if (id) {
      const { data: snapList } = await supabase
        .from('cash_snapshots')
        .select('total, updated_at, snapshot_type')
        .eq('salon_closing_id', id)
        .order('updated_at', { ascending: false });

      setCashSnapshotAbertura(null);
      setCashSnapshotFechamento(null);
      const latestSnapshots = getLatestCashSnapshots(snapList || []);

      if (latestSnapshots.abertura) {
        setCashSnapshotAbertura({
          total: Number(latestSnapshots.abertura.total),
          updated_at: latestSnapshots.abertura.updated_at,
        });
      }

      if (latestSnapshots.fechamento) {
        setCashSnapshotFechamento({
          total: Number(latestSnapshots.fechamento.total),
          updated_at: latestSnapshots.fechamento.updated_at,
        });
      }
    }

    setLoading(false);
  };

  const eligibleOrders = useMemo(() => orders, [orders]);

  const matchedOrderIds = useMemo(() => {
    const map = new Map<string, SalonCardTx[]>();
    transactions.forEach(tx => {
      if (tx.matched_order_id) {
        const arr = map.get(tx.matched_order_id) || [];
        arr.push(tx);
        map.set(tx.matched_order_id, arr);
      }
    });
    return map;
  }, [transactions]);

  const unmatchedTransactions = useMemo(() =>
    transactions.filter(tx => !tx.matched_order_id), [transactions]);

  const waiterMap = useMemo(() =>
    buildWaiterMap(transactions.map(tx => tx.machine_serial)), [transactions]);

  const stats = useMemo(() => {
    const machineOrders = eligibleOrders.filter(o => {
      const cls = orderClassifications.get(o.id);
      return !cls?.isExternal;
    });
    const externalOrders = eligibleOrders.filter(o => {
      const cls = orderClassifications.get(o.id);
      return cls?.isExternal;
    });
    const matched = machineOrders.filter(o => matchedOrderIds.has(o.id)).length;
    return {
      total: eligibleOrders.length,
      machineTotal: machineOrders.length,
      matched,
      pending: machineOrders.length - matched,
      external: externalOrders.length,
      txTotal: transactions.length,
      txUnmatched: unmatchedTransactions.length,
    };
  }, [eligibleOrders, matchedOrderIds, transactions, unmatchedTransactions, orderClassifications]);

  const filtered = useMemo(() => {
    return eligibleOrders.filter(o => {
      if (search) {
        const s = search.toLowerCase();
        if (!o.order_type.toLowerCase().includes(s) && !(o.sale_time || '').includes(s) && !o.payment_method.toLowerCase().includes(s)) return false;
      }
      const cls = orderClassifications.get(o.id);
      if (filterMatch === 'matched' && !matchedOrderIds.has(o.id)) return false;
      if (filterMatch === 'unmatched' && (matchedOrderIds.has(o.id) || cls?.isExternal)) return false;
      if (filterMatch === 'external' && !cls?.isExternal) return false;
      return true;
    });
  }, [eligibleOrders, search, filterMatch, matchedOrderIds, orderClassifications]);

  const OFFLINE_CATEGORIES = ['(COBRAR) Pix', 'Crédito', 'Débito', 'Voucher'] as const;

  const offlineMethodTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    OFFLINE_CATEGORIES.forEach(c => totals[c] = 0);

    const matchCategory = (methodName: string): string | null => {
      const lower = methodName.toLowerCase().trim();
      if (lower.includes('online') || lower.includes('ifood') || lower.includes('anotaai')) return null;
      if (lower === 'dinheiro') return null;
      if (lower.includes('(cobrar) pix') || lower === 'pix') return '(COBRAR) Pix';
      if (lower.includes('crédit') || lower.includes('crédito') || lower === 'credito') return 'Crédito';
      if (lower.includes('débit') || lower.includes('débito') || lower === 'debito') return 'Débito';
      if (lower.includes('voucher') && !lower.includes('voucher parceiro')) return 'Voucher';
      return null;
    };

    const paymentsByOrder = new Map<string, SalonPayment[]>();
    payments.forEach(p => {
      if (!paymentsByOrder.has(p.salon_order_id)) paymentsByOrder.set(p.salon_order_id, []);
      paymentsByOrder.get(p.salon_order_id)!.push(p);
    });

    for (const order of orders) {
      const orderPayments = paymentsByOrder.get(order.id);
      if (orderPayments && orderPayments.length > 0) {
        for (const p of orderPayments) {
          const cat = matchCategory(p.payment_method);
          if (cat) totals[cat] += p.amount;
        }
      } else {
        const methods = order.payment_method.split(',').map(m => m.trim()).filter(Boolean);
        if (methods.length === 1) {
          const cat = matchCategory(methods[0]);
          if (cat) totals[cat] += order.total_amount;
        }
      }
    }

    return totals;
  }, [orders, payments]);


  const handleImport = useCallback(async (file: File) => {
    if (!user || !id) return;
    setImporting(true);
    try {
      const { transactions: parsed, excludedCount } = await parseSalonCardTransactionFile(file);

      await supabase.from('salon_card_transactions').delete().eq('salon_closing_id', id);

      const batch = parsed.map(t => ({
        salon_closing_id: id,
        user_id: user.id,
        sale_date: t.sale_date || null,
        sale_time: t.sale_time || null,
        payment_method: t.payment_method,
        brand: t.brand || null,
        gross_amount: t.gross_amount,
        net_amount: t.net_amount,
        machine_serial: t.machine_serial || null,
        transaction_id: t.transaction_id || null,
      }));

      const { data: inserted, error } = await supabase
        .from('salon_card_transactions')
        .insert(batch)
        .select('*');

      if (error) throw error;

      const newTxs = (inserted || []) as SalonCardTx[];

      // Auto-matching
      const { results: matchResults, classifications } = matchSalonTransactionsToOrders(
        newTxs.map(tx => ({
          id: tx.id,
          gross_amount: tx.gross_amount,
          payment_method: tx.payment_method,
          machine_serial: tx.machine_serial || '',
          sale_time: tx.sale_time || '',
        })),
        orders.map(o => ({
          id: o.id,
          order_type: o.order_type,
          total_amount: o.total_amount,
          discount_amount: o.discount_amount,
          sale_time: o.sale_time,
          payment_method: o.payment_method,
        })),
        payments,
        new Set(),
      );

      setOrderClassifications(classifications);

      for (const match of matchResults) {
        await supabase
          .from('salon_card_transactions')
          .update({
            matched_order_id: match.orderId,
            match_type: match.matchType,
            match_confidence: match.confidence,
          })
          .eq('id', match.transactionId);
      }

      toast.success(
        `${parsed.length} transações importadas (${excludedCount} excluídas). ${matchResults.length} matches automáticos.`
      );

      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao importar transações.');
    } finally {
      setImporting(false);
    }
  }, [user, id, orders, payments]);

  const manualMatch = useCallback(async (transactionId: string, orderId: string) => {
    const tx = transactions.find(t => t.id === transactionId);
    setUndoStack(prev => [...prev, {
      type: 'match', transactionId, orderId,
      previousMatchType: tx?.match_type || null,
      previousConfidence: tx?.match_confidence || null,
    }]);

    await supabase.from('salon_card_transactions')
      .update({ matched_order_id: orderId, match_type: 'manual', match_confidence: 'high' })
      .eq('id', transactionId);

    setTransactions(prev => prev.map(t =>
      t.id === transactionId
        ? { ...t, matched_order_id: orderId, match_type: 'manual', match_confidence: 'high' }
        : t
    ));
    toast.success('Transação vinculada manualmente.');
  }, [transactions]);

  const unmatch = useCallback(async (transactionId: string) => {
    const tx = transactions.find(t => t.id === transactionId);
    if (!tx) return;

    setUndoStack(prev => [...prev, {
      type: 'unmatch', transactionId,
      orderId: tx.matched_order_id || '',
      previousMatchType: tx.match_type,
      previousConfidence: tx.match_confidence,
    }]);

    await supabase.from('salon_card_transactions')
      .update({ matched_order_id: null, match_type: null, match_confidence: null })
      .eq('id', transactionId);

    setTransactions(prev => prev.map(t =>
      t.id === transactionId
        ? { ...t, matched_order_id: null, match_type: null, match_confidence: null }
        : t
    ));
    toast.info('Vínculo desfeito.');
  }, [transactions]);

  const undo = useCallback(async () => {
    const action = undoStack[undoStack.length - 1];
    if (!action) return;

    if (action.type === 'match') {
      await supabase.from('salon_card_transactions')
        .update({ matched_order_id: null, match_type: action.previousMatchType, match_confidence: action.previousConfidence })
        .eq('id', action.transactionId);
      setTransactions(prev => prev.map(t =>
        t.id === action.transactionId
          ? { ...t, matched_order_id: null, match_type: action.previousMatchType, match_confidence: action.previousConfidence }
          : t
      ));
    } else {
      await supabase.from('salon_card_transactions')
        .update({ matched_order_id: action.orderId, match_type: action.previousMatchType, match_confidence: action.previousConfidence })
        .eq('id', action.transactionId);
      setTransactions(prev => prev.map(t =>
        t.id === action.transactionId
          ? { ...t, matched_order_id: action.orderId, match_type: action.previousMatchType, match_confidence: action.previousConfidence }
          : t
      ));
    }

    setUndoStack(prev => prev.slice(0, -1));
    toast.info('Ação desfeita.');
  }, [undoStack]);

  const handleDrop = useCallback((orderId: string) => {
    if (dragTxId) {
      manualMatch(dragTxId, orderId);
      setDragTxId(null);
    }
  }, [dragTxId, manualMatch]);

  const handleFinalizeReconciliation = useCallback(async () => {
    if (!id || !isAdmin) return;
    const { error } = await supabase
      .from('salon_closings')
      .update({ reconciliation_status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) {
      setReconciliationStatus('completed');
      toast.success('Conciliação finalizada com sucesso.');
    } else {
      toast.error('Erro ao finalizar conciliação.');
    }
  }, [id, isAdmin]);

  const handleReopenReconciliation = useCallback(async () => {
    if (!id || !isAdmin) return;
    const { error } = await supabase
      .from('salon_closings')
      .update({ reconciliation_status: 'pending', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) {
      setReconciliationStatus('pending');
      toast.success('Conciliação reaberta com sucesso.');
    } else {
      toast.error('Erro ao reabrir conciliação.');
    }
  }, [id, isAdmin]);

  const formatDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  const getOrderLabel = (orderType: string) => {
    const isNumber = /^\d+$/.test(orderType.trim());
    if (orderType.toLowerCase() === 'ficha') return { label: 'Ficha', cls: 'bg-foreground text-background' };
    if (isNumber) return { label: 'Retirada', cls: 'bg-foreground text-warning' };
    if (orderType.toLowerCase() === 'salão' || orderType.toLowerCase() === 'salao') return { label: 'Salão', cls: 'bg-warning text-foreground' };
    return { label: orderType, cls: '' };
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const percent = stats.machineTotal > 0 ? Math.round((stats.matched / stats.machineTotal) * 100) : 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppSidebar />
      <div className="ml-56 flex flex-col flex-1">
        {/* Header */}
        <header className="border-b border-border bg-card sticky top-0 z-10">
          <div className="px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => navigate(`/salon/closing/${id}`)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-base font-semibold text-foreground">
                  Conciliação do Salão — {formatDate(closingDate)}
                </h1>
                <p className="text-xs text-muted-foreground">
                  Cruzamento de pagamentos do salão com transações da maquininha
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={undo} disabled={undoStack.length === 0}>
                <Undo2 className="h-4 w-4 mr-1" />
                Desfazer
              </Button>
              <div className="relative">
                <Button variant="default" size="sm" className="bg-primary hover:bg-primary/90" disabled={importing}>
                  <Upload className="h-4 w-4 mr-1" />
                  {importing ? 'Importando...' : 'Importar Maquininha'}
                </Button>
                <input
                  type="file"
                  accept=".xlsx"
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImport(file);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>
          </div>
        </header>

        {/* Payment Method Summary */}
        {transactions.length > 0 && (() => {
          const methodSummary = new Map<string, { total: number; count: number }>();
          transactions.forEach(tx => {
            const method = tx.payment_method?.toLowerCase() || 'outro';
            let label = 'Outro';
            if (method.includes('débit') || method.includes('debit')) label = 'Débito';
            else if (method.includes('crédit') || method.includes('credit')) label = 'Crédito';
            else if (method.includes('pix')) label = 'Pix';
            else if (method.includes('voucher')) label = 'Voucher';
            const entry = methodSummary.get(label) || { total: 0, count: 0 };
            entry.total += tx.gross_amount;
            entry.count += 1;
            methodSummary.set(label, entry);
          });
          const sorted = Array.from(methodSummary.entries()).sort((a, b) => b[1].total - a[1].total);
          return (
            <div className="border-b border-border bg-card">
              <div className="px-6 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center flex-wrap gap-3">
                  {sorted.map(([label, { total, count }]) => (
                    <div key={label} className="flex items-center gap-2 bg-secondary rounded-lg px-4 py-2.5 border border-border">
                      <span className="text-sm font-medium text-foreground">{label}:</span>
                      <span className="text-sm font-semibold text-primary font-mono tabular-nums">{formatCurrency(total)}</span>
                      <span className="text-xs text-muted-foreground">({count}x)</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 bg-accent rounded-lg px-4 py-2.5 border border-border shrink-0">
                  <span className="text-sm font-medium text-foreground">Total:</span>
                  <span className="text-sm font-semibold text-foreground font-mono tabular-nums">
                    {formatCurrency(transactions.reduce((s, tx) => s + tx.gross_amount, 0))}
                  </span>
                  <span className="text-xs text-muted-foreground">({transactions.length} operações)</span>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Stats */}
        <div className="border-b border-border bg-card">
          <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-6 gap-3">
            <StatCard label="Total Pedidos" value={stats.total} icon={<Store className="h-4 w-4" />} color="text-foreground" />
            <StatCard label="Conciliados" value={stats.matched} icon={<CheckCircle2 className="h-4 w-4" />} color="text-success" />
            <StatCard label="Pendentes" value={stats.pending} icon={<AlertTriangle className="h-4 w-4" />} color="text-warning" />
            <StatCard label="Fora Maquininha" value={stats.external} icon={<DollarSign className="h-4 w-4" />} color="text-muted-foreground" />
            <StatCard label="Tx Maquininha" value={stats.txTotal} icon={<CreditCard className="h-4 w-4" />} color="text-foreground" />
            <div className="bg-card rounded-lg p-3 border border-border shadow-card">
              <p className="section-title mb-1">Progresso</p>
              <p className="text-2xl font-bold text-foreground font-mono-tabular">{percent}%</p>
              <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${percent}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Cash Snapshots (read-only) */}
        {(cashSnapshotAbertura || cashSnapshotFechamento) && (
          <div className="border-b border-border bg-card">
            <div className="px-6 py-3 flex flex-wrap gap-4">
              {cashSnapshotAbertura && (
                <div className="flex items-center gap-2 bg-muted rounded-lg px-4 py-2.5 border border-border">
                  <Banknote className="h-4 w-4 text-success" />
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">Abertura (Dinheiro)</p>
                    <p className="text-sm font-semibold text-foreground font-mono tabular-nums">{formatCurrency(cashSnapshotAbertura.total)}</p>
                  </div>
                </div>
              )}
              {cashSnapshotFechamento && (
                <div className="flex items-center gap-2 bg-muted rounded-lg px-4 py-2.5 border border-border">
                  <Banknote className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">Fechamento (Dinheiro)</p>
                    <p className="text-sm font-semibold text-foreground font-mono tabular-nums">{formatCurrency(cashSnapshotFechamento.total)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3 flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar pedido..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
            </div>
            <Select value={filterMatch} onValueChange={setFilterMatch}>
              <SelectTrigger className="w-[200px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="matched">Conciliadas</SelectItem>
                <SelectItem value="unmatched">Pendentes (maquininha)</SelectItem>
                <SelectItem value="external">Fora da maquininha</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Main content - split view */}
        <div className="flex-1 overflow-hidden">
          <div className="px-6 py-4 h-full flex gap-4">
            {/* Left: Orders */}
            <div className="flex-1 overflow-auto">
              <h3 className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Pedidos do Salão ({filtered.length})
              </h3>
              <div className="space-y-2">
                {filtered.map(order => {
                  const matchedTxs = matchedOrderIds.get(order.id);
                  const isMatched = !!matchedTxs && matchedTxs.length > 0;
                  const confidence = matchedTxs?.[0]?.match_confidence;
                  const isCombined = matchedTxs && matchedTxs.length > 1;
                  const totalMatchedAmount = matchedTxs?.reduce((s, t) => s + t.gross_amount, 0) || 0;
                  const orderPayments = payments.filter(p => p.salon_order_id === order.id);
                  const { label: typeLabel, cls: typeCls } = getOrderLabel(order.order_type);
                  const classification = orderClassifications.get(order.id);
                  const isExternal = classification?.isExternal;
                  const pendingReason = classification?.pendingReason;

                  return (
                    <div
                      key={order.id}
                      className={`bg-card rounded-lg border p-3 transition-all duration-150 ${
                        isExternal
                          ? 'border-border/50 bg-muted/30 opacity-75'
                          : isMatched
                            ? confidence === 'high'
                              ? 'border-success/50 bg-success/5'
                              : confidence === 'medium'
                                ? 'border-primary/50 bg-primary/5'
                                : 'border-warning/50 bg-warning/5'
                            : 'border-border hover:border-primary/30'
                      }`}
                      onDragOver={(e) => { if (!isExternal) { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-primary'); } }}
                      onDragLeave={(e) => { e.currentTarget.classList.remove('ring-2', 'ring-primary'); }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove('ring-2', 'ring-primary');
                        if (!isExternal) handleDrop(order.id);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`h-6 w-6 rounded-full flex items-center justify-center ${
                            isExternal ? 'bg-muted text-muted-foreground'
                              : isMatched ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'
                          }`}>
                            {isExternal
                              ? <DollarSign className="h-3.5 w-3.5" />
                              : isMatched ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="text-xs font-bold">?</span>
                            }
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge className={`${typeCls} border-transparent text-xs`}>{typeLabel}</Badge>
                            {order.sale_time && (
                              <span className="text-xs text-muted-foreground">
                                <Clock className="h-3 w-3 inline mr-0.5" />{order.sale_time}
                              </span>
                            )}
                            {/* Payment method from Saipos */}
                            <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">
                              {order.payment_method}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono tabular-nums font-medium text-foreground">
                            {formatCurrency(order.total_amount)}
                          </span>
                          {order.discount_amount > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              (desc {formatCurrency(order.discount_amount)})
                            </span>
                          )}
                          {orderPayments.length > 0 && (
                            <div className="flex gap-1">
                              {orderPayments.map((p, i) => (
                                <Badge key={i} variant="secondary" className="text-[10px]">
                                  {p.payment_method} {formatCurrency(p.amount)}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* External order badge */}
                      {isExternal && pendingReason && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <PendingReasonBadge reason={pendingReason} />
                        </div>
                      )}

                      {/* Pending reason for unmatched machine orders */}
                      {!isExternal && !isMatched && pendingReason && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          <PendingReasonBadge reason={pendingReason} />
                        </div>
                      )}

                      {isMatched && matchedTxs && (
                        <div className="mt-2 pt-2 border-t border-border/50">
                          {matchedTxs.map((tx, idx) => (
                            <div key={tx.id} className={`flex items-center justify-between ${idx > 0 ? 'mt-1.5 pt-1.5 border-t border-border/30' : ''}`}>
                              <div className="flex items-center gap-2 text-xs">
                                <Link2 className="h-3 w-3 text-success" />
                                <span className="text-muted-foreground font-mono tabular-nums">
                                  {tx.sale_time || '--:--'}
                                </span>
                                <span className="text-foreground">/</span>
                                <span className="text-xs text-foreground">{tx.payment_method}</span>
                                <span className="text-foreground">/</span>
                                <span className="font-mono tabular-nums font-medium text-foreground">{formatCurrency(tx.gross_amount)}</span>
                                <span className="text-foreground">/</span>
                                <span className="font-medium text-primary">
                                  {tx.machine_serial && waiterMap.has(tx.machine_serial)
                                    ? waiterMap.get(tx.machine_serial)
                                    : '—'}
                                </span>
                                {tx.brand && (
                                  <>
                                    <span className="text-foreground">/</span>
                                    <span className="text-muted-foreground">{tx.brand}</span>
                                  </>
                                )}
                              </div>
                              <Button
                                variant="ghost" size="sm"
                                className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                                onClick={() => unmatch(tx.id)}
                              >
                                <Unlink className="h-3 w-3 mr-1" />
                                Desvincular
                              </Button>
                            </div>
                          ))}
                          {/* Match reason & summary */}
                          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                            <Badge
                              variant="secondary"
                              className={`text-[9px] ${
                                matchedTxs[0]?.match_type === 'combined_mixed' ? 'bg-blue-500/10 text-blue-600'
                                  : confidence === 'high' ? 'bg-success/10 text-success'
                                  : confidence === 'medium' ? 'bg-primary/10 text-primary'
                                  : 'bg-warning/10 text-warning'
                              }`}
                            >
                              {matchedTxs[0]?.match_type === 'manual' ? 'Manual'
                                : matchedTxs[0]?.match_type === 'combined_mixed' ? 'Match combinado com dinheiro parcial'
                                : matchedTxs[0]?.match_type === 'combined' ? 'Match combinado'
                                : matchedTxs[0]?.match_type === 'approximate' ? 'Match aproximado'
                                : confidence === 'high' ? 'Match exato'
                                : confidence === 'medium' ? 'Match exato'
                                : 'Baixa confiança'}
                            </Badge>
                            {isCombined && matchedTxs[0]?.match_type !== 'combined_mixed' && (
                              <span className="text-[10px] text-muted-foreground">
                                Soma: <span className="font-mono tabular-nums font-medium">{formatCurrency(totalMatchedAmount)}</span>
                              </span>
                            )}
                            {matchedTxs[0]?.match_type === 'combined_mixed' && (
                              <span className="text-[10px] text-blue-600">
                                Maquininha: <span className="font-mono tabular-nums font-medium">{formatCurrency(totalMatchedAmount)}</span>
                                {' + Dinheiro: '}
                                <span className="font-mono tabular-nums font-medium">{formatCurrency(order.total_amount - totalMatchedAmount)}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {filtered.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Nenhum pedido encontrado.
                  </div>
                )}
              </div>
            </div>

            {/* Right: Unmatched Transactions */}
            <div className="w-80 flex-shrink-0 overflow-auto border-l border-border pl-4">
              <h3 className="text-sm font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Transações Sem Vínculo ({unmatchedTransactions.length})
              </h3>

              {transactions.length === 0 ? (
                <div className="text-center py-12">
                  <FileSpreadsheet className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Importe o relatório da maquininha para começar a conciliação.</p>
                </div>
              ) : unmatchedTransactions.length === 0 ? (
                <div className="text-center py-8">
                  <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-2" />
                  <p className="text-sm text-success font-medium">Todas as transações foram vinculadas!</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {unmatchedTransactions.map(tx => (
                    <div
                      key={tx.id}
                      draggable
                      onDragStart={() => setDragTxId(tx.id)}
                      onDragEnd={() => setDragTxId(null)}
                      className={`bg-card rounded-lg border border-border p-2.5 cursor-grab active:cursor-grabbing hover:border-primary/50 transition-all duration-150 ${
                        dragTxId === tx.id ? 'opacity-50 border-primary' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 text-xs flex-wrap">
                            <span className="font-mono tabular-nums text-muted-foreground">
                              {tx.sale_time || '--:--'}
                            </span>
                            <span className="text-border">/</span>
                            <span className="text-foreground">{tx.payment_method}</span>
                            <span className="text-border">/</span>
                            <span className="font-mono tabular-nums font-medium text-foreground">
                              {formatCurrency(tx.gross_amount)}
                            </span>
                            <span className="text-border">/</span>
                            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-primary/30 text-primary">
                              {tx.machine_serial && waiterMap.has(tx.machine_serial)
                                ? waiterMap.get(tx.machine_serial)
                                : '—'}
                            </Badge>
                            {tx.brand && (
                              <>
                                <span className="text-border">/</span>
                                <span className="text-muted-foreground">{tx.brand}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      {/* Sticky footer - Admin reconciliation controls */}
      {isAdmin && (
        <div className="sticky bottom-0 left-0 right-0 bg-card border-t border-border px-6 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <Badge className={reconciliationStatus === 'completed' ? 'bg-success/15 text-success border-success/30' : 'bg-warning/15 text-warning border-warning/30'}>
              {reconciliationStatus === 'completed' ? '✅ Conciliação concluída' : `⏳ ${stats.matched}/${stats.machineTotal} conciliados`}
            </Badge>
            {reconciliationStatus !== 'completed' && stats.pending === 0 && stats.txUnmatched === 0 && stats.machineTotal > 0 && (
              <span className="text-xs text-success font-medium">Todos conciliados — pronto para concluir!</span>
            )}
            {stats.external > 0 && (
              <span className="text-xs text-muted-foreground">{stats.external} fora da maquininha</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {reconciliationStatus === 'completed' ? (
              <Button variant="outline" size="sm" onClick={handleReopenReconciliation}>
                <RotateCcw className="h-4 w-4 mr-1" />
                Reabrir Conciliação
              </Button>
            ) : (
              <Button onClick={handleFinalizeReconciliation} className="bg-success hover:bg-success/90 text-success-foreground" size="sm">
                <ShieldCheck className="h-4 w-4 mr-1" />
                Concluir Conciliação
              </Button>
            )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

function PendingReasonBadge({ reason }: { reason: PendingReason }) {
  if (!reason) return null;
  const info = PENDING_REASON_LABELS[reason];
  if (!info) return null;
  return (
    <Badge variant="secondary" className={`text-[10px] gap-1 ${info.color}`}>
      {info.icon}
      {info.label}
    </Badge>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-card rounded-lg p-3 border border-border shadow-card">
      <div className="flex items-center justify-between mb-1">
        <p className="section-title">{label}</p>
        <span className={`${color} opacity-60`}>{icon}</span>
      </div>
      <p className={`text-2xl font-bold font-mono-tabular ${color}`}>{value}</p>
    </div>
  );
}
