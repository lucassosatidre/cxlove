import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTestMode } from '@/hooks/useTestMode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ArrowLeft, Upload, Search, CheckCircle2, AlertTriangle, Link2, Unlink,
  CreditCard, Truck, Clock, ArrowUpDown, ChevronUp, ChevronDown, GripVertical, Undo2, FileSpreadsheet,
  Banknote, ShieldCheck, RotateCcw
} from 'lucide-react';
import { toast } from 'sonner';
import AppSidebar from '@/components/AppSidebar';
import TestBanner from '@/components/TestBanner';
import { parseCardTransactionFile, ParsedCardTransaction } from '@/lib/card-transaction-parser';
import { matchTransactionsToOrders, MatchResult } from '@/lib/delivery-matching';
import {
  getDeliveryAutoMatchContext,
  getDeliveryDisplayAmount,
  getDeliveryDisplayMethods,
} from '@/lib/delivery-method-utils';
import { classifyPendingOrder } from '@/lib/delivery-pending-classifier';
import { useUserRole } from '@/hooks/useUserRole';
import { formatCurrency } from '@/lib/payment-utils';

interface Order {
  id: string;
  order_number: string;
  payment_method: string;
  total_amount: number;
  delivery_person: string | null;
  sale_time: string | null;
  is_confirmed: boolean;
}

