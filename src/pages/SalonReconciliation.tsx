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
  ChevronUp, ChevronDown, ShieldX, Copy,
} from 'lucide-react';
import { usePermissions } from '@/contexts/PermissionsContext';
import MachineReadingsSection from '@/components/MachineReadingsSection';
import { toast } from 'sonner';
import AppSidebar from '@/components/AppSidebar';
import { parseSalonCardTransactionFile } from '@/lib/card-transaction-parser';
import { matchSalonTransactionsToOrders, classifyOrder, type OrderClassification, type PendingReason } from '@/lib/salon-matching';
import { formatCurrency } from '@/lib/payment-utils';


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
  const { canView } = usePermissions();
  const canConciliar = canView('op.salao.conciliacao');

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
  const [filterPayment, setFilterPayment] = useState('all');
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [dragTxId, setDragTxId] = useState<string | null>(null);
  const [cashSnapshotAbertura, setCashSnapshotAbertura] = useState<{ total: number; updated_at: string } | null>(null);
  const [cashSnapshotFechamento, setCashSnapshotFechamento] = useState<{ total: number; updated_at: string } | null>(null);
  const [orderClassifications, setOrderClassifications] = useState<Map<string, OrderClassification>>(new Map());
  const [machineReadings, setMachineReadings] = useState<{ machine_serial: string; delivery_person: string }[]>([]);
  const [showCashDetailsAbertura, setShowCashDetailsAbertura] = useState(false);
  const [showCashDetailsFechamento, setShowCashDetailsFechamento] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  const loadData = async () => {
    const [{ data: closing }, { data: ordData }, { data: txData }, { data: mrData }] = await Promise.all([
      supabase.from('salon_closings').select('closing_date, reconciliation_status').eq('id', id!).single(),
      supabase.from('salon_orders').select('id, order_type, sale_time, total_amount, payment_method, discount_amount').eq('salon_closing_id', id!),
      supabase.from('salon_card_transactions').select('*').eq('salon_closing_id', id!),
      supabase.from('machine_readings').select('machine_serial, delivery_person').eq('salon_closing_id', id!),
    ]);
    setMachineReadings((mrData || []) as { machine_serial: string; delivery_person: string }[]);

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

  // Normalize payment method strings into canonical buckets so the dropdown isn't polluted with variants.
  const normalizePaymentMethod = (raw: string): string => {
    const s = (raw || '').trim();
    if (!s) return '';
    const k = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (k.includes('pix')) return 'Pix';
    if (k.includes('dinheiro') || k === 'cash') return 'Dinheiro';
    if (k.includes('credit')) return 'Crédito';
    if (k.includes('debit')) return 'Débito';
    if (k.includes('voucher') || k.includes('ticket') || k.includes('alelo') ||
        k.includes('sodexo') || k.includes('vr') || k.includes('vale') ||
        k.includes('refeicao') || k.includes('pluxee')) return 'Voucher/Ticket';
    return s;
  };

  const splitMethods = (raw: string): string[] =>
    (raw || '').split(',').map(m => m.trim()).filter(Boolean);

  const orderMatchesPayment = (o: SalonOrder, sel: string): boolean => {
    if (sel === 'all') return true;
    return splitMethods(o.payment_method).some(m => normalizePaymentMethod(m) === sel);
  };

  const txMatchesPayment = (tx: SalonCardTx, sel: string): boolean => {
    if (sel === 'all') return true;
    return normalizePaymentMethod(tx.payment_method) === sel;
  };

  const paymentOptions = useMemo(() => {
    const set = new Set<string>();
    orders.forEach(o => splitMethods(o.payment_method).forEach(m => {
      const n = normalizePaymentMethod(m);
      if (n) set.add(n);
    }));
    transactions.forEach(tx => {
      const n = normalizePaymentMethod(tx.payment_method);
      if (n) set.add(n);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [orders, transactions]);

  const unmatchedTransactions = useMemo(() =>
    transactions.filter(tx => !tx.matched_order_id && txMatchesPayment(tx, filterPayment)),
    [transactions, filterPayment]);

  const waiterMap = useMemo(() => {
    const nameByStripped = new Map<string, string>();
    machineReadings.forEach(r => {
      const name = (r.delivery_person || '').trim();
      const serial = (r.machine_serial || '').replace(/^S1F2-000/, '').trim();
      if (serial && name) nameByStripped.set(serial, name);
    });
    const map = new Map<string, string>();
    for (const tx of transactions) {
      const full = tx.machine_serial;
      if (!full) continue;
      if (map.has(full)) continue;
      const stripped = full.replace(/^S1F2-000/, '');
      const real = nameByStripped.get(stripped);
      map.set(full, real || `Maq. …${stripped.slice(-4)}`);
    }
    return map;
  }, [transactions, machineReadings]);

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
      txUnmatched: transactions.filter(tx => !tx.matched_order_id).length,
    };
  }, [eligibleOrders, matchedOrderIds, transactions, orderClassifications]);

  type DivergenceType = 'metodo_divergente' | 'combinado_nao_declarado' | 'estrutura_divergente' | 'diferenca_valor' | 'desconto_cashback';

  const DIVERGENCE_LABELS: Record<DivergenceType, { label: string; color: string }> = {
    metodo_divergente: { label: 'Método divergente', color: 'bg-destructive/10 text-destructive' },
    combinado_nao_declarado: { label: 'Combinado não declarado', color: 'bg-warning/10 text-warning' },
    estrutura_divergente: { label: 'Estrutura divergente', color: 'bg-warning/10 text-warning' },
    diferenca_valor: { label: 'Diferença de valor', color: 'bg-destructive/10 text-destructive' },
    desconto_cashback: { label: 'Desconto/Cashback', color: 'bg-success/10 text-success' },
  };

  const canonicalMethod = (m: string): string => {
    const l = (m || '').toLowerCase();
    if (l.includes('pix')) return 'Pix';
    if (l.includes('créd') || l.includes('cred')) return 'Crédito';
    if (l.includes('déb') || l.includes('deb')) return 'Débito';
    if (l.includes('voucher') || l.includes('vale')) return 'Voucher';
    if (l.includes('dinheiro')) return 'Dinheiro';
    if (l.includes('online') || l.includes('ifood') || l.includes('anotaai') || l.includes('(pago)')) return 'Online';
    return 'Outro';
  };
  const isCardMethod = (c: string) => c === 'Pix' || c === 'Crédito' || c === 'Débito' || c === 'Voucher';

  // Detecta divergência por pedido CONCILIADO, calculada na tela (cartão × forma declarada × valor)
  const divergenceByOrder = useMemo(() => {
    const map = new Map<string, DivergenceType>();
    const payByOrder = new Map<string, SalonPayment[]>();
    payments.forEach(p => {
      if (!payByOrder.has(p.salon_order_id)) payByOrder.set(p.salon_order_id, []);
      payByOrder.get(p.salon_order_id)!.push(p);
    });

    for (const order of orders) {
      const txs = matchedOrderIds.get(order.id);
      if (!txs || txs.length === 0) continue; // só pedidos conciliados

      const cardMethods = txs.map(t => canonicalMethod(t.payment_method)).sort();
      const cardSum = txs.reduce((s, t) => s + t.gross_amount, 0);

      const bk = payByOrder.get(order.id) || [];
      let declaredCard: string[] = [];
      let expectedCardSum: number | null = null;
      if (bk.length > 0) {
        const cardBk = bk.filter(p => isCardMethod(canonicalMethod(p.payment_method)));
        declaredCard = cardBk.map(p => canonicalMethod(p.payment_method)).sort();
        expectedCardSum = cardBk.reduce((s, p) => s + p.amount, 0);
      } else {
        const methods = (order.payment_method || '').split(',').map(s => s.trim()).filter(Boolean);
        const cardDeclared = methods.map(canonicalMethod).filter(isCardMethod);
        declaredCard = [...cardDeclared].sort();
        expectedCardSum = (cardDeclared.length === methods.length && cardDeclared.length === 1)
          ? order.total_amount : null; // misto com dinheiro/online sem breakdown → não checa valor
      }

      // 1) diferença de valor (ciente de desconto/cashback)
      if (expectedCardSum != null) {
        const matchesTotal = Math.abs(cardSum - expectedCardSum) <= 0.5;
        const disc = order.discount_amount || 0;
        const matchesWithDiscount = disc > 0.01 && Math.abs(cardSum - (expectedCardSum + disc)) <= 0.5;
        if (!matchesTotal) {
          map.set(order.id, matchesWithDiscount ? 'desconto_cashback' : 'diferenca_valor');
          continue;
        }
      }
      // 2) método / estrutura
      if (declaredCard.length > 0) {
        const same = declaredCard.length === cardMethods.length && declaredCard.every((m, i) => m === cardMethods[i]);
        if (!same) {
          if (cardMethods.length > declaredCard.length) map.set(order.id, 'combinado_nao_declarado');
          else if (cardMethods.length < declaredCard.length) map.set(order.id, 'estrutura_divergente');
          else map.set(order.id, 'metodo_divergente');
        }
      }
    }
    return map;
  }, [orders, matchedOrderIds, payments]);

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
      const div = divergenceByOrder.get(o.id);
      if (filterMatch === 'divergent' && (!div || div === 'desconto_cashback')) return false;
      if (['metodo_divergente','combinado_nao_declarado','estrutura_divergente','diferenca_valor','desconto_cashback'].includes(filterMatch) && div !== filterMatch) return false;
      if (!orderMatchesPayment(o, filterPayment)) return false;
      return true;
    });
  }, [eligibleOrders, search, filterMatch, filterPayment, matchedOrderIds, orderClassifications, divergenceByOrder]);


  const filteredOrdersSummary = useMemo(() => {
    if (filterPayment === 'all') return null;
    const sum = filtered.reduce((acc, o) => acc + (o.total_amount || 0), 0);
    return { count: filtered.length, sum };
  }, [filtered, filterPayment]);

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

  const machineRealByMethod = useMemo(() => {
    const s: Record<'Pix' | 'Crédito' | 'Débito' | 'Voucher', { total: number; count: number }> = {
      'Pix': { total: 0, count: 0 },
      'Crédito': { total: 0, count: 0 },
      'Débito': { total: 0, count: 0 },
      'Voucher': { total: 0, count: 0 },
    };
    transactions.forEach(tx => {
      const method = tx.payment_method?.toLowerCase() || '';
      let label: 'Pix' | 'Crédito' | 'Débito' | 'Voucher' | null = null;
      if (method.includes('pix')) label = 'Pix';
      else if (method.includes('crédit') || method.includes('credit')) label = 'Crédito';
      else if (method.includes('débit') || method.includes('debit')) label = 'Débito';
      else if (method.includes('voucher')) label = 'Voucher';
      if (label) {
        s[label].total += tx.gross_amount;
        s[label].count += 1;
      }
    });
    return s;
  }, [transactions]);

  // Diagnóstico: dados consolidados por forma + itens que explicam a diferença
  const diagnosticData = useMemo(() => {
    const rows = [
      { key: 'Pix', saipos: offlineMethodTotals['(COBRAR) Pix'] || 0, real: machineRealByMethod['Pix'].total },
      { key: 'Crédito', saipos: offlineMethodTotals['Crédito'] || 0, real: machineRealByMethod['Crédito'].total },
      { key: 'Débito', saipos: offlineMethodTotals['Débito'] || 0, real: machineRealByMethod['Débito'].total },
      { key: 'Voucher', saipos: offlineMethodTotals['Voucher'] || 0, real: machineRealByMethod['Voucher'].total },
    ].map(r => ({ ...r, diff: r.real - r.saipos }));
    const totals = rows.reduce(
      (acc, r) => ({ saipos: acc.saipos + r.saipos, real: acc.real + r.real, diff: acc.diff + r.diff }),
      { saipos: 0, real: 0, diff: 0 },
    );

    const trocaForma: SalonOrder[] = [];
    const difValor: SalonOrder[] = [];
    for (const order of orders) {
      const div = divergenceByOrder.get(order.id);
      if (!div) continue;
      if (div === 'diferenca_valor') difValor.push(order);
      else trocaForma.push(order);
    }

    const semTx = orders.filter(o => {
      if (matchedOrderIds.has(o.id)) return false;
      const cls = orderClassifications.get(o.id);
      return !cls?.isExternal;
    });

    const sobras = transactions.filter(tx => !tx.matched_order_id);

    const hasDiff =
      rows.some(r => Math.abs(r.diff) >= 0.01) ||
      trocaForma.length > 0 || difValor.length > 0 || semTx.length > 0 || sobras.length > 0;

    return { rows, totals, trocaForma, difValor, semTx, sobras, hasDiff };
  }, [offlineMethodTotals, machineRealByMethod, orders, divergenceByOrder, matchedOrderIds, orderClassifications, transactions]);

  const [diagnosticOpenState, setDiagnosticOpenState] = useState<boolean | null>(null);
  const diagnosticOpen = diagnosticOpenState ?? diagnosticData.hasDiff;


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
    if (!id || !canConciliar) return;
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
  }, [id, canConciliar]);

  const handleReopenReconciliation = useCallback(async () => {
    if (!id || !canConciliar) return;
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
  }, [id, canConciliar]);


  const formatDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  const getOrderLabel = (orderType: string) => {
    const isRetirada = /^\d+$/.test(orderType.trim()) || orderType.toLowerCase() === 'retirada';
    if (orderType.toLowerCase() === 'ficha') return { label: 'Ficha', cls: 'bg-foreground text-background' };
    if (isRetirada) return { label: 'Retirada', cls: 'bg-foreground text-warning' };
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

  if (!canView('op.salao.conciliacao')) {
    return (
      <div className="min-h-screen bg-background flex">
        <AppSidebar />
        <div className="ml-56 flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <ShieldX className="w-14 h-14 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Acesso Negado</h2>
          <p className="text-muted-foreground max-w-md">Você não tem permissão para a conciliação. Fale com o administrador.</p>
        </div>
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

        {/* 1. Contagem de Dinheiro na Abertura */}
        {cashSnapshotAbertura && (
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
              <div className="mt-2 flex items-center gap-4">
                <span className="text-lg font-bold text-foreground font-mono">{formatCurrency(cashSnapshotAbertura.total)}</span>
                <span className="text-xs text-muted-foreground">
                  Salvo em {new Date(cashSnapshotAbertura.updated_at).toLocaleString('pt-BR')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 2. Total Teórico via Saipos */}
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Total Teórico via Saipos</p>
            <div className="flex flex-wrap gap-3">
              {OFFLINE_CATEGORIES.map(cat => {
                const total = offlineMethodTotals[cat] || 0;
                const iconMap: Record<string, React.ReactNode> = {
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
              {(() => {
                const totalGeral = OFFLINE_CATEGORIES.reduce((sum, cat) => sum + (offlineMethodTotals[cat] || 0), 0);
                return (
                  <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2 border border-primary/30 min-w-[150px]">
                    <Wallet className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-[10px] text-primary font-semibold leading-tight">Total Geral</p>
                      <p className="text-sm font-bold text-primary font-mono">{formatCurrency(totalGeral)}</p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* 3. Total Recebido via Maquininhas (Manual) */}
        {id && (
          <MachineReadingsSection
            salonClosingId={id}
            deliveryPersons={[]}
            isCompleted={true}
            mode="totals"
          />
        )}

        {/* 4. Total Recebido via Maquininhas - Real */}
        {(() => {
          const methodSummary = machineRealByMethod;
          const fixedOrder = ['Pix', 'Crédito', 'Débito', 'Voucher'];
          const iconMap: Record<string, React.ReactNode> = {
            'Pix': <QrCode className="h-4 w-4 text-primary" />,
            'Crédito': <CreditCard className="h-4 w-4 text-accent-foreground" />,
            'Débito': <CreditCard className="h-4 w-4 text-muted-foreground" />,
            'Voucher': <CreditCard className="h-4 w-4 text-warning" />,
          };
          const totalReal = Object.values(methodSummary).reduce((s, v) => s + v.total, 0);
          const totalOps = Object.values(methodSummary).reduce((s, v) => s + v.count, 0);
          return (
            <div className="border-b border-border bg-card">
              <div className="px-6 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Total Recebido via Maquininhas - Real</p>
                <div className="flex flex-wrap gap-3">
                  {fixedOrder.map(label => {
                    const { total, count } = methodSummary[label];
                    return (
                      <div key={label} className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[150px]">
                        {iconMap[label]}
                        <div>
                          <p className="text-[10px] text-muted-foreground leading-tight">{label} ({count} {count === 1 ? 'op' : 'ops'})</p>
                          <p className="text-sm font-semibold text-foreground font-mono">{formatCurrency(total)}</p>
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2 border border-primary/30 min-w-[150px]">
                    <Wallet className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-[10px] text-primary font-semibold leading-tight">Total Geral ({totalOps} ops)</p>
                      <p className="text-sm font-bold text-primary font-mono">{formatCurrency(totalReal)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* 5. Contagem de Dinheiro no Fechamento */}
        {cashSnapshotFechamento && (
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
                <span className="text-lg font-bold text-foreground font-mono">{formatCurrency(cashSnapshotFechamento.total)}</span>
                <span className="text-xs text-muted-foreground">
                  Salvo em {new Date(cashSnapshotFechamento.updated_at).toLocaleString('pt-BR')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 6. Resumo de Pedidos */}
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Resumo de Pedidos</p>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[120px]">
                <Store className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Comandas Offline</p>
                  <p className="text-sm font-semibold text-foreground font-mono-tabular">{stats.machineTotal}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[120px]">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Conciliadas</p>
                  <p className="text-sm font-semibold text-success font-mono-tabular">{stats.matched}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[120px]">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Pendentes</p>
                  <p className="text-sm font-semibold text-warning font-mono-tabular">{stats.pending}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[120px]">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Divergências</p>
                  <p className="text-sm font-semibold text-destructive font-mono-tabular">{divergenceByOrder.size}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[120px]">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Fora Maquininha</p>
                  <p className="text-sm font-semibold text-muted-foreground font-mono-tabular">{stats.external}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[120px]">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Tx Maquininha</p>
                  <p className="text-sm font-semibold text-foreground font-mono-tabular">{stats.txTotal}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2 border border-primary/30 min-w-[150px]">
                <div className="flex-1">
                  <p className="text-[10px] text-primary font-semibold leading-tight">Progresso</p>
                  <p className="text-sm font-bold text-primary font-mono-tabular">{percent}%</p>
                  <div className="mt-1 h-1 bg-border rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Diagnóstico — Por que não fechou */}
        {(() => {
          const d = diagnosticData;
          const diffColor = (n: number) => {
            if (Math.abs(n) < 0.01) return 'text-success';
            if (n < 0) return 'text-destructive';
            return 'text-warning';
          };
          const diffPrefix = (n: number) => {
            if (Math.abs(n) < 0.01) return '✓ ';
            return n > 0 ? '+' : '';
          };
          const handleCopy = () => {
            const lines: string[] = [];
            lines.push(`Diagnóstico do fechamento — ${formatDate(closingDate)}`);
            lines.push('');
            lines.push('📊 Conferência por forma de pagamento');
            lines.push('Forma | Saipos | Maquininha | Diferença');
            d.rows.forEach(r => {
              lines.push(`${r.key}: ${formatCurrency(r.saipos)} / ${formatCurrency(r.real)} / ${diffPrefix(r.diff)}${formatCurrency(r.diff)}`);
            });
            lines.push(`TOTAL: ${formatCurrency(d.totals.saipos)} / ${formatCurrency(d.totals.real)} / ${diffPrefix(d.totals.diff)}${formatCurrency(d.totals.diff)}`);
            lines.push('');
            if (d.trocaForma.length) {
              lines.push(`🔴 Forma de pagamento trocada (${d.trocaForma.length})`);
              d.trocaForma.forEach(o => {
                const txs = matchedOrderIds.get(o.id) || [];
                const real = txs.map(t => t.payment_method).join(' + ');
                const gar = [...new Set(txs.map(t => t.machine_serial ? (waiterMap.get(t.machine_serial) || '—') : '—'))].join(', ');
                lines.push(`  • ${o.sale_time || ''} — ${formatCurrency(o.total_amount)} — Saipos: ${o.payment_method} → Maquininha: ${real} — ${gar}`);
              });
              lines.push('');
            }
            if (d.difValor.length) {
              lines.push(`🔴 Diferença de valor (${d.difValor.length})`);
              d.difValor.forEach(o => {
                const txs = matchedOrderIds.get(o.id) || [];
                const soma = txs.reduce((s, t) => s + t.gross_amount, 0);
                const gar = [...new Set(txs.map(t => t.machine_serial ? (waiterMap.get(t.machine_serial) || '—') : '—'))].join(', ');
                lines.push(`  • ${o.sale_time || ''} — Saipos: ${formatCurrency(o.total_amount)} / Maquininha: ${formatCurrency(soma)} (${diffPrefix(soma - o.total_amount)}${formatCurrency(soma - o.total_amount)}) — ${gar}`);
              });
              lines.push('');
            }
            if (d.semTx.length) {
              lines.push(`🟠 Pagamento sem transação na maquininha (${d.semTx.length})`);
              d.semTx.forEach(o => {
                lines.push(`  • ${o.sale_time || ''} — ${o.payment_method} — ${formatCurrency(o.total_amount)}`);
              });
              lines.push('');
            }
            if (d.sobras.length) {
              lines.push(`🔵 Transação na maquininha sem comanda (${d.sobras.length})`);
              d.sobras.forEach(tx => {
                const gar = tx.machine_serial ? (waiterMap.get(tx.machine_serial) || '—') : '—';
                lines.push(`  • ${tx.sale_time || ''} — ${tx.payment_method} — ${formatCurrency(tx.gross_amount)} — ${gar}`);
              });
              lines.push('');
            }
            navigator.clipboard.writeText(lines.join('\n')).then(() => {
              toast.success('Resumo copiado!');
            }).catch(() => {
              toast.error('Não foi possível copiar');
            });
          };

          return (
            <div className="border-b border-border bg-card">
              <div className="px-6 py-3">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setDiagnosticOpenState(!diagnosticOpen)}
                    className="flex items-center gap-2 flex-1 text-left"
                  >
                    {d.hasDiff ? (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        Diagnóstico — Por que não fechou
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {d.hasDiff
                          ? 'Diferenças entre o que o Saipos lançou e o que a maquininha registrou'
                          : 'Tudo conciliado — nada divergente'}
                      </p>
                    </div>
                    {diagnosticOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>
                  {diagnosticOpen && (
                    <Button variant="outline" size="sm" onClick={handleCopy} className="h-8 gap-1.5">
                      <Copy className="h-3.5 w-3.5" />
                      <span className="text-xs">Copiar resumo</span>
                    </Button>
                  )}
                </div>

                {diagnosticOpen && (
                  <div className="mt-4 space-y-4">
                    {/* Bloco A */}
                    <div className="rounded-md border border-border overflow-x-auto">
                      <table className="w-full text-xs font-mono tabular-nums">
                        <thead className="bg-muted/60">
                          <tr className="text-muted-foreground">
                            <th className="text-left px-3 py-2 font-medium">Forma</th>
                            <th className="text-right px-3 py-2 font-medium">Saipos (teórico)</th>
                            <th className="text-right px-3 py-2 font-medium">Maquininha (real)</th>
                            <th className="text-right px-3 py-2 font-medium">Diferença</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.rows.map(r => (
                            <tr key={r.key} className="border-t border-border">
                              <td className="px-3 py-1.5 font-sans">{r.key}</td>
                              <td className="text-right px-3 py-1.5">{formatCurrency(r.saipos)}</td>
                              <td className="text-right px-3 py-1.5">{formatCurrency(r.real)}</td>
                              <td className={`text-right px-3 py-1.5 font-semibold ${diffColor(r.diff)}`}>
                                {diffPrefix(r.diff)}{formatCurrency(r.diff)}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t border-border bg-muted/40 font-bold">
                            <td className="px-3 py-2 font-sans">TOTAL</td>
                            <td className="text-right px-3 py-2">{formatCurrency(d.totals.saipos)}</td>
                            <td className="text-right px-3 py-2">{formatCurrency(d.totals.real)}</td>
                            <td className={`text-right px-3 py-2 ${diffColor(d.totals.diff)}`}>
                              {diffPrefix(d.totals.diff)}{formatCurrency(d.totals.diff)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Bloco B */}
                    {(d.trocaForma.length > 0 || d.difValor.length > 0 || d.semTx.length > 0 || d.sobras.length > 0) && (
                      <>
                        <p className="text-xs text-muted-foreground">Os itens abaixo explicam as diferenças acima.</p>

                        {d.trocaForma.length > 0 && (
                          <div className="rounded-md border border-destructive/30 bg-destructive/5">
                            <div className="px-3 py-2 border-b border-destructive/20 flex items-center justify-between">
                              <span className="text-xs font-semibold text-destructive">🔴 Forma de pagamento trocada</span>
                              <Badge variant="secondary" className="bg-destructive/10 text-destructive text-[10px]">{d.trocaForma.length}</Badge>
                            </div>
                            <div className="divide-y divide-border">
                              {d.trocaForma.map(o => {
                                const txs = matchedOrderIds.get(o.id) || [];
                                const real = txs.map(t => t.payment_method).join(' + ');
                                const gar = [...new Set(txs.map(t => t.machine_serial ? (waiterMap.get(t.machine_serial) || '—') : '—'))].join(', ');
                                const { label: typeLabel, cls: typeCls } = getOrderLabel(o.order_type);
                                return (
                                  <div key={o.id} className="px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                                    <span className="font-mono tabular-nums text-muted-foreground">{o.sale_time || ''}</span>
                                    <Badge className={`text-[9px] ${typeCls}`}>{typeLabel}</Badge>
                                    <span className="font-mono tabular-nums font-semibold">{formatCurrency(o.total_amount)}</span>
                                    <span className="text-muted-foreground">Saipos: <span className="text-foreground">{o.payment_method}</span> → Maquininha: <span className="text-foreground">{real || '—'}</span></span>
                                    <span className="text-muted-foreground">{gar}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <p className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-destructive/20">
                              O cliente pagou numa forma diferente da que foi lançada no Saipos. O valor total bate; muda só a forma.
                            </p>
                          </div>
                        )}

                        {d.difValor.length > 0 && (
                          <div className="rounded-md border border-destructive/30 bg-destructive/5">
                            <div className="px-3 py-2 border-b border-destructive/20 flex items-center justify-between">
                              <span className="text-xs font-semibold text-destructive">🔴 Diferença de valor</span>
                              <Badge variant="secondary" className="bg-destructive/10 text-destructive text-[10px]">{d.difValor.length}</Badge>
                            </div>
                            <div className="divide-y divide-border">
                              {d.difValor.map(o => {
                                const txs = matchedOrderIds.get(o.id) || [];
                                const soma = txs.reduce((s, t) => s + t.gross_amount, 0);
                                const diff = soma - o.total_amount;
                                const gar = [...new Set(txs.map(t => t.machine_serial ? (waiterMap.get(t.machine_serial) || '—') : '—'))].join(', ');
                                const { label: typeLabel, cls: typeCls } = getOrderLabel(o.order_type);
                                return (
                                  <div key={o.id} className="px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                                    <span className="font-mono tabular-nums text-muted-foreground">{o.sale_time || ''}</span>
                                    <Badge className={`text-[9px] ${typeCls}`}>{typeLabel}</Badge>
                                    <span className="text-muted-foreground">Saipos: <span className="font-mono tabular-nums text-foreground">{formatCurrency(o.total_amount)}</span> / Maquininha: <span className="font-mono tabular-nums text-foreground">{formatCurrency(soma)}</span></span>
                                    <span className={`font-mono tabular-nums font-semibold ${diffColor(diff)}`}>{diffPrefix(diff)}{formatCurrency(diff)}</span>
                                    <span className="text-muted-foreground">{gar}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <p className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-destructive/20">
                              O valor registrado na maquininha é diferente do total lançado no Saipos.
                            </p>
                          </div>
                        )}

                        {d.semTx.length > 0 && (
                          <div className="rounded-md border border-warning/30 bg-warning/5">
                            <div className="px-3 py-2 border-b border-warning/20 flex items-center justify-between">
                              <span className="text-xs font-semibold text-warning">🟠 Pagamento sem transação na maquininha</span>
                              <Badge variant="secondary" className="bg-warning/10 text-warning text-[10px]">{d.semTx.length}</Badge>
                            </div>
                            <div className="divide-y divide-border">
                              {d.semTx.map(o => {
                                const { label: typeLabel, cls: typeCls } = getOrderLabel(o.order_type);
                                return (
                                  <div key={o.id} className="px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                                    <span className="font-mono tabular-nums text-muted-foreground">{o.sale_time || ''}</span>
                                    <Badge className={`text-[9px] ${typeCls}`}>{typeLabel}</Badge>
                                    <span className="text-foreground">{o.payment_method}</span>
                                    <span className="font-mono tabular-nums font-semibold">{formatCurrency(o.total_amount)}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <p className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-warning/20">
                              O Saipos lançou este pagamento no cartão, mas nenhuma transação da maquininha corresponde. Pode ser lançamento errado, pagamento não capturado, ou na verdade pago em dinheiro.
                            </p>
                          </div>
                        )}

                        {d.sobras.length > 0 && (
                          <div className="rounded-md border border-primary/30 bg-primary/5">
                            <div className="px-3 py-2 border-b border-primary/20 flex items-center justify-between">
                              <span className="text-xs font-semibold text-primary">🔵 Transação na maquininha sem comanda</span>
                              <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px]">{d.sobras.length}</Badge>
                            </div>
                            <div className="divide-y divide-border">
                              {d.sobras.map(tx => {
                                const gar = tx.machine_serial ? (waiterMap.get(tx.machine_serial) || '—') : '—';
                                return (
                                  <div key={tx.id} className="px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                                    <span className="font-mono tabular-nums text-muted-foreground">{tx.sale_time || ''}</span>
                                    <span className="text-foreground">{tx.payment_method}</span>
                                    <span className="font-mono tabular-nums font-semibold">{formatCurrency(tx.gross_amount)}</span>
                                    <span className="text-muted-foreground">{gar}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <p className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-primary/20">
                              A maquininha recebeu este valor, mas não há comanda no Saipos correspondente.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

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
                <SelectItem value="divergent">⚠️ Só com divergência</SelectItem>
                <SelectItem value="metodo_divergente">Método divergente</SelectItem>
                <SelectItem value="combinado_nao_declarado">Combinado não declarado</SelectItem>
                <SelectItem value="estrutura_divergente">Estrutura divergente</SelectItem>
                <SelectItem value="diferenca_valor">Diferença de valor</SelectItem>
              </SelectContent>

            </Select>
            <Select value={filterPayment} onValueChange={setFilterPayment}>
              <SelectTrigger className="w-[200px] h-9">
                <SelectValue placeholder="Forma de pagamento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Forma: Todas</SelectItem>
                {paymentOptions.map(opt => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filteredOrdersSummary && (
              <div className="flex items-center px-3 h-9 rounded-md border border-border bg-muted text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{filteredOrdersSummary.count}</span>
                <span className="mx-1">pedidos •</span>
                <span className="font-mono tabular-nums font-medium text-foreground">{formatCurrency(filteredOrdersSummary.sum)}</span>
              </div>
            )}
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
                                matchedTxs[0]?.match_type === 'combined_mixed' ? 'bg-info/10 text-info'
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
                            {divergenceByOrder.get(order.id) && (
                              <Badge variant="secondary" className={`text-[9px] gap-1 ${DIVERGENCE_LABELS[divergenceByOrder.get(order.id)!].color}`}>
                                <AlertTriangle className="h-2.5 w-2.5" />
                                {DIVERGENCE_LABELS[divergenceByOrder.get(order.id)!].label}
                              </Badge>
                            )}

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
      {canConciliar && (
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

