import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  ArrowLeft, Upload, Search, CheckCircle2, AlertTriangle, Link2, Unlink,
  CreditCard, Truck, Clock, ArrowUpDown, ChevronUp, ChevronDown, GripVertical, Undo2, FileSpreadsheet,
  Banknote, ShieldCheck, RotateCcw, Rocket, QrCode, Wallet, MoreVertical, Store, Ban, Layers, ShieldX
} from 'lucide-react';
import { usePermissions } from '@/contexts/PermissionsContext';
import { toast } from 'sonner';
import AppSidebar from '@/components/AppSidebar';

import AtlasMuskView from '@/components/AtlasMuskView';
import { parseCardTransactionFile, ParsedCardTransaction } from '@/lib/card-transaction-parser';
import { matchTransactionsToOrders, MatchResult, MatchType } from '@/lib/delivery-matching';
import {
  getDeliveryAutoMatchContext,
  getDeliveryDisplayAmount,
  getDeliveryDisplayMethods,
  normalizeDeliveryMethod,
  type NormalizedDeliveryMethod,
} from '@/lib/delivery-method-utils';
import { classifyPendingOrder } from '@/lib/delivery-pending-classifier';

import { formatCurrency, canonicalizePaymentMethod } from '@/lib/payment-utils';
import MachineReadingsSection from '@/components/MachineReadingsSection';
import {
  exportMatchesXLSX,
  exportPendingXLSX,
  exportDriverSummaryXLSX,
} from '@/lib/delivery-export';
import { getLatestCashSnapshots } from '@/lib/cash-snapshot-utils';
import { useConfirmedDrivers } from '@/hooks/useConfirmedDrivers';
import { useMachineRegistry } from '@/hooks/useMachineRegistry';
import { SaiposCancellationsPanel } from '@/components/SaiposCancellationsPanel';
import { SaiposDiscountsPanel } from '@/components/SaiposDiscountsPanel';

interface Order {
  id: string;
  order_number: string;
  payment_method: string;
  total_amount: number;
  delivery_person: string | null;
  sale_time: string | null;
  is_confirmed: boolean;
  is_cancelled?: boolean;
  manual_cash_amount?: number;
  migrated_to_salon?: boolean;
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

const normalizeSerial = (s: string | null | undefined): string =>
  s ? s.replace(/^S1F2-000/, '') : '';

// Tipos de divergência em um match já conciliado
type DivergenceKind = 'metodo' | 'estrutura' | 'combinado_nd' | 'entregador' | 'valor';

const DIVERGENCE_LABELS: Record<DivergenceKind, string> = {
  metodo: 'Método divergente',
  estrutura: 'Estrutura divergente',
  combinado_nd: 'Combinado não declarado',
  entregador: 'Entregador divergente',
  valor: 'Diferença de valor',
};

export default function DeliveryReconciliation() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { canView } = usePermissions();
  const canConciliar = canView('op.tele.conciliacao');