interface CardTransaction {
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

export default function DeliveryReconciliation() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const { isTestMode } = useTestMode();
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [breakdowns, setBreakdowns] = useState<Array<{ imported_order_id: string; payment_method_name: string; payment_type: string; amount: number }>>([]);
  const [transactions, setTransactions] = useState<CardTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [closingDate, setClosingDate] = useState('');
  const [reconciliationStatus, setReconciliationStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [filterMatch, setFilterMatch] = useState('all');
  const [filterDeliveryPerson, setFilterDeliveryPerson] = useState('all');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('all');
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [dragTxId, setDragTxId] = useState<string | null>(null);
  const [cashSnapshotDataAbertura, setCashSnapshotDataAbertura] = useState<{ counts: Record<string, number>; total: number; updated_at: string } | null>(null);
  const [cashSnapshotDataFechamento, setCashSnapshotDataFechamento] = useState<{ counts: Record<string, number>; total: number; updated_at: string } | null>(null);
  const [expectedCash, setExpectedCash] = useState<{ counts: Record<string, number>; total: number } | null>(null);
  const [showCashDetailsAbertura, setShowCashDetailsAbertura] = useState(false);
  const [showCashDetailsFechamento, setShowCashDetailsFechamento] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [hasAutoReprocessed, setHasAutoReprocessed] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadData();
    setHasAutoReprocessed(false);
  }, [id]);

  const loadData = useCallback(async () => {
    const [{ data: closing }, { data: ordData }, { data: txData }, { data: snapData }] = await Promise.all([
      supabase.from('daily_closings').select('closing_date, reconciliation_status').eq('id', id!).single(),
      supabase.from('imported_orders')
        .select('id, order_number, payment_method, total_amount, delivery_person, sale_time, is_confirmed')
        .eq('daily_closing_id', id!),
      supabase.from('card_transactions')
        .select('*')
        .eq('daily_closing_id', id!),
      supabase.from('cash_snapshots')
        .select('counts, total, updated_at, snapshot_type')
        .eq('daily_closing_id', id!),
    ]);

    const dateStr = closing?.closing_date || '';
    setClosingDate(dateStr);
    setReconciliationStatus(closing?.reconciliation_status || 'pending');
    const ordersList = ordData || [];
    setOrders(ordersList);
    setTransactions((txData || []) as CardTransaction[]);
    for (const snap of (snapData || [])) {
      const type = (snap as any).snapshot_type || 'abertura';
      if (type === 'abertura') {
        setCashSnapshotDataAbertura({ counts: snap.counts as Record<string, number>, total: Number(snap.total), updated_at: snap.updated_at });
      } else if (type === 'fechamento') {
        setCashSnapshotDataFechamento({ counts: snap.counts as Record<string, number>, total: Number(snap.total), updated_at: snap.updated_at });
      }
    }

    // Load expected cash from admin
    if (dateStr) {
      const { data: expData } = await supabase
        .from('cash_expectations')
        .select('counts, total')
        .eq('closing_date', dateStr)
        .maybeSingle();
      if (expData) {
        const loadedCounts: Record<string, number> = {};
        if (expData.counts && typeof expData.counts === 'object') {
          for (const [k, v] of Object.entries(expData.counts as Record<string, number>)) {
            loadedCounts[k] = v;
          }
        }
        setExpectedCash({ counts: loadedCounts, total: Number(expData.total) });
      }
    }

    // Load breakdowns for all orders
    if (ordersList.length > 0) {
      const orderIds = ordersList.map(o => o.id);
      const { data: bkData } = await supabase
        .from('order_payment_breakdowns')
        .select('imported_order_id, payment_method_name, payment_type, amount')
        .in('imported_order_id', orderIds);
      setBreakdowns(bkData || []);
    }

    setLoading(false);
  }, [id]);

  // Filter orders to only show offline card payments (not cash, not online)
  // Prioritize breakdowns (operator-entered data) over raw Saipos payment_method
  const offlineOrders = useMemo(() => {
    return orders.filter(o => {
      const orderBreakdowns = breakdowns.filter(b => b.imported_order_id === o.id);
      
      // If there are breakdowns, use them to determine if order has physical card payments
      if (orderBreakdowns.length > 0) {
        return orderBreakdowns.some(b => {
          if (b.payment_type !== 'fisico') return false;
          const m = b.payment_method_name.toLowerCase();
          if (m === 'dinheiro') return false;
          return m.includes('crédit') || m.includes('credit') || m.includes('débit') || m.includes('debit') || m.includes('pix') || m.includes('voucher');
        });
      }
      
      // Fallback to raw payment_method from import
      const methods = o.payment_method.split(',').map(m => m.trim().toLowerCase());
      const hasOfflineCard = methods.some(m => {
        if (m.includes('online') || m.includes('(pago)') || m.includes('anotaai')) return false;
        if (m === 'dinheiro') return false;
        if (m.includes('voucher parceiro desconto')) return false;
        return m.includes('crédit') || m.includes('credit') || m.includes('débit') || m.includes('debit') || m.includes('pix') || m.includes('voucher');
      });
      return hasOfflineCard;
    });
  }, [orders, breakdowns]);

  // Map order ID → all matched transactions (supports combined matches with 2 txs per order)
  const matchedOrderIds = useMemo(() => {
    const map = new Map<string, CardTransaction[]>();
    transactions.forEach(tx => {
      if (tx.matched_order_id) {
        const arr = map.get(tx.matched_order_id) || [];
        arr.push(tx);
        map.set(tx.matched_order_id, arr);
      }
    });
    return map;
  }, [transactions]);

  // Build serial → delivery person map from matched data
  const serialToDeliveryPerson = useMemo(() => {
    const serialCounts = new Map<string, Map<string, number>>();
    transactions.forEach(tx => {
      if (!tx.matched_order_id || !tx.machine_serial) return;
      const order = orders.find(o => o.id === tx.matched_order_id);
      if (!order?.delivery_person) return;
      if (!serialCounts.has(tx.machine_serial)) serialCounts.set(tx.machine_serial, new Map());
      const counts = serialCounts.get(tx.machine_serial)!;
      counts.set(order.delivery_person, (counts.get(order.delivery_person) || 0) + 1);
    });
    const result = new Map<string, string>();
    for (const [serial, counts] of serialCounts) {
      let maxCount = 0;
      let bestPerson = '';
      for (const [person, count] of counts) {
        if (count > maxCount) { maxCount = count; bestPerson = person; }
      }
      if (bestPerson) result.set(serial, bestPerson);
    }
    return result;
  }, [transactions, orders]);

  const unmatchedTransactions = useMemo(() =>
    transactions.filter(tx => !tx.matched_order_id), [transactions]
  );

  const orderContexts = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getDeliveryAutoMatchContext>>();
    offlineOrders.forEach(order => {
      map.set(order.id, getDeliveryAutoMatchContext(order, breakdowns));
    });
    return map;
  }, [offlineOrders, breakdowns]);

  const pendingMeta = useMemo(() => {
    const meta = new Map<string, ReturnType<typeof classifyPendingOrder>>();

    offlineOrders.forEach(order => {
      if (matchedOrderIds.has(order.id)) return;

      const context = orderContexts.get(order.id);
      if (!context) return;

      const classification = classifyPendingOrder(
        order,
        context,
        transactions.map(tx => ({
          id: tx.id,
          gross_amount: tx.gross_amount,
          payment_method: tx.payment_method,
          sale_time: tx.sale_time,
          matched_order_id: tx.matched_order_id,
          machine_serial: tx.machine_serial,
        })),
        breakdowns,
      );

      meta.set(order.id, classification);
    });

    return meta;
  }, [breakdowns, matchedOrderIds, offlineOrders, orderContexts, transactions]);

  const stats = useMemo(() => {
    const total = offlineOrders.length;
    const matched = offlineOrders.filter(o => matchedOrderIds.has(o.id)).length;
    const highConf = offlineOrders.filter(o => {
      const txs = matchedOrderIds.get(o.id);
      return txs?.[0]?.match_confidence === 'high';
    }).length;
    return { total, matched, pending: total - matched, highConf, txTotal: transactions.length, txUnmatched: unmatchedTransactions.length };
  }, [offlineOrders, matchedOrderIds, transactions, unmatchedTransactions]);

  const deliveryPersons = useMemo(() => {
    const set = new Set<string>();
    offlineOrders.forEach(o => { if (o.delivery_person) set.add(o.delivery_person); });
    return Array.from(set).sort();
  }, [offlineOrders]);

  const paymentMethodsFilter = useMemo(() => {
    const set = new Set<string>();
    offlineOrders.forEach(o => {
      const orderBks = breakdowns.filter(b => b.imported_order_id === o.id && b.payment_type === 'fisico');
      if (orderBks.length > 0) {
        orderBks.forEach(b => set.add(b.payment_method_name));
      } else {
        o.payment_method.split(',').map(m => m.trim()).filter(m => m).forEach(m => set.add(m));
      }
    });
    return Array.from(set).sort();
  }, [offlineOrders, breakdowns]);

  const filtered = useMemo(() => {
    return offlineOrders.filter(o => {
      if (search && !o.order_number.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterMatch === 'matched' && !matchedOrderIds.has(o.id)) return false;
      if (filterMatch === 'unmatched' && matchedOrderIds.has(o.id)) return false;
      if (filterDeliveryPerson !== 'all' && o.delivery_person !== filterDeliveryPerson) return false;
      if (filterPaymentMethod !== 'all') {
        const orderBks = breakdowns.filter(b => b.imported_order_id === o.id && b.payment_type === 'fisico');
        if (orderBks.length > 0) {
          if (!orderBks.some(b => b.payment_method_name === filterPaymentMethod)) return false;
        } else {
          const methods = o.payment_method.split(',').map(m => m.trim());
          if (!methods.includes(filterPaymentMethod)) return false;
        }
      }
      return true;
    }).sort((a, b) => {
      const aNum = parseInt(a.order_number.replace(/\D/g, ''), 10) || 0;
      const bNum = parseInt(b.order_number.replace(/\D/g, ''), 10) || 0;
      return aNum - bNum;
    });
  }, [offlineOrders, search, filterMatch, filterDeliveryPerson, filterPaymentMethod, matchedOrderIds, breakdowns]);

  const handleImport = useCallback(async (file: File) => {
    if (!user || !id) return;
    setImporting(true);
    try {
      const { transactions: parsed, excludedCount, totalCount } = await parseCardTransactionFile(file);

      // Delete existing transactions for this closing
      await supabase.from('card_transactions').delete().eq('daily_closing_id', id);

      // Insert new transactions
      const batch = parsed.map(t => ({
        daily_closing_id: id,
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
        .from('card_transactions')
        .insert(batch)
        .select('*');

      if (error) throw error;

      const newTxs = (inserted || []) as CardTransaction[];

      // Run auto-matching with serial map for delivery person context
      const matchResults = matchTransactionsToOrders(
        newTxs.map(tx => ({
          id: tx.id,
          gross_amount: tx.gross_amount,
          payment_method: tx.payment_method,
          machine_serial: tx.machine_serial || '',
          sale_time: tx.sale_time || '',
        })),
        orders.map(o => ({
          id: o.id,
          order_number: o.order_number,
          payment_method: o.payment_method,
          total_amount: o.total_amount,
          delivery_person: o.delivery_person,
          sale_time: o.sale_time,
          is_confirmed: o.is_confirmed,
        })),
        new Set(),
        breakdowns,
        serialToDeliveryPerson
      );

      // Apply matches
      for (const match of matchResults) {
        await supabase
          .from('card_transactions')
          .update({
            matched_order_id: match.orderId,
            match_type: match.matchType,
            match_confidence: match.confidence,
          })
          .eq('id', match.transactionId);
      }

      toast.success(
        `${parsed.length} transações importadas (${excludedCount} de máquinas fixas excluídas). ${matchResults.length} matches automáticos.`
      );

      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao importar transações.');
    } finally {
      setImporting(false);
    }
  }, [user, id, orders, breakdowns, loadData]);

  const reprocessAutomaticMatches = useCallback(async () => {
    if (!id || !isTestMode || isReprocessing || transactions.length === 0) return;

    setIsReprocessing(true);

    try {
      const manualMatchedTransactions = transactions.filter(tx => tx.match_type === 'manual' && tx.matched_order_id);
      const manualTransactionIds = new Set(manualMatchedTransactions.map(tx => tx.id));
      const manualOrderIds = new Set(manualMatchedTransactions.map(tx => tx.matched_order_id!));
      const automaticMatches = transactions.filter(tx => tx.matched_order_id && tx.match_type !== 'manual');

      if (automaticMatches.length > 0) {
        const { error: clearError } = await supabase
          .from('card_transactions')
          .update({ matched_order_id: null, match_type: null, match_confidence: null })
          .in('id', automaticMatches.map(tx => tx.id));

        if (clearError) throw clearError;
      }

      const reprocessedMatches = matchTransactionsToOrders(
        transactions
          .filter(tx => !manualTransactionIds.has(tx.id))
          .map(tx => ({
            id: tx.id,
            gross_amount: tx.gross_amount,
            payment_method: tx.payment_method,
            machine_serial: tx.machine_serial || '',
            sale_time: tx.sale_time || '',
          })),
        orders
          .filter(order => !manualOrderIds.has(order.id))
          .map(order => ({
            id: order.id,
            order_number: order.order_number,
            payment_method: order.payment_method,
            total_amount: order.total_amount,
            delivery_person: order.delivery_person,
            sale_time: order.sale_time,
            is_confirmed: order.is_confirmed,
          })),
        manualTransactionIds,
        breakdowns
      );

      await Promise.all(
        reprocessedMatches.map(match =>
          supabase
            .from('card_transactions')
            .update({
              matched_order_id: match.orderId,
              match_type: match.matchType,
              match_confidence: match.confidence,
            })
            .eq('id', match.transactionId)
        )
      );

      if (automaticMatches.length > 0 || reprocessedMatches.length > 0) {
        toast.success(`Tele Teste reprocessada com trava real por método (${reprocessedMatches.length} vínculos automáticos).`);
      }

      await loadData();
    } catch (error) {
      console.error(error);
      toast.error('Erro ao reprocessar a Tele Teste.');
    } finally {
      setIsReprocessing(false);
      setHasAutoReprocessed(true);
    }
  }, [breakdowns, id, isReprocessing, isTestMode, loadData, orders, transactions]);

  useEffect(() => {
    if (!isTestMode || loading || hasAutoReprocessed || transactions.length === 0) return;
    void reprocessAutomaticMatches();
  }, [hasAutoReprocessed, isTestMode, loading, reprocessAutomaticMatches, transactions.length]);

  const manualMatch = useCallback(async (transactionId: string, orderId: string) => {
    // Save undo info
    const tx = transactions.find(t => t.id === transactionId);
    setUndoStack(prev => [...prev, {
      type: 'match',
      transactionId,
      orderId,
      previousMatchType: tx?.match_type || null,
      previousConfidence: tx?.match_confidence || null,
    }]);

    await supabase
      .from('card_transactions')
      .update({
        matched_order_id: orderId,
        match_type: 'manual',
        match_confidence: 'high',
      })
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
      type: 'unmatch',
      transactionId,
      orderId: tx.matched_order_id || '',
      previousMatchType: tx.match_type,
      previousConfidence: tx.match_confidence,
    }]);

    await supabase
      .from('card_transactions')
      .update({
        matched_order_id: null,
        match_type: null,
        match_confidence: null,
      })
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
      // Undo a match → remove it
      await supabase
        .from('card_transactions')
        .update({
          matched_order_id: null,
          match_type: action.previousMatchType,
          match_confidence: action.previousConfidence,
        })
        .eq('id', action.transactionId);

      setTransactions(prev => prev.map(t =>
        t.id === action.transactionId
          ? { ...t, matched_order_id: null, match_type: action.previousMatchType, match_confidence: action.previousConfidence }
          : t
      ));
    } else {
      // Undo an unmatch → restore it
      await supabase
        .from('card_transactions')
        .update({
          matched_order_id: action.orderId,
          match_type: action.previousMatchType,
          match_confidence: action.previousConfidence,
        })
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
      .from('daily_closings')
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
      .from('daily_closings')
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const percent = stats.total > 0 ? Math.round((stats.matched / stats.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppSidebar />
      <div className="ml-56 flex flex-col flex-1">
      {isTestMode && <div className="px-6 pt-4"><TestBanner /></div>}
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(`${isTestMode ? '/reconciliation-teste' : '/reconciliation'}/${id}`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-base font-semibold text-foreground">
                {isTestMode && <span className="text-amber-600 mr-1">[TESTE]</span>}
                Conciliação do Delivery — {formatDate(closingDate)}
              </h1>
              <p className="text-xs text-muted-foreground">
                Cruzamento de pagamentos offline com transações da maquininha
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={undo}
              disabled={undoStack.length === 0}
            >
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
            {isTestMode && isReprocessing && (
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                Reprocessando com trava por método…
              </Badge>
            )}
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
                    <span className="text-sm font-semibold text-primary font-mono-tabular">{formatCurrency(total)}</span>
                    <span className="text-xs text-muted-foreground">({count} {count === 1 ? 'operação' : 'operações'})</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 bg-accent rounded-lg px-4 py-2.5 border border-border shrink-0">
                <span className="text-sm font-medium text-foreground">Total:</span>
                <span className="text-sm font-semibold text-foreground font-mono-tabular">
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
        <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Comandas Offline" value={stats.total} icon={<CreditCard className="h-4 w-4" />} color="text-foreground" />
          <StatCard label="Conciliadas" value={stats.matched} icon={<CheckCircle2 className="h-4 w-4" />} color="text-success" />
          <StatCard label="Pendentes" value={stats.pending} icon={<AlertTriangle className="h-4 w-4" />} color="text-warning" />
          <StatCard label="Tx Maquininha" value={stats.txTotal} icon={<Truck className="h-4 w-4" />} color="text-foreground" />
          <div className="bg-muted rounded-xl p-3 border border-border">
            <p className="text-xs text-muted-foreground mb-1">Progresso</p>
            <p className="text-2xl font-semibold text-foreground font-mono-tabular">{percent}%</p>
            <div className="mt-2 h-1.5 bg-border rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full row-transition" style={{ width: `${percent}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Cash Snapshot - Abertura (read-only) */}
      {cashSnapshotDataAbertura && (
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-success" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Contagem de Dinheiro na Abertura</span>
              </div>
              <span className="flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Salvo
              </span>
            </div>
            <div className="mt-2 flex items-center gap-4 flex-wrap">
              <span className="text-lg font-bold text-foreground font-mono">{formatCurrency(cashSnapshotDataAbertura.total)}</span>
              {expectedCash && (() => {
                const BILL_DENOMS = [200, 100, 50, 20, 10, 5, 2];
                const expBills = BILL_DENOMS.reduce((s, d) => s + d * (expectedCash.counts[String(d)] || 0), 0);
                const opBills = BILL_DENOMS.reduce((s, d) => s + d * ((cashSnapshotDataAbertura.counts[String(d)] as number) || 0), 0);
                const diff = opBills - expBills;
                const match = Math.abs(diff) < 0.01;
                return (
                  <span className={`text-sm font-mono ${match ? 'text-success' : 'text-warning'}`}>
                    (Esperado: {formatCurrency(expectedCash.total)}{!match && ` · Dif cédulas: ${formatCurrency(diff)}`})
                  </span>
                );
              })()}
              <span className="text-xs text-muted-foreground">
                Salvo em {new Date(cashSnapshotDataAbertura.updated_at).toLocaleString('pt-BR')}
              </span>
              <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setShowCashDetailsAbertura(!showCashDetailsAbertura)}>
                {showCashDetailsAbertura ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                {showCashDetailsAbertura ? 'Ocultar' : 'Ver detalhes'}
              </Button>
            </div>
            {showCashDetailsAbertura && (
              <div className="mt-3">
                {expectedCash ? (
                  <div className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 text-xs">
                    <div />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Esperado (Admin)</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Operador</span>
                    {[200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05]
                      .filter(d => (expectedCash.counts[String(d)] || 0) > 0 || (cashSnapshotDataAbertura.counts[String(d)] || 0) > 0)
                      .map(denom => {
                        const expQty = expectedCash.counts[String(denom)] || 0;
                        const opQty = (cashSnapshotDataAbertura.counts[String(denom)] as number) || 0;
                        const isCoin = denom <= 1;
                        const match = isCoin || expQty === opQty;
                        return (
                          <div key={denom} className="contents">
                            <span className="font-medium text-foreground font-mono py-1">{formatCurrency(denom)}</span>
                            <div className="flex items-center gap-1.5 bg-primary/10 rounded-md px-2.5 py-1 border border-primary/20">
                              <span className="font-semibold text-foreground">{expQty}</span>
                              <span className="text-muted-foreground">= {formatCurrency(denom * expQty)}</span>
                            </div>
                            <div className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 border ${match ? 'bg-success/10 border-success/20' : 'bg-warning/10 border-warning/20'}`}>
                              <span className="font-semibold text-foreground">{opQty}</span>
                              <span className="text-muted-foreground">= {formatCurrency(denom * opQty)}</span>
                            </div>
                          </div>
                        );
                      })}
                    {(() => {
                      const BILL_DENOMS = [200, 100, 50, 20, 10, 5, 2];
                      const expBills = BILL_DENOMS.reduce((s, d) => s + d * (expectedCash.counts[String(d)] || 0), 0);
                      const opBills = BILL_DENOMS.reduce((s, d) => s + d * ((cashSnapshotDataAbertura.counts[String(d)] as number) || 0), 0);
                      const match = Math.abs(opBills - expBills) < 0.01;
                      return (
                        <div className="contents font-semibold border-t border-border">
                          <span className="py-1.5 text-foreground">Total</span>
                          <span className="py-1.5 font-mono text-foreground">{formatCurrency(expectedCash.total)}</span>
                          <span className={`py-1.5 font-mono ${match ? 'text-success' : 'text-warning'}`}>
                            {formatCurrency(cashSnapshotDataAbertura.total)}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(cashSnapshotDataAbertura.counts)
                      .map(([denom, qty]) => ({ denom: parseFloat(denom), qty: qty as number }))
                      .filter(({ qty }) => qty > 0)
                      .sort((a, b) => b.denom - a.denom)
                      .map(({ denom, qty }) => (
                        <div key={denom} className="flex items-center gap-1.5 bg-secondary rounded-md px-2.5 py-1 border border-border text-xs">
                          <span className="font-medium text-foreground font-mono">{formatCurrency(denom)}</span>
                          <span className="text-muted-foreground">×</span>
                          <span className="font-semibold text-foreground">{qty}</span>
                          <span className="text-muted-foreground ml-1">= {formatCurrency(denom * qty)}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cash Snapshot - Fechamento (read-only) */}
      {cashSnapshotDataFechamento && (
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-primary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Contagem de Dinheiro no Fechamento</span>
              </div>
              <span className="flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Salvo
              </span>
            </div>
            <div className="mt-2 flex items-center gap-4">
              <span className="text-lg font-bold text-foreground font-mono">{formatCurrency(cashSnapshotDataFechamento.total)}</span>
              <span className="text-xs text-muted-foreground">
                Salvo em {new Date(cashSnapshotDataFechamento.updated_at).toLocaleString('pt-BR')}
              </span>
              <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setShowCashDetailsFechamento(!showCashDetailsFechamento)}>
                {showCashDetailsFechamento ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                {showCashDetailsFechamento ? 'Ocultar' : 'Ver detalhes'}
              </Button>
            </div>
            {showCashDetailsFechamento && (
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(cashSnapshotDataFechamento.counts)
                  .map(([denom, qty]) => ({ denom: parseFloat(denom), qty: qty as number }))
                  .filter(({ qty }) => qty > 0)
                  .sort((a, b) => b.denom - a.denom)
                  .map(({ denom, qty }) => (
                    <div key={denom} className="flex items-center gap-1.5 bg-secondary rounded-md px-2.5 py-1 border border-border text-xs">
                      <span className="font-medium text-foreground font-mono">{formatCurrency(denom)}</span>
                      <span className="text-muted-foreground">×</span>
                      <span className="font-semibold text-foreground">{qty}</span>
                      <span className="text-muted-foreground ml-1">= {formatCurrency(denom * qty)}</span>
                    </div>
                  ))}
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
            <Input placeholder="Buscar comanda..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Select value={filterDeliveryPerson} onValueChange={setFilterDeliveryPerson}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Entregador" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos entregadores</SelectItem>
              {deliveryPersons.map(dp => (
                <SelectItem key={dp} value={dp}>{dp}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterPaymentMethod} onValueChange={setFilterPaymentMethod}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Pagamento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas formas</SelectItem>
              {paymentMethodsFilter.map(pm => (
                <SelectItem key={pm} value={pm}>{pm}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterMatch} onValueChange={setFilterMatch}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="matched">Conciliadas</SelectItem>
              <SelectItem value="unmatched">Pendentes</SelectItem>
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
              Comandas Offline ({filtered.length})
            </h3>
            <div className="space-y-2">
              {filtered.map(order => {
                const matchedTxs = matchedOrderIds.get(order.id);
                const isMatched = !!matchedTxs && matchedTxs.length > 0;
                const confidence = matchedTxs?.[0]?.match_confidence;
                const isCombined = matchedTxs && matchedTxs.length > 1;
                const totalMatchedAmount = matchedTxs?.reduce((s, t) => s + t.gross_amount, 0) || 0;
                const pendingInfo = pendingMeta.get(order.id);

                return (
                  <div
                    key={order.id}
                    className={`bg-card rounded-lg border p-3 row-transition ${
                      isMatched
                        ? confidence === 'high'
                          ? 'border-success/50 bg-success/5'
                          : confidence === 'medium'
                            ? 'border-primary/50 bg-primary/5'
                            : 'border-warning/50 bg-warning/5'
                        : 'border-border hover:border-primary/30'
                    }`}
                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-primary'); }}
                    onDragLeave={(e) => { e.currentTarget.classList.remove('ring-2', 'ring-primary'); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.remove('ring-2', 'ring-primary');
                      handleDrop(order.id);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`h-6 w-6 rounded-full flex items-center justify-center ${
                          isMatched ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'
                        }`}>
                          {isMatched ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="text-xs font-bold">?</span>}
                        </div>
                        <div>
                          <span className="font-medium text-foreground">#{order.order_number}</span>
                          <span className="text-xs text-muted-foreground ml-2">{order.delivery_person || '—'}</span>
                          {order.sale_time && (
                            <span className="text-xs text-muted-foreground ml-2">
                              <Clock className="h-3 w-3 inline mr-0.5" />{order.sale_time}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono-tabular font-medium text-foreground">
                          {formatCurrency(getDeliveryDisplayAmount(order, breakdowns))}
                        </span>
                        <Badge variant="secondary" className="text-[10px]">
                          {getDeliveryDisplayMethods(order, breakdowns)}
                        </Badge>
                        {!isMatched && pendingInfo && (
                          <Badge variant="secondary" className={`text-[10px] border ${pendingInfo.tone}`}>
                            {pendingInfo.label}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {isMatched && matchedTxs && (
                      <div className="mt-2 pt-2 border-t border-border/50">
                        {matchedTxs.map((tx, idx) => (
                          <div key={tx.id} className={`flex items-center justify-between ${idx > 0 ? 'mt-1.5 pt-1.5 border-t border-border/30' : ''}`}>
                            <div className="flex items-center gap-2 text-xs">
                              <Link2 className="h-3 w-3 text-success" />
                              <span className="text-muted-foreground">
                                {tx.payment_method} {tx.sale_time ? `(${tx.sale_time})` : ''}
                                {(() => {
                                  const inferredPerson = tx.machine_serial ? serialToDeliveryPerson.get(tx.machine_serial) : null;
                                  const orderPerson = order.delivery_person?.trim().toLowerCase();
                                  const inferredLower = inferredPerson?.trim().toLowerCase();
                                  const isDivergent = !!(inferredPerson && orderPerson && inferredLower !== orderPerson);
                                  return inferredPerson ? (
                                    <>
                                      <span className={`font-medium ${isDivergent ? 'text-destructive' : 'text-primary'}`}> • {inferredPerson}</span>
                                      {isDivergent && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <AlertTriangle className="h-3 w-3 text-destructive inline ml-1 cursor-help" />
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p className="text-xs">Motoboy divergente: comanda registra <strong>{order.delivery_person}</strong>, mas a máquina é associada a <strong>{inferredPerson}</strong></p>
                                          </TooltipContent>
                                        </Tooltip>
                                      )}
                                    </>
                                  ) : null;
                                })()}
                                {' '}— <span className="font-mono-tabular">{formatCurrency(tx.gross_amount)}</span>
                              </span>
                              {idx === 0 && (
                                <Badge
                                  variant="secondary"
                                  className={`text-[9px] ${
                                    confidence === 'high'
                                      ? 'bg-success/10 text-success'
                                      : confidence === 'medium'
                                        ? 'bg-primary/10 text-primary'
                                        : 'bg-warning/10 text-warning'
                                  }`}
                                >
                                  {tx.match_type === 'manual'
                                    ? 'Manual'
                                    : tx.match_type === 'combined'
                                      ? 'Match combinado'
                                      : confidence === 'high'
                                        ? 'Match exato'
                                        : confidence === 'medium'
                                          ? 'Match aproximado'
                                          : 'Baixa confiança'}
                                </Badge>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                              onClick={() => unmatch(tx.id)}
                            >
                              <Unlink className="h-3 w-3 mr-1" />
                              Desvincular
                            </Button>
                          </div>
                        ))}
                        {isCombined && (
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            Soma: <span className="font-mono-tabular font-medium">{formatCurrency(totalMatchedAmount)}</span>
                            {Math.abs(totalMatchedAmount - order.total_amount) > 0.01 && (
                              <span className="text-warning ml-1">
                                Δ {formatCurrency(Math.abs(order.total_amount - totalMatchedAmount))}
                              </span>
                            )}
                          </div>
                        )}
                        {!isCombined && matchedTxs[0].match_type !== 'exact' && matchedTxs[0].gross_amount !== order.total_amount && (
                          <div className="mt-1 text-warning text-[10px]">
                            Δ {formatCurrency(Math.abs(order.total_amount - matchedTxs[0].gross_amount))}
                          </div>
                        )}
                      </div>
                    )}

                    {!isMatched && pendingInfo && isTestMode && (
                      <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                        {pendingInfo.suggestions.map((suggestion, index) => (
                          <div key={`${order.id}-suggestion-${index}`} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                            <AlertTriangle className="h-3 w-3 mt-0.5 text-warning shrink-0" />
                            <span>{suggestion}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {filtered.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  Nenhuma comanda encontrada.
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
                    className={`bg-card rounded-lg border border-border p-2.5 cursor-grab active:cursor-grabbing hover:border-primary/50 row-transition ${
                      dragTxId === tx.id ? 'opacity-50 border-primary' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground">{tx.payment_method}</span>
                          <span className="text-sm font-mono-tabular font-medium text-foreground">
                            {formatCurrency(tx.gross_amount)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {tx.machine_serial && serialToDeliveryPerson.has(tx.machine_serial) ? (
                            <span className="text-[10px] font-medium text-primary flex items-center gap-0.5">
                              <Truck className="h-2.5 w-2.5" />
                              {serialToDeliveryPerson.get(tx.machine_serial)}
                            </span>
                          ) : tx.brand ? (
                            <span className="text-[10px] text-muted-foreground">{tx.brand}</span>
                          ) : null}
                          {tx.sale_time && (
                            <span className="text-[10px] text-muted-foreground">
                              <Clock className="h-2.5 w-2.5 inline mr-0.5" />{tx.sale_time}
                            </span>
                          )}
                          {tx.machine_serial && (
                            <span className="text-[10px] text-muted-foreground font-mono-tabular truncate max-w-[100px]" title={tx.machine_serial}>
                              {tx.machine_serial.slice(-6)}
                            </span>
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
              {reconciliationStatus === 'completed' ? '✅ Conciliação concluída' : `⏳ ${stats.matched}/${stats.total} conciliados`}
            </Badge>
            {reconciliationStatus !== 'completed' && stats.pending === 0 && stats.txUnmatched === 0 && stats.total > 0 && (
              <span className="text-xs text-success font-medium">Todos conciliados — pronto para concluir!</span>
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

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-muted rounded-xl p-3 border border-border">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={color}>{icon}</span>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className={`text-2xl font-semibold font-mono-tabular ${color}`}>{value}</p>
    </div>
  );
}