  const { registry, getFriendlyName } = useMachineRegistry();
  
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [breakdowns, setBreakdowns] = useState<Array<{ imported_order_id: string; payment_method_name: string; payment_type: string; amount: number }>>([]);
  const [transactions, setTransactions] = useState<CardTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [closingDate, setClosingDate] = useState('');
  const { confirmedDrivers } = useConfirmedDrivers(closingDate);
  const [reconciliationStatus, setReconciliationStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [filterMatch, setFilterMatch] = useState('all');
  const [filterDeliveryPerson, setFilterDeliveryPerson] = useState('all');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('all');
  const [filterDivergence, setFilterDivergence] = useState('all');
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [dragTxId, setDragTxId] = useState<string | null>(null);
  const [cashSnapshotDataAbertura, setCashSnapshotDataAbertura] = useState<{ counts: Record<string, number>; total: number; updated_at: string } | null>(null);
  const [cashSnapshotDataFechamento, setCashSnapshotDataFechamento] = useState<{ counts: Record<string, number>; total: number; updated_at: string } | null>(null);
  const [expectedCash, setExpectedCash] = useState<{ counts: Record<string, number>; total: number } | null>(null);
  const [showCashDetailsAbertura, setShowCashDetailsAbertura] = useState(false);
  const [showCashDetailsFechamento, setShowCashDetailsFechamento] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [hasAutoReprocessed, setHasAutoReprocessed] = useState(false);
  const [activeTab, setActiveTab] = useState<'classic' | 'atlas'>('classic');
  const [machineReadingsData, setMachineReadingsData] = useState<Array<{ machine_serial: string; delivery_person: string }>>([]);
  // Agrupamento de transações (item 2) + ações de pedido (itens 3 e 4)
  const [groupingOrder, setGroupingOrder] = useState<Order | null>(null);
  const [groupSelectedTxIds, setGroupSelectedTxIds] = useState<Set<string>>(new Set());
  const [groupCash, setGroupCash] = useState<string>('');
  const [groupSaving, setGroupSaving] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadData();
    setHasAutoReprocessed(false);
  }, [id]);

  const loadData = useCallback(async () => {
    const [{ data: closing }, { data: ordData }, { data: txData }, { data: snapData }, { data: mrData }] = await Promise.all([
      supabase.from('daily_closings').select('closing_date, reconciliation_status').eq('id', id!).single(),
      supabase.from('imported_orders')
        .select('id, order_number, payment_method, total_amount, delivery_person, sale_time, is_confirmed, is_cancelled, manual_cash_amount, migrated_to_salon')
        .eq('daily_closing_id', id!),
      supabase.from('card_transactions')
        .select('*')
        .eq('daily_closing_id', id!),
      supabase.from('cash_snapshots')
        .select('counts, total, updated_at, snapshot_type')
        .eq('daily_closing_id', id!)
        .order('updated_at', { ascending: false }),
      supabase.from('machine_readings')
        .select('machine_serial, delivery_person')
        .eq('daily_closing_id', id!)
        .not('machine_serial', 'eq', ''),
    ]);

    const dateStr = closing?.closing_date || '';
    setClosingDate(dateStr);
    setReconciliationStatus(closing?.reconciliation_status || 'pending');
    const ordersList = ordData || [];
    setOrders(ordersList);
    setTransactions((txData || []) as CardTransaction[]);
    setMachineReadingsData((mrData || []).map(r => ({ machine_serial: r.machine_serial, delivery_person: r.delivery_person })));
    setCashSnapshotDataAbertura(null);
    setCashSnapshotDataFechamento(null);
    const latestSnapshots = getLatestCashSnapshots(snapData || []);

    if (latestSnapshots.abertura) {
      setCashSnapshotDataAbertura({
        counts: latestSnapshots.abertura.counts as Record<string, number>,
        total: Number(latestSnapshots.abertura.total),
        updated_at: latestSnapshots.abertura.updated_at,
      });
    }

    if (latestSnapshots.fechamento) {
      setCashSnapshotDataFechamento({
        counts: latestSnapshots.fechamento.counts as Record<string, number>,
        total: Number(latestSnapshots.fechamento.total),
        updated_at: latestSnapshots.fechamento.updated_at,
      });
    }

    // Load expected cash from admin
    if (dateStr) {
      const { data: expData } = await supabase
        .from('cash_expectations')
        .select('counts, total')
        .eq('closing_date', dateStr)
        .eq('sector', 'tele')
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

  // Pedidos ativos = nem cancelados, nem migrados para o salão
  const activeOrders = useMemo(
    () => orders.filter(o => !o.is_cancelled && !o.migrated_to_salon),
    [orders]
  );
  const inactiveOrders = useMemo(
    () => orders.filter(o => o.is_cancelled || o.migrated_to_salon),
    [orders]
  );

  // Filter orders to only show offline card payments (not cash, not online)
  // Prioritize breakdowns (operator-entered data) over raw Saipos payment_method
  const offlineOrders = useMemo(() => {
    return activeOrders.filter(o => {
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
  }, [activeOrders, breakdowns]);

  // Pedidos só em dinheiro (sem cartão): listados como informativos, não exigem conciliação.
  const cashOnlyOrders = useMemo(() => {
    const cardIds = new Set(offlineOrders.map(o => o.id));
    return activeOrders.filter(o => {
      if (cardIds.has(o.id)) return false;
      const bks = breakdowns.filter(b => b.imported_order_id === o.id);
      if (bks.length > 0) {
        return bks.some(b => b.payment_type === 'fisico' && b.amount > 0 && normalizeDeliveryMethod(b.payment_method_name) === 'dinheiro');
      }
      return o.payment_method.split(',').map(m => m.trim()).some(m => normalizeDeliveryMethod(m) === 'dinheiro');
    });
  }, [activeOrders, offlineOrders, breakdowns]);

  const cashOnlyIds = useMemo(() => new Set(cashOnlyOrders.map(o => o.id)), [cashOnlyOrders]);

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

  // Build serial → delivery person map from machine_readings (conference data)
  // For tele machines: use the driver linked during conference
  // For frota machines: use the friendly_name (e.g. "Frota 1")
  // Fallback to old inference if no machine_readings data
  const serialToDeliveryPerson = useMemo(() => {
    const result = new Map<string, string>();

    // Primary source: machine_readings from this closing
    for (const mr of machineReadingsData) {
      if (!mr.machine_serial) continue;
      const key = normalizeSerial(mr.machine_serial);
      // Check registry for category
      const regEntry = registry.get(key);
      if (regEntry?.category === 'frota') {
        // Frota machines: show friendly_name instead of driver
        result.set(key, regEntry.friendly_name);
      } else if (mr.delivery_person) {
        result.set(key, mr.delivery_person);
      }
    }

    // Also check for frota machines from registry that appear in transactions but not in readings
    transactions.forEach(tx => {
      if (!tx.machine_serial) return;
      const key = normalizeSerial(tx.machine_serial);
      if (result.has(key)) return;
      const regEntry = registry.get(key);
      if (regEntry?.category === 'frota') {
        result.set(key, regEntry.friendly_name);
      }
    });

    // Fallback: for serials not in machine_readings, use old inference from matched transactions
    const serialCounts = new Map<string, Map<string, number>>();
    transactions.forEach(tx => {
      if (!tx.matched_order_id || !tx.machine_serial) return;
      const key = normalizeSerial(tx.machine_serial);
      if (result.has(key)) return; // already resolved
      const order = orders.find(o => o.id === tx.matched_order_id);
      if (!order?.delivery_person) return;
      if (!serialCounts.has(key)) serialCounts.set(key, new Map());
      const counts = serialCounts.get(key)!;
      counts.set(order.delivery_person, (counts.get(order.delivery_person) || 0) + 1);
    });
    for (const [serial, counts] of serialCounts) {
      let maxCount = 0;
      let bestPerson = '';
      for (const [person, count] of counts) {
        if (count > maxCount) { maxCount = count; bestPerson = person; }
      }
      if (bestPerson) result.set(serial, bestPerson);
    }

    return result;
  }, [transactions, orders, machineReadingsData, registry]);

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

  // Parte NÃO-cartão já conhecida pelo Saipos: dinheiro (breakdown físico dinheiro) e
  // "já recebido" = online/já-pago + VOUCHER PARCEIRO DESCONTO (classificado como online).
  const orderNonCardKnown = useCallback((orderId: string) => {
    const bks = breakdowns.filter(b => b.imported_order_id === orderId);
    let saiposCash = 0;
    let online = 0;
    bks.forEach(b => {
      if (b.payment_type === 'online') online += b.amount; // inclui voucher parceiro desconto
      else if (normalizeDeliveryMethod(b.payment_method_name) === 'dinheiro') saiposCash += b.amount;
    });
    return { saiposCash, online };
  }, [breakdowns]);

  // Resumo financeiro completo de um pedido conciliado (valor real x partes)
  const orderMoney = useCallback((order: Order, matchedSum: number) => {
    const { saiposCash, online } = orderNonCardKnown(order.id);
    const manualCash = order.manual_cash_amount || 0;
    const cash = saiposCash + manualCash;
    const explained = matchedSum + cash + online;
    const remainder = order.total_amount - explained; // o que "ficou pra trás" / falta explicar
    return { total: order.total_amount, card: matchedSum, cash, saiposCash, manualCash, online, remainder };
  }, [orderNonCardKnown]);

  // Divergências de cada pedido já conciliado (método/estrutura/combinado/entregador/valor)
  const divergenceMap = useMemo(() => {
    const map = new Map<string, Set<DivergenceKind>>();
    offlineOrders.forEach(order => {
      const txs = matchedOrderIds.get(order.id);
      if (!txs || txs.length === 0) return;
      const kinds = new Set<DivergenceKind>();
      const sum = txs.reduce((s, t) => s + t.gross_amount, 0);
      // Divergência de valor = sobra valor SEM explicação. Conta cartões + dinheiro
      // (Saipos e declarado) + já recebido (online/voucher parceiro desconto) contra o
      // valor REAL da comanda. Se ainda falta, é divergência.
      const { remainder } = orderMoney(order, sum);
      if (Math.abs(remainder) > 0.01) kinds.add('valor');
      const orderPerson = order.delivery_person?.trim().toLowerCase();
      txs.forEach(tx => {
        if (tx.match_type === 'exact_method_divergence') kinds.add('metodo');
        if (tx.match_type === 'exact_structure_divergence') kinds.add('estrutura');
        if (tx.match_type === 'combined_undeclared') kinds.add('combinado_nd');
        const inferred = tx.machine_serial ? serialToDeliveryPerson.get(normalizeSerial(tx.machine_serial)) : null;
        if (inferred && orderPerson && inferred.trim().toLowerCase() !== orderPerson) kinds.add('entregador');
      });
      if (kinds.size > 0) map.set(order.id, kinds);
    });
    return map;
  }, [offlineOrders, matchedOrderIds, serialToDeliveryPerson, orderMoney]);

  const stats = useMemo(() => {
    const total = offlineOrders.length;
    const matched = offlineOrders.filter(o => matchedOrderIds.has(o.id)).length;
    const highConf = offlineOrders.filter(o => {
      const txs = matchedOrderIds.get(o.id);
      return txs?.[0]?.match_confidence === 'high';
    }).length;
    return { total, matched, pending: total - matched, highConf, divergent: divergenceMap.size, cash: cashOnlyOrders.length, txTotal: transactions.length, txUnmatched: unmatchedTransactions.length };
  }, [offlineOrders, matchedOrderIds, transactions, unmatchedTransactions, divergenceMap, cashOnlyOrders]);

  const OFFLINE_CATEGORIES = ['(COBRAR) Pix', 'Crédito', 'Débito', 'Voucher'] as const;

  const offlineMethodTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    OFFLINE_CATEGORIES.forEach(c => totals[c] = 0);

    const breakdownsByOrder = new Map<string, typeof breakdowns>();
    breakdowns.forEach(b => {
      if (!breakdownsByOrder.has(b.imported_order_id)) breakdownsByOrder.set(b.imported_order_id, []);
      breakdownsByOrder.get(b.imported_order_id)!.push(b);
    });

    const matchCategory = (methodName: string): string | null => {
      const lower = methodName.toLowerCase().trim();
      if (lower.includes('pago online') || lower.includes('(pago)') || lower.includes('online')) return null;
      if (lower === 'dinheiro') return null;
      if (lower.includes('(cobrar) pix') || lower === '(cobrar) pix') return '(COBRAR) Pix';
      if (lower.includes('crédit') || lower.includes('crédito') || lower === 'credito') return 'Crédito';
      if (lower.includes('débit') || lower.includes('débito') || lower === 'debito') return 'Débito';
      if (lower.includes('voucher') && !lower.includes('voucher parceiro')) return 'Voucher';
      return null;
    };

    for (const order of activeOrders) {
      const orderBks = breakdownsByOrder.get(order.id);
      if (orderBks && orderBks.length > 0) {
        for (const b of orderBks) {
          const cat = matchCategory(b.payment_method_name);
          if (cat) totals[cat] += b.amount;
        }
      } else {
        const methods = order.payment_method.split(',').map(m => m.trim()).filter(Boolean);
        // Voucher Parceiro Desconto: do not skip the entire order — decompose to keep physical part

        const matchingCats = methods
          .map(m => matchCategory(m))
          .filter((c): c is string => c !== null);

        if (matchingCats.length === 1) {
          totals[matchingCats[0]] += order.total_amount;
        } else if (matchingCats.length > 1) {
          const share = order.total_amount / matchingCats.length;
          matchingCats.forEach(cat => { totals[cat] += share; });
        }
      }
    }

    return totals;
  }, [activeOrders, breakdowns]);

  // Dinheiro teórico (Saipos): informativo, não exige match. Soma a parte em dinheiro
  // de cada pedido (breakdown 'dinheiro', ou total quando o pedido é só dinheiro).
  const cashTheoretical = useMemo(() => {
    const byOrder = new Map<string, typeof breakdowns>();
    breakdowns.forEach(b => {
      if (!byOrder.has(b.imported_order_id)) byOrder.set(b.imported_order_id, []);
      byOrder.get(b.imported_order_id)!.push(b);
    });
    let total = 0;
    for (const order of activeOrders) {
      const bks = byOrder.get(order.id);
      if (bks && bks.length > 0) {
        for (const b of bks) {
          if (normalizeDeliveryMethod(b.payment_method_name) === 'dinheiro') total += b.amount;
        }
      } else {
        const methods = order.payment_method.split(',').map(m => m.trim()).filter(Boolean);
        const norms = methods.map(m => normalizeDeliveryMethod(m));
        if (norms.length === 1 && norms[0] === 'dinheiro') total += order.total_amount;
      }
    }
    return total;
  }, [activeOrders, breakdowns]);

  const allDeliveryPersons = useMemo(() => {
    const set = new Set<string>();
    activeOrders.forEach(o => { if (o.delivery_person) set.add(o.delivery_person); });
    return Array.from(set).sort();
  }, [activeOrders]);

  const confirmedDriverNames = useMemo(() => confirmedDrivers.map(d => d.nome), [confirmedDrivers]);

  const deliveryPersons = useMemo(() => {
    const set = new Set<string>();
    offlineOrders.forEach(o => { if (o.delivery_person) set.add(o.delivery_person); });
    const all = Array.from(set);
    const confirmed = all.filter(d => confirmedDriverNames.includes(d));
    const others = all.filter(d => !confirmedDriverNames.includes(d));
    return [...confirmed.sort(), ...others.sort()];
  }, [offlineOrders, confirmedDriverNames]);

  // Métodos físicos normalizados de um pedido (prioriza breakdowns do operador)
  const orderPhysicalMethods = useCallback((o: Order): NormalizedDeliveryMethod[] => {
    const orderBks = breakdowns.filter(b => b.imported_order_id === o.id && b.payment_type === 'fisico');
    const src = orderBks.length > 0
      ? orderBks.map(b => b.payment_method_name)
      : o.payment_method.split(',');
    return src.map(m => normalizeDeliveryMethod(m));
  }, [breakdowns]);

  // Filtro de forma de pagamento: categorias canônicas (sem duplicar à vista/parcelado etc)
  const PAYMENT_FILTER_OPTIONS: { key: NormalizedDeliveryMethod; label: string }[] = [
    { key: 'pix', label: '(COBRAR) Pix' },
    { key: 'credito', label: 'Crédito' },
    { key: 'debito', label: 'Débito' },
    { key: 'voucher', label: 'Voucher' },
    { key: 'dinheiro', label: 'Dinheiro' },
  ];
  const paymentMethodsFilter = useMemo(() => {
    const present = new Set<NormalizedDeliveryMethod>();
    [...offlineOrders, ...cashOnlyOrders].forEach(o => orderPhysicalMethods(o).forEach(m => present.add(m)));
    return PAYMENT_FILTER_OPTIONS.filter(opt => present.has(opt.key));
  }, [offlineOrders, cashOnlyOrders, orderPhysicalMethods]);

  const filtered = useMemo(() => {
    return [...offlineOrders, ...cashOnlyOrders].filter(o => {
      const isCash = cashOnlyIds.has(o.id);
      if (search && !o.order_number.toLowerCase().includes(search.toLowerCase())) return false;
      // Pedidos em dinheiro não precisam de conciliação: só aparecem sem filtro de status/divergência
      if (isCash) {
        if (filterMatch !== 'all') return false;
        if (filterDivergence !== 'all') return false;
      } else {
        if (filterMatch === 'matched' && !matchedOrderIds.has(o.id)) return false;
        if (filterMatch === 'unmatched' && matchedOrderIds.has(o.id)) return false;
        if (filterDivergence !== 'all') {
          const kinds = divergenceMap.get(o.id);
          if (!kinds) return false;
          if (filterDivergence !== 'any' && !kinds.has(filterDivergence as DivergenceKind)) return false;
        }
      }
      if (filterDeliveryPerson !== 'all' && o.delivery_person !== filterDeliveryPerson) return false;
      if (filterPaymentMethod !== 'all') {
        if (!orderPhysicalMethods(o).includes(filterPaymentMethod as NormalizedDeliveryMethod)) return false;
      }
      return true;
    }).sort((a, b) => {
      const aNum = parseInt(a.order_number.replace(/\D/g, ''), 10) || 0;
      const bNum = parseInt(b.order_number.replace(/\D/g, ''), 10) || 0;
      return aNum - bNum;
    });
  }, [offlineOrders, cashOnlyOrders, cashOnlyIds, search, filterMatch, filterDeliveryPerson, filterPaymentMethod, filterDivergence, matchedOrderIds, orderPhysicalMethods, divergenceMap]);

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
        activeOrders.map(o => ({
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
  }, [user, id, activeOrders, breakdowns, loadData]);

  const reprocessAutomaticMatches = useCallback(async () => {
    if (!id || isReprocessing || transactions.length === 0) return;

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
        activeOrders
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
        breakdowns,
        serialToDeliveryPerson
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
        toast.success(`Conciliação reprocessada com alocação global (${reprocessedMatches.length} vínculos automáticos).`);
      }

      await loadData();
    } catch (error) {
      console.error(error);
      toast.error('Erro ao reprocessar a conciliação.');
    } finally {
      setIsReprocessing(false);
      setHasAutoReprocessed(true);
    }
  }, [breakdowns, id, isReprocessing, loadData, activeOrders, transactions]);

  useEffect(() => {
    if (loading || hasAutoReprocessed || transactions.length === 0) return;
    void reprocessAutomaticMatches();
  }, [hasAutoReprocessed, loading, reprocessAutomaticMatches, transactions.length]);

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

  // ===== Item 2: agrupar várias transações + parte em dinheiro =====
  const openGroupDialog = useCallback((order: Order) => {
    const alreadyMatched = transactions.filter(t => t.matched_order_id === order.id).map(t => t.id);
    setGroupingOrder(order);
    setGroupSelectedTxIds(new Set(alreadyMatched));
    setGroupCash(order.manual_cash_amount ? String(order.manual_cash_amount) : '');
  }, [transactions]);

  const handleConfirmGroup = useCallback(async () => {
    if (!groupingOrder) return;
    setGroupSaving(true);
    try {
      const cash = parseFloat(groupCash.replace(',', '.')) || 0;
      const selectedIds = Array.from(groupSelectedTxIds);

      // Solta transações que estavam neste pedido e foram desmarcadas
      const previouslyLinked = transactions.filter(t => t.matched_order_id === groupingOrder.id).map(t => t.id);
      const toUnlink = previouslyLinked.filter(tid => !groupSelectedTxIds.has(tid));
      if (toUnlink.length > 0) {
        await supabase.from('card_transactions')
          .update({ matched_order_id: null, match_type: null, match_confidence: null })
          .in('id', toUnlink);
      }

      // Vincula as selecionadas a este pedido (manual)
      if (selectedIds.length > 0) {
        await supabase.from('card_transactions')
          .update({ matched_order_id: groupingOrder.id, match_type: 'manual', match_confidence: 'high' })
          .in('id', selectedIds);
      }

      // Grava a parte em dinheiro declarada
      await supabase.from('imported_orders')
        .update({ manual_cash_amount: cash })
        .eq('id', groupingOrder.id);

      toast.success('Pedido agrupado e conciliado.');
      setGroupingOrder(null);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao agrupar transações.');
    } finally {
      setGroupSaving(false);
    }
  }, [groupingOrder, groupCash, groupSelectedTxIds, transactions, loadData]);

  // ===== Item 4: marcar pedido como cancelado / reativar =====
  const handleCancelOrder = useCallback(async (order: Order) => {
    setBusyOrderId(order.id);
    try {
      // Solta vínculos de maquininha do pedido cancelado
      await supabase.from('card_transactions')
        .update({ matched_order_id: null, match_type: null, match_confidence: null })
        .eq('matched_order_id', order.id);
      await supabase.from('imported_orders')
        .update({ is_cancelled: true, cancelled_at: new Date().toISOString(), manual_cash_amount: 0 })
        .eq('id', order.id);
      toast.success(`Pedido #${order.order_number} marcado como cancelado.`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao cancelar pedido.');
    } finally {
      setBusyOrderId(null);
    }
  }, [loadData]);

  const handleReactivateOrder = useCallback(async (order: Order) => {
    setBusyOrderId(order.id);
    try {
      await supabase.from('imported_orders')
        .update({ is_cancelled: false, cancelled_at: null })
        .eq('id', order.id);
      toast.success(`Pedido #${order.order_number} reativado.`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao reativar pedido.');
    } finally {
      setBusyOrderId(null);
    }
  }, [loadData]);

  // Marca o valor que "ficou pra trás" como pagamento em dinheiro
  const handleMarkRemainderCash = useCallback(async (order: Order, remainder: number) => {
    setBusyOrderId(order.id);
    try {
      const newCash = Math.round(((order.manual_cash_amount || 0) + remainder) * 100) / 100;
      await supabase.from('imported_orders')
        .update({ manual_cash_amount: newCash })
        .eq('id', order.id);
      toast.success(`${formatCurrency(remainder)} marcado como dinheiro no pedido #${order.order_number}.`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao marcar dinheiro.');
    } finally {
      setBusyOrderId(null);
    }
  }, [loadData]);

  // ===== Item 3: migrar pedido para o caixa salão do mesmo dia =====
  const handleMigrateToSalon = useCallback(async (order: Order) => {
    setBusyOrderId(order.id);
    try {
      const { data, error } = await supabase.functions.invoke('migrate-order-to-salon', {
        body: { order_id: order.id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Pedido #${order.order_number} migrado para o caixa salão.`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao migrar para o salão.');
    } finally {
      setBusyOrderId(null);
    }
  }, [loadData]);

  const handleFinalizeReconciliation = useCallback(async () => {
    if (!id || !canConciliar) return;
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
  }, [id, canConciliar]);

  const handleReopenReconciliation = useCallback(async () => {
    if (!id || !canConciliar) return;
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
  }, [id, canConciliar]);


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

  if (!canView('op.tele.conciliacao')) {
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

  const percent = stats.total > 0 ? Math.round((stats.matched / stats.total) * 100) : 0;


  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppSidebar />
      <div className="ml-56 flex flex-col flex-1">
      
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(`/reconciliation/${id}`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-base font-semibold text-foreground">
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
            {isReprocessing && (
              <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                Reprocessando com trava por método…
              </Badge>
            )}
            <div className="flex items-center bg-muted rounded-lg p-0.5 border border-border">
                <Button
                  variant={activeTab === 'classic' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setActiveTab('classic')}
                >
                  Conciliação Clássica
                </Button>
                <Button
                  variant={activeTab === 'atlas' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setActiveTab('atlas')}
                >
                  <Rocket className="h-3.5 w-3.5 mr-1" />
                  Atlas Musk
                </Button>
              </div>
          </div>
        </div>
      </header>

      {/* Atlas Musk View */}
      {activeTab === 'atlas' ? (
        <div className="flex-1 overflow-auto px-6 py-4">
          <AtlasMuskView
            closingDate={closingDate}
            orders={orders}
            transactions={transactions}
            breakdowns={breakdowns}
            serialToDeliveryPerson={serialToDeliveryPerson}
            onManualMatch={manualMatch}
            onUnmatch={unmatch}
          />
        </div>
      ) : (
      <>
      {/* 1. Cash Snapshot - Abertura */}
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
            <div className="flex items-center gap-2 bg-success/5 rounded-lg px-3 py-2 border border-dashed border-success/40 min-w-[150px]">
              <Banknote className="h-4 w-4 text-success" />
              <div>
                <p className="text-[10px] text-muted-foreground leading-tight">💵 Dinheiro (informativo)</p>
                <p className="text-sm font-semibold text-success font-mono">{formatCurrency(cashTheoretical)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Total Recebido via Maquininhas */}
      {id && (
        <MachineReadingsSection
          dailyClosingId={id}
          deliveryPersons={allDeliveryPersons}
          isCompleted={true}
          mode="totals"
        />
      )}

      {/* 4. Total Recebido via Maquininhas - Real */}
      {(() => {
        const methodSummary: Record<string, { total: number; count: number }> = {
          '(COBRAR) Pix': { total: 0, count: 0 },
          'Crédito': { total: 0, count: 0 },
          'Débito': { total: 0, count: 0 },
          'Voucher': { total: 0, count: 0 },
        };
        transactions.forEach(tx => {
          const method = tx.payment_method?.toLowerCase() || 'outro';
          let label = 'Outro';
          if (method.includes('pix')) label = '(COBRAR) Pix';
          else if (method.includes('débit') || method.includes('debit')) label = 'Débito';
          else if (method.includes('crédit') || method.includes('credit')) label = 'Crédito';
          else if (method.includes('voucher')) label = 'Voucher';
          if (!methodSummary[label]) methodSummary[label] = { total: 0, count: 0 };
          methodSummary[label].total += tx.gross_amount;
          methodSummary[label].count += 1;
        });
        const fixedOrder = ['(COBRAR) Pix', 'Crédito', 'Débito', 'Voucher'];
        const iconMap: Record<string, React.ReactNode> = {
          '(COBRAR) Pix': <QrCode className="h-4 w-4 text-primary" />,
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

      <SaiposCancellationsPanel closingDate={closingDate} scope="tele" />

      {/* 6. Resumo de Pedidos */}
      <div className="border-b border-border bg-card">
        <div className="px-6 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Resumo de Pedidos</p>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[120px]">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-[10px] text-muted-foreground leading-tight">Comandas Offline</p>
                <p className="text-sm font-semibold text-foreground font-mono-tabular">{stats.total}</p>
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
            <button
              type="button"
              onClick={() => setFilterDivergence(filterDivergence === 'any' ? 'all' : 'any')}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 border min-w-[120px] text-left transition-colors ${
                filterDivergence !== 'all'
                  ? 'bg-amber-500/15 border-amber-500/50 ring-1 ring-amber-500/30'
                  : stats.divergent > 0
                    ? 'bg-amber-500/10 border-amber-500/40 hover:bg-amber-500/15'
                    : 'bg-muted border-border hover:bg-muted/70'
              }`}
              title="Mostrar só pedidos com divergência"
            >
              <AlertTriangle className={`h-4 w-4 ${stats.divergent > 0 ? 'text-amber-600' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-[10px] text-muted-foreground leading-tight">Divergências</p>
                <p className={`text-sm font-semibold font-mono-tabular ${stats.divergent > 0 ? 'text-amber-600' : 'text-foreground'}`}>{stats.divergent}</p>
              </div>
            </button>
            {stats.cash > 0 && (
              <button
                type="button"
                onClick={() => setFilterPaymentMethod(filterPaymentMethod === 'dinheiro' ? 'all' : 'dinheiro')}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 border min-w-[120px] text-left transition-colors ${
                  filterPaymentMethod === 'dinheiro'
                    ? 'bg-success/15 border-success/50 ring-1 ring-success/30'
                    : 'bg-success/5 border-success/40 hover:bg-success/10'
                }`}
                title="Mostrar só pedidos em dinheiro"
              >
                <Banknote className="h-4 w-4 text-success" />
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Dinheiro</p>
                  <p className="text-sm font-semibold text-success font-mono-tabular">{stats.cash}</p>
                </div>
              </button>
            )}
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[120px]">
              <Truck className="h-4 w-4 text-muted-foreground" />
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
                  <div className="h-full bg-primary rounded-full row-transition" style={{ width: `${percent}%` }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Confirmed drivers info */}
      {confirmedDrivers.length > 0 && (
        <div className="border-b border-border bg-primary/5 px-6 py-2.5 flex items-center gap-2 text-sm">
          <Truck className="h-4 w-4 text-primary shrink-0" />
          <span className="text-muted-foreground">Entregadores confirmados hoje:</span>
          <span className="font-medium text-foreground">{confirmedDrivers.map(d => d.nome).join(', ')}</span>
          <span className="text-xs text-muted-foreground">({confirmedDrivers.length})</span>
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
                <SelectItem key={dp} value={dp}>
                  {dp}{confirmedDriverNames.includes(dp) ? ' ✓' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterPaymentMethod} onValueChange={setFilterPaymentMethod}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Pagamento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <span className="flex items-center gap-2"><Wallet className="h-3.5 w-3.5 text-muted-foreground" />Todas as formas</span>
              </SelectItem>
              {paymentMethodsFilter.map(pm => {
                const icon = pm.key === 'pix'
                  ? <QrCode className="h-3.5 w-3.5 text-primary" />
                  : pm.key === 'dinheiro'
                    ? <Banknote className="h-3.5 w-3.5 text-success" />
                    : pm.key === 'voucher'
                      ? <CreditCard className="h-3.5 w-3.5 text-warning" />
                      : pm.key === 'debito'
                        ? <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                        : <CreditCard className="h-3.5 w-3.5 text-accent-foreground" />;
                return (
                  <SelectItem key={pm.key} value={pm.key}>
                    <span className="flex items-center gap-2">{icon}{pm.label}</span>
                  </SelectItem>
                );
              })}
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
          <Select value={filterDivergence} onValueChange={setFilterDivergence}>
            <SelectTrigger className={`w-[200px] h-9 ${filterDivergence !== 'all' ? 'border-amber-500/60 text-amber-700 dark:text-amber-400' : ''}`}>
              <span className="flex items-center gap-1.5">
                <AlertTriangle className={`h-3.5 w-3.5 ${filterDivergence !== 'all' ? 'text-amber-600' : 'text-muted-foreground'}`} />
                <SelectValue placeholder="Divergências" />
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas (sem filtro)</SelectItem>
              <SelectItem value="any">⚠ Só com divergência{stats.divergent > 0 ? ` (${stats.divergent})` : ''}</SelectItem>
              <SelectItem value="metodo">{DIVERGENCE_LABELS.metodo}</SelectItem>
              <SelectItem value="estrutura">{DIVERGENCE_LABELS.estrutura}</SelectItem>
              <SelectItem value="combinado_nd">{DIVERGENCE_LABELS.combinado_nd}</SelectItem>
              <SelectItem value="entregador">{DIVERGENCE_LABELS.entregador}</SelectItem>
              <SelectItem value="valor">{DIVERGENCE_LABELS.valor}</SelectItem>
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
                // Pedido só em dinheiro: card informativo, sem conciliação de cartão
                if (cashOnlyIds.has(order.id)) {
                  return (
                    <div key={order.id} className="bg-card rounded-lg border border-success/40 bg-success/5 p-3 row-transition">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-6 w-6 rounded-full flex items-center justify-center bg-success/80 text-success-foreground">
                            <Banknote className="h-3.5 w-3.5" />
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
                          <span className="text-sm font-mono-tabular font-medium text-foreground">{formatCurrency(order.total_amount)}</span>
                          <Badge variant="secondary" className="text-[10px] bg-success/15 text-success border border-success/30">
                            <Banknote className="h-3 w-3 mr-1" />Dinheiro
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">sem conciliação</span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={busyOrderId === order.id}>
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openGroupDialog(order)}>
                                <Layers className="h-4 w-4 mr-2" />Agrupar transações
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleMigrateToSalon(order)}>
                                <Store className="h-4 w-4 mr-2" />Migrar p/ salão
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleCancelOrder(order)} className="text-destructive focus:text-destructive">
                                <Ban className="h-4 w-4 mr-2" />Marcar como cancelado
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  );
                }
                const matchedTxs = matchedOrderIds.get(order.id);
                const isMatched = !!matchedTxs && matchedTxs.length > 0;
                const confidence = matchedTxs?.[0]?.match_confidence;
                const isCombined = matchedTxs && matchedTxs.length > 1;
                const totalMatchedAmount = matchedTxs?.reduce((s, t) => s + t.gross_amount, 0) || 0;
                const money = orderMoney(order, totalMatchedAmount);
                // Mostra o detalhamento quando há mais de uma parte ou algo a explicar
                const showBreakdown = isMatched && (
                  isCombined || money.cash > 0 || money.online > 0 || Math.abs(money.remainder) > 0.01
                );
                const pendingInfo = pendingMeta.get(order.id);
                const divergences = divergenceMap.get(order.id);
                const isDivergent = !!divergences && divergences.size > 0;

                return (
                  <div
                    key={order.id}
                    className={`bg-card rounded-lg border p-3 row-transition ${
                      isDivergent
                        ? 'border-amber-500/70 bg-amber-500/10 ring-1 ring-amber-500/40 shadow-[inset_4px_0_0_0_hsl(var(--warning))]'
                        : isMatched
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
                          {(() => {
                            // Prefer real driver name inferred from matched transaction's machine SN
                            const inferredFromMatch = matchedTxs?.map(t => t.machine_serial ? serialToDeliveryPerson.get(normalizeSerial(t.machine_serial)) : null).find(Boolean) || null;
                            const display = inferredFromMatch || order.delivery_person || '—';
                            return <span className="text-xs text-muted-foreground ml-2">{display}</span>;
                          })()}
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
                        {isDivergent && (
                          <Badge variant="secondary" className="text-[10px] font-semibold border border-amber-500/60 bg-amber-500/20 text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            {divergences!.size === 1
                              ? DIVERGENCE_LABELS[Array.from(divergences!)[0]]
                              : `${divergences!.size} divergências`}
                          </Badge>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" disabled={busyOrderId === order.id}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openGroupDialog(order)}>
                              <Layers className="h-4 w-4 mr-2" />
                              Agrupar transações
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleMigrateToSalon(order)}>
                              <Store className="h-4 w-4 mr-2" />
                              Migrar p/ salão
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleCancelOrder(order)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Ban className="h-4 w-4 mr-2" />
                              Marcar como cancelado
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>

                    {isMatched && matchedTxs && (
                      <div className="mt-2 pt-2 border-t border-border/50">
                        {matchedTxs.map((tx, idx) => (
                          <div key={tx.id} className={`flex items-center justify-between ${idx > 0 ? 'mt-1.5 pt-1.5 border-t border-border/30' : ''}`}>
                            <div className="flex items-center gap-2 text-xs">
                              <Link2 className="h-3 w-3 text-success" />
                              <span className="text-muted-foreground">
                                {canonicalizePaymentMethod(tx.payment_method)} {tx.sale_time ? `(${tx.sale_time})` : ''}
                                {(() => {
                                  const inferredPerson = tx.machine_serial ? serialToDeliveryPerson.get(normalizeSerial(tx.machine_serial)) : null;
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
                              {idx === 0 && (() => {
                                const matchLabel = (() => {
                                  switch (tx.match_type) {
                                    case 'manual': return 'Manual';
                                    case 'combined': return 'Match combinado';
                                    case 'combined_undeclared': return 'Match combinado não declarado';
                                    case 'exact_method_divergence': return 'Match exato · método divergente';
                                    case 'exact_structure_divergence': return 'Match exato · estrutura divergente';
                                    case 'exact': return 'Match exato';
                                    case 'approximate': return 'Match aproximado';
                                    default:
                                      return confidence === 'high' ? 'Match exato'
                                        : confidence === 'medium' ? 'Match aproximado'
                                        : 'Baixa confiança';
                                  }
                                })();
                                const isDivergence = tx.match_type === 'exact_method_divergence' || tx.match_type === 'exact_structure_divergence';
                                const isUndeclared = tx.match_type === 'combined_undeclared';
                                const isDivergentBadge = isDivergence || isUndeclared;
                                const badgeColor = isDivergence
                                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/60 font-semibold'
                                  : isUndeclared
                                    ? 'bg-violet-500/20 text-violet-700 dark:text-violet-300 border border-violet-500/60 font-semibold'
                                    : confidence === 'high'
                                      ? 'bg-success/10 text-success'
                                      : confidence === 'medium'
                                        ? 'bg-primary/10 text-primary'
                                        : 'bg-warning/10 text-warning';
                                return (
                                  <Badge variant="secondary" className={`text-[9px] ${badgeColor}`}>
                                    {isDivergentBadge && <AlertTriangle className="h-2.5 w-2.5 mr-1" />}
                                    {matchLabel}
                                  </Badge>
                                );
                              })()}
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
                        {showBreakdown && (
                          <div className="mt-1.5 text-[10px] text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span>Comanda: <span className="font-mono-tabular font-medium text-foreground">{formatCurrency(money.total)}</span></span>
                            <span>· Cartão: <span className="font-mono-tabular font-medium">{formatCurrency(money.card)}</span></span>
                            {money.cash > 0.01 && (
                              <span>· Dinheiro: <span className="font-mono-tabular font-medium text-success">{formatCurrency(money.cash)}</span></span>
                            )}
                            {money.online > 0.01 && (
                              <span>· Já recebido: <span className="font-mono-tabular font-medium text-primary">{formatCurrency(money.online)}</span></span>
                            )}
                            {Math.abs(money.remainder) > 0.01 && (
                              <span className="text-warning font-medium">· Falta explicar: {formatCurrency(money.remainder)}</span>
                            )}
                            {money.remainder > 0.01 && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-5 px-1.5 text-[10px] border-success/50 text-success hover:bg-success/10"
                                disabled={busyOrderId === order.id}
                                onClick={() => handleMarkRemainderCash(order, money.remainder)}
                              >
                                <Banknote className="h-2.5 w-2.5 mr-1" />
                                marcar como dinheiro
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {!isMatched && pendingInfo && (
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

            {/* Pedidos cancelados / migrados para o salão */}
            {inactiveOrders.length > 0 && (
              <div className="mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => setShowInactive(v => !v)}
                >
                  {showInactive ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
                  Cancelados / migrados ({inactiveOrders.length})
                </Button>
                {showInactive && (
                  <div className="space-y-1.5 mt-2">
                    {inactiveOrders.map(order => (
                      <div key={order.id} className="bg-muted/40 rounded-lg border border-border/60 p-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          {order.is_cancelled ? (
                            <Badge variant="secondary" className="text-[10px] bg-destructive/10 text-destructive border border-destructive/20">
                              <Ban className="h-3 w-3 mr-1" />Cancelado
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border border-primary/20">
                              <Store className="h-3 w-3 mr-1" />Salão
                            </Badge>
                          )}
                          <span className="text-sm font-medium text-foreground truncate">#{order.order_number}</span>
                          <span className="text-xs text-muted-foreground font-mono-tabular">{formatCurrency(order.total_amount)}</span>
                        </div>
                        {order.is_cancelled && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            disabled={busyOrderId === order.id}
                            onClick={() => handleReactivateOrder(order)}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" />Reativar
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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
                          <span className="text-xs font-medium text-foreground">{canonicalizePaymentMethod(tx.payment_method)}</span>
                          <span className="text-sm font-mono-tabular font-medium text-foreground">
                            {formatCurrency(tx.gross_amount)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {tx.machine_serial && serialToDeliveryPerson.has(normalizeSerial(tx.machine_serial)) ? (
                            <span className="text-[10px] font-medium text-primary flex items-center gap-0.5">
                              <Truck className="h-2.5 w-2.5" />
                              {serialToDeliveryPerson.get(normalizeSerial(tx.machine_serial))}
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
      {canConciliar && (
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
      </>
      )}

      {/* Dialog: agrupar transações + parte em dinheiro (item 2) */}
      <Dialog open={!!groupingOrder} onOpenChange={(o) => { if (!o) setGroupingOrder(null); }}>
        <DialogContent className="max-w-lg">
          {groupingOrder && (() => {
            const candidates = transactions.filter(
              t => !t.matched_order_id || t.matched_order_id === groupingOrder.id
            );
            const selectedSum = candidates
              .filter(t => groupSelectedTxIds.has(t.id))
              .reduce((s, t) => s + t.gross_amount, 0);
            const cash = parseFloat(groupCash.replace(',', '.')) || 0;
            const known = orderNonCardKnown(groupingOrder.id); // dinheiro Saipos + já recebido (online/voucher)
            const remaining = groupingOrder.total_amount - selectedSum - cash - known.saiposCash - known.online;
            const canConfirm = Math.abs(remaining) < 0.01;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Agrupar pagamentos — Pedido #{groupingOrder.order_number}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="flex items-center justify-between bg-muted rounded-lg px-3 py-2 border border-border">
                    <span className="text-xs text-muted-foreground">Total do pedido</span>
                    <span className="text-sm font-bold font-mono-tabular text-foreground">{formatCurrency(groupingOrder.total_amount)}</span>
                  </div>

                  <div>
                    <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Transações da maquininha</Label>
                    <div className="mt-1.5 space-y-1 max-h-56 overflow-auto">
                      {candidates.length === 0 && (
                        <p className="text-xs text-muted-foreground py-2">Nenhuma transação disponível para vincular.</p>
                      )}
                      {candidates.map(tx => {
                        const checked = groupSelectedTxIds.has(tx.id);
                        const person = tx.machine_serial ? serialToDeliveryPerson.get(normalizeSerial(tx.machine_serial)) : null;
                        return (
                          <label
                            key={tx.id}
                            className={`flex items-center gap-2 rounded-md border px-2.5 py-2 cursor-pointer ${checked ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => setGroupSelectedTxIds(prev => {
                                const next = new Set(prev);
                                if (next.has(tx.id)) next.delete(tx.id); else next.add(tx.id);
                                return next;
                              })}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-foreground">{canonicalizePaymentMethod(tx.payment_method)}</span>
                                <span className="text-sm font-mono-tabular font-medium text-foreground">{formatCurrency(tx.gross_amount)}</span>
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                {person && <span className="text-primary flex items-center gap-0.5"><Truck className="h-2.5 w-2.5" />{person}</span>}
                                {tx.sale_time && <span><Clock className="h-2.5 w-2.5 inline mr-0.5" />{tx.sale_time}</span>}
                                {tx.machine_serial && <span className="font-mono-tabular">{tx.machine_serial.slice(-6)}</span>}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="group-cash" className="text-[11px] uppercase tracking-wider text-muted-foreground">Valor recebido em dinheiro</Label>
                    <Input
                      id="group-cash"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={groupCash}
                      onChange={e => setGroupCash(e.target.value)}
                      className="mt-1.5 h-9"
                    />
                  </div>

                  <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total da comanda</span><span className="font-mono-tabular">{formatCurrency(groupingOrder.total_amount)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Cartões selecionados</span><span className="font-mono-tabular">{formatCurrency(selectedSum)}</span></div>
                    {known.saiposCash > 0.01 && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Dinheiro (Saipos)</span><span className="font-mono-tabular">{formatCurrency(known.saiposCash)}</span></div>
                    )}
                    {known.online > 0.01 && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Já recebido (online/voucher)</span><span className="font-mono-tabular text-primary">{formatCurrency(known.online)}</span></div>
                    )}
                    <div className="flex justify-between"><span className="text-muted-foreground">Dinheiro (informar)</span><span className="font-mono-tabular text-success">{formatCurrency(cash)}</span></div>
                    <div className="flex justify-between border-t border-border pt-1 font-medium">
                      <span>{canConfirm ? 'Confere com o total' : 'Falta para fechar'}</span>
                      <span className={`font-mono-tabular ${canConfirm ? 'text-success' : 'text-warning'}`}>
                        {canConfirm ? formatCurrency(groupingOrder.total_amount) : formatCurrency(remaining)}
                      </span>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" size="sm" onClick={() => setGroupingOrder(null)} disabled={groupSaving}>Cancelar</Button>
                  <Button
                    size="sm"
                    className="bg-success hover:bg-success/90 text-success-foreground"
                    onClick={handleConfirmGroup}
                    disabled={!canConfirm || groupSaving}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    {groupSaving ? 'Salvando...' : 'Conciliar pedido'}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}

