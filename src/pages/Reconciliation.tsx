import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, Search, CheckCircle2, Clock, AlertTriangle, PartyPopper, CheckCheck, XCircle, ChevronDown, ChevronRight, ChevronUp, SplitSquareHorizontal, Wifi, CreditCard, ArrowUpDown, Plus, FileSpreadsheet, Eye, EyeOff, Settings2, Truck, Pencil, Banknote, QrCode, CreditCard as CreditCardIcon, Calculator, Save, AlertCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import PaymentBreakdown from '@/components/PaymentBreakdown';
import AppSidebar from '@/components/AppSidebar';
import { needsBreakdown, formatCurrency, getPaymentBadgeType, isAllOnline, isOnlinePayment, type PaymentBadgeType } from '@/lib/payment-utils';

type SortField = 'order_number' | 'payment_method' | 'is_confirmed';
type SortDirection = 'asc' | 'desc';

function extractOrderNumber(orderNumber: string): number {
  const num = parseInt(orderNumber.replace(/\D/g, ''), 10);
  return isNaN(num) ? 0 : num;
}

interface Order {
  id: string;
  order_number: string;
  payment_method: string;
  total_amount: number;
  delivery_person: string | null;
  is_confirmed: boolean;
  sale_date: string | null;
  sale_time: string | null;
  sales_channel: string | null;
  partner_order_number: string | null;
}

interface ClosingData {
  closing_date: string;
  status: string;
}

interface ImportRecord {
  id: string;
  file_name: string;
  created_at: string;
  total_rows: number;
  new_rows: number;
  duplicate_rows: number;
}

export default function Reconciliation() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [closingData, setClosingData] = useState<ClosingData | null>(null);
  const [importRecords, setImportRecords] = useState<ImportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPayment, setFilterPayment] = useState('all');
  const [filterDelivery, setFilterDelivery] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [completing, setCompleting] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [breakdownValidity, setBreakdownValidity] = useState<Record<string, boolean>>({});
  const [sortField, setSortField] = useState<SortField>('order_number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showImportHistory, setShowImportHistory] = useState(false);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [allBreakdowns, setAllBreakdowns] = useState<Array<{ imported_order_id: string; payment_method_name: string; payment_type: string; amount: number }>>([]);
  const [visibleColumns, setVisibleColumns] = useState({
    sale_date: false,
    sale_time: false,
    sales_channel: false,
    partner_order_number: false,
  });

  // Cash calculator state
  const [showCashCalc, setShowCashCalc] = useState(false);
  const CASH_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.50, 0.25, 0.10, 0.05];
  const [cashCounts, setCashCounts] = useState<Record<number, number>>({});
  const cashTotal = useMemo(() => CASH_DENOMINATIONS.reduce((sum, d) => sum + d * (cashCounts[d] || 0), 0), [cashCounts]);
  const [cashSnapshotSaved, setCashSnapshotSaved] = useState(false);
  const [cashSnapshotData, setCashSnapshotData] = useState<{ counts: Record<string, number>; total: number; updated_at: string } | null>(null);
  const [savingCash, setSavingCash] = useState(false);

  // Save conference state
  const [showConferenceErrors, setShowConferenceErrors] = useState(false);
  const [conferenceErrors, setConferenceErrors] = useState<string[]>([]);


  const toggleColumn = (col: keyof typeof visibleColumns) => {
    setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }));
  };

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  const loadData = async () => {
    // Load closing data
    const { data: closing } = await supabase
      .from('daily_closings')
      .select('closing_date, status')
      .eq('id', id!)
      .single();

    setClosingData(closing);

    // Load orders and imports for this closing
    const [{ data: ordData }, { data: impData }] = await Promise.all([
      supabase
        .from('imported_orders')
        .select('id, order_number, payment_method, total_amount, delivery_person, is_confirmed, sale_date, sale_time, sales_channel, partner_order_number')
        .eq('daily_closing_id', id!),
      supabase
        .from('imports')
        .select('id, file_name, created_at, total_rows, new_rows, duplicate_rows')
        .eq('daily_closing_id', id!)
        .order('created_at', { ascending: false }),
    ]);

    const ordersList = ordData || [];
    setOrders(ordersList);
    setImportRecords(impData || []);

    // Load all breakdowns for orders in this closing
    if (ordersList.length > 0) {
      const orderIds = ordersList.map(o => o.id);
      const { data: bkData } = await supabase
        .from('order_payment_breakdowns')
        .select('imported_order_id, payment_method_name, payment_type, amount')
        .in('imported_order_id', orderIds);
      const breakdowns = (bkData || []).map(b => ({ ...b, amount: Number(b.amount) }));
      setAllBreakdowns(breakdowns);

      // Pre-compute breakdown validity so orders with completed rateio aren't shown as pending
      const validityMap: Record<string, boolean> = {};
      for (const order of ordersList) {
        if (needsBreakdown(order.payment_method)) {
          const orderBreakdowns = breakdowns.filter(b => b.imported_order_id === order.id);
          if (orderBreakdowns.length > 0) {
            const sum = orderBreakdowns.reduce((s, b) => s + b.amount, 0);
            const diff = Math.abs(sum - Number(order.total_amount));
            validityMap[order.id] = diff < 0.01;
          } else {
            validityMap[order.id] = false;
          }
        }
      }
      setBreakdownValidity(prev => ({ ...prev, ...validityMap }));
    }

    // Load saved cash snapshot
    if (id) {
      const { data: snapData } = await supabase
        .from('cash_snapshots')
        .select('counts, total, updated_at')
        .eq('daily_closing_id', id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (snapData) {
        const counts = snapData.counts as Record<string, number>;
        setCashSnapshotData({ counts, total: Number(snapData.total), updated_at: snapData.updated_at });
        setCashSnapshotSaved(true);
        // Restore counts into calculator
        const restored: Record<number, number> = {};
        for (const [k, v] of Object.entries(counts)) {
          restored[parseFloat(k)] = v;
        }
        setCashCounts(restored);
      }
    }

    setLoading(false);
  };

  const toggleConfirm = useCallback(async (orderId: string, current: boolean) => {
    if (!user) return;

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    if (!current && needsBreakdown(order.payment_method)) {
      if (!breakdownValidity[orderId]) {
        toast.error('Preencha o detalhamento das formas de pagamento antes de confirmar.');
        setExpandedOrderId(orderId);
        return;
      }
    }

    const newVal = !current;
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, is_confirmed: newVal } : o));

    const { error } = await supabase
      .from('imported_orders')
      .update({
        is_confirmed: newVal,
        confirmed_at: newVal ? new Date().toISOString() : null,
        confirmed_by: newVal ? user.id : null,
      })
      .eq('id', orderId);

    if (error) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, is_confirmed: current } : o));
      toast.error('Erro ao atualizar pedido.');
    }
  }, [user, orders, breakdownValidity]);

  const handleRowClick = useCallback((order: Order) => {
    if (needsBreakdown(order.payment_method)) {
      setExpandedOrderId(prev => prev === order.id ? null : order.id);
    }
    // Only checkbox can confirm — row click no longer toggles confirmation
  }, []);

  const handleBreakdownValid = useCallback((orderId: string, valid: boolean) => {
    setBreakdownValidity(prev => ({ ...prev, [orderId]: valid }));
  }, []);

  const handleUpdateOrderField = useCallback(async (orderId: string, field: 'payment_method' | 'delivery_person', value: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    const oldValue = order[field];
    
    // Optimistic update
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, [field]: value } : o));

    const { error } = await supabase
      .from('imported_orders')
      .update({ [field]: value })
      .eq('id', orderId);

    if (error) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, [field]: oldValue } : o));
      toast.error('Erro ao atualizar pedido.');
    } else {
      toast.success(`${field === 'payment_method' ? 'Forma de pagamento' : 'Entregador'} atualizado.`);
      
      // When payment method changes, delete old breakdowns and reset validity
      if (field === 'payment_method' && value !== oldValue) {
        await supabase
          .from('order_payment_breakdowns')
          .delete()
          .eq('imported_order_id', orderId);
        
        // Update allBreakdowns state
        setAllBreakdowns(prev => prev.filter(b => b.imported_order_id !== orderId));
        
        // Reset breakdown validity - if the new method needs breakdown, mark as invalid
        if (needsBreakdown(value)) {
          setBreakdownValidity(prev => ({ ...prev, [orderId]: false }));
          // Auto-expand the row to show the breakdown editor
          setExpandedOrderId(orderId);
        } else {
          setBreakdownValidity(prev => {
            const next = { ...prev };
            delete next[orderId];
            return next;
          });
        }
      }
    }
  }, [orders]);

  const toggleSort = useCallback((field: SortField) => {
    setSortField(prev => {
      if (prev === field) {
        setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
        return field;
      }
      setSortDirection('asc');
      return field;
    });
  }, []);

  const bulkUpdate = useCallback(async (confirm: boolean) => {
    if (!user || !id) return;

    if (confirm) {
      const multiPaymentOrders = orders.filter(o => needsBreakdown(o.payment_method));
      const invalidOrders = multiPaymentOrders.filter(o => !breakdownValidity[o.id]);
      if (invalidOrders.length > 0) {
        toast.error(`${invalidOrders.length} pedido(s) com múltiplas formas de pagamento precisam de detalhamento antes de confirmar.`);
        return;
      }
    }

    // Update all orders for this daily closing
    const orderIds = orders.map(o => o.id);
    const { error } = await supabase
      .from('imported_orders')
      .update({
        is_confirmed: confirm,
        confirmed_at: confirm ? new Date().toISOString() : null,
        confirmed_by: confirm ? user.id : null,
      })
      .eq('daily_closing_id', id);

    if (error) {
      toast.error('Erro ao atualizar pedidos.');
      return;
    }
    setOrders(prev => prev.map(o => ({ ...o, is_confirmed: confirm })));
    toast.success(confirm ? 'Todos marcados como conferidos.' : 'Todos desmarcados.');
  }, [user, id, orders, breakdownValidity]);

  const finalize = useCallback(async () => {
    if (!id) return;

    const multiPaymentOrders = orders.filter(o => needsBreakdown(o.payment_method));
    const invalidOrders = multiPaymentOrders.filter(o => !breakdownValidity[o.id]);
    if (invalidOrders.length > 0) {
      toast.error(`${invalidOrders.length} pedido(s) com rateio pendente. Preencha o detalhamento antes de finalizar.`);
      return;
    }

    setCompleting(true);
    const { error } = await supabase.from('daily_closings').update({ status: 'completed' }).eq('id', id);
    if (error) {
      toast.error('Erro ao finalizar fechamento.');
    } else {
      setClosingData(prev => prev ? { ...prev, status: 'completed' } : prev);
      toast.success('Fechamento concluído com sucesso!');
    }
    setCompleting(false);
  }, [id, orders, breakdownValidity]);

  const handleSaveCashSnapshot = useCallback(async () => {
    if (!id || !user) return;
    setSavingCash(true);
    const countsJson: Record<string, number> = {};
    for (const [k, v] of Object.entries(cashCounts)) {
      if (v > 0) countsJson[k] = v;
    }

    const { error } = await supabase
      .from('cash_snapshots')
      .upsert({
        daily_closing_id: id,
        user_id: user.id,
        counts: countsJson,
        total: cashTotal,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'daily_closing_id,user_id' });

    if (error) {
      toast.error('Erro ao salvar contagem de dinheiro.');
    } else {
      setCashSnapshotSaved(true);
      setCashSnapshotData({ counts: countsJson, total: cashTotal, updated_at: new Date().toISOString() });
      toast.success(`Contagem salva: ${formatCurrency(cashTotal)}`);
      setShowCashCalc(false);
    }
    setSavingCash(false);
  }, [id, user, cashCounts, cashTotal]);

  const handleSaveConference = useCallback(() => {
    const errors: string[] = [];

    if (!cashSnapshotSaved) {
      errors.push('Calculadora de Dinheiro: contagem não foi salva. Abra a calculadora e salve antes de finalizar.');
    }

    for (const order of orders) {
      if (!order.is_confirmed) {
        errors.push(`Comanda #${order.order_number}: não está confirmada.`);
      }
      if (!order.delivery_person || order.delivery_person.trim() === '') {
        errors.push(`Comanda #${order.order_number}: sem entregador atribuído.`);
      }
      if (needsBreakdown(order.payment_method) && !breakdownValidity[order.id]) {
        errors.push(`Comanda #${order.order_number}: rateio de pagamento pendente.`);
      }
    }
    if (errors.length === 0) {
      finalize();
    } else {
      setConferenceErrors(errors);
      setShowConferenceErrors(true);
    }
  }, [orders, breakdownValidity, finalize, cashSnapshotSaved]);

  const paymentMethods = useMemo(() => [...new Set(orders.map(o => o.payment_method).filter(Boolean))].sort(), [orders]);
  const offlinePaymentMethods = useMemo(() => {
    const baseMethods = ['Dinheiro', 'Crédito', 'Débito', '(COBRAR) Pix'];
    const allMethods = orders.flatMap(o => o.payment_method.split(',').map(m => m.trim())).filter(Boolean);
    const offline = allMethods.filter(m => !isOnlinePayment(m));
    return [...new Set([...baseMethods, ...offline])].sort();
  }, [orders]);
  const deliveryPersons = useMemo(() => [...new Set(orders.map(o => o.delivery_person).filter(Boolean) as string[])].sort(), [orders]);

  const filtered = useMemo(() => {
    const result = orders.filter(o => {
      if (search && !o.order_number.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterPayment === 'only_online' && !isAllOnline(o.payment_method)) return false;
      if (filterPayment === 'only_offline' && isAllOnline(o.payment_method)) return false;
      if (filterPayment === 'offline_card_delivery') {
        const methods = o.payment_method.split(',').map(m => m.trim().toLowerCase());
        const hasOfflineCard = methods.some(m => {
          if (m.includes('online') || m.includes('(pago)') || m.includes('anotaai')) return false;
          if (m === 'dinheiro') return false;
          if (m.includes('voucher parceiro desconto')) return false;
          return m.includes('crédit') || m.includes('credit') || m.includes('débit') || m.includes('debit') || m.includes('pix') || m.includes('voucher');
        });
        if (!hasOfflineCard) return false;
      } else if (filterPayment !== 'all' && filterPayment !== 'only_online' && filterPayment !== 'only_offline' && o.payment_method !== filterPayment) return false;
      if (filterDelivery !== 'all' && o.delivery_person !== filterDelivery) return false;
      if (filterStatus === 'confirmed' && !o.is_confirmed) return false;
      if (filterStatus === 'pending' && o.is_confirmed) return false;
      return true;
    });

    const dir = sortDirection === 'asc' ? 1 : -1;

    result.sort((a, b) => {
      if (sortField === 'order_number') {
        const diff = extractOrderNumber(a.order_number) - extractOrderNumber(b.order_number);
        return diff * dir;
      }
      if (sortField === 'payment_method') {
        const cmp = a.payment_method.localeCompare(b.payment_method, 'pt-BR');
        if (cmp !== 0) return cmp * dir;
        return extractOrderNumber(a.order_number) - extractOrderNumber(b.order_number);
      }
      const aVal = a.is_confirmed ? 1 : 0;
      const bVal = b.is_confirmed ? 1 : 0;
      if (aVal !== bVal) return (aVal - bVal) * dir;
      return extractOrderNumber(a.order_number) - extractOrderNumber(b.order_number);
    });

    return result;
  }, [orders, search, filterPayment, filterDelivery, filterStatus, sortField, sortDirection]);

  const confirmed = useMemo(() => filtered.filter(o => o.is_confirmed).length, [filtered]);
  const pending = useMemo(() => filtered.length - confirmed, [filtered, confirmed]);
  const percent = useMemo(() => filtered.length ? Math.round((confirmed / filtered.length) * 100) : 0, [filtered, confirmed]);

  // Offline payment method totals for confirmed orders
  const OFFLINE_CATEGORIES = ['Dinheiro', '(COBRAR) Pix', 'Crédito', 'Débito', 'Voucher'] as const;

  const offlineMethodTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    OFFLINE_CATEGORIES.forEach(c => totals[c] = 0);

    const confirmedOrders = orders.filter(o => o.is_confirmed);
    const breakdownsByOrder = new Map<string, typeof allBreakdowns>();
    allBreakdowns.forEach(b => {
      if (!breakdownsByOrder.has(b.imported_order_id)) breakdownsByOrder.set(b.imported_order_id, []);
      breakdownsByOrder.get(b.imported_order_id)!.push(b);
    });

    const matchCategory = (methodName: string): string | null => {
      const lower = methodName.toLowerCase().trim();
      if (lower === 'dinheiro') return 'Dinheiro';
      if (lower.includes('(cobrar) pix') || lower === '(cobrar) pix') return '(COBRAR) Pix';
      if (lower.includes('crédit') || lower.includes('crédito') || lower === 'credito') return 'Crédito';
      if (lower.includes('débit') || lower.includes('débito') || lower === 'debito') return 'Débito';
      if (lower.includes('voucher') && !lower.includes('voucher parceiro') && !lower.includes('online')) return 'Voucher';
      return null;
    };

    for (const order of confirmedOrders) {
      const breakdowns = breakdownsByOrder.get(order.id);
      if (breakdowns && breakdowns.length > 0) {
        // Use breakdown amounts
        for (const b of breakdowns) {
          const cat = matchCategory(b.payment_method_name);
          if (cat) totals[cat] += b.amount;
        }
      } else {
        // Single payment method — use total_amount
        const methods = order.payment_method.split(',').map(m => m.trim()).filter(Boolean);
        if (methods.length === 1) {
          const cat = matchCategory(methods[0]);
          if (cat) totals[cat] += order.total_amount;
        }
      }
    }

    return totals;
  }, [orders, allBreakdowns]);

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const isCompleted = closingData?.status === 'completed';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="ml-56 flex flex-col flex-1">
        {/* Header */}
        <header className="border-b border-border bg-card sticky top-0 z-10">
          <div className="px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-base font-semibold text-foreground">
                  Fechamento {closingData ? formatDate(closingData.closing_date) : ''}
                </h1>
                <p className="text-xs text-muted-foreground">{orders.length} pedidos • {importRecords.length} importação(ões)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="default" size="sm" onClick={() => navigate(`/delivery-reconciliation/${id}`)} className="bg-primary hover:bg-primary/90">
                <Truck className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Conciliação Delivery</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowCashCalc(true)}>
                <Calculator className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Calculadora Dinheiro</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/import')} disabled={isCompleted}>
                <Plus className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Importar mais</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => bulkUpdate(true)} disabled={isCompleted}>
                <CheckCheck className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Marcar todos</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => bulkUpdate(false)} disabled={isCompleted}>
                <XCircle className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Desmarcar todos</span>
              </Button>
              <Button variant="default" size="sm" onClick={handleSaveConference} disabled={isCompleted} className="bg-success hover:bg-success/90 text-success-foreground">
                <Save className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Salvar Conferência</span>
              </Button>
            </div>
          </div>
        </header>

        {/* Offline Payment Totals */}
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Recebimentos Offline (Confirmados)</p>
            <div className="flex flex-wrap gap-3">
              {OFFLINE_CATEGORIES.map(cat => {
                const total = offlineMethodTotals[cat];
                const iconMap: Record<string, React.ReactNode> = {
                  'Dinheiro': <Banknote className="h-4 w-4 text-success" />,
                  '(COBRAR) Pix': <QrCode className="h-4 w-4 text-primary" />,
                  'Crédito': <CreditCard className="h-4 w-4 text-accent-foreground" />,
                  'Débito': <CreditCardIcon className="h-4 w-4 text-muted-foreground" />,
                  'Voucher': <CreditCard className="h-4 w-4 text-warning" />,
                };
                return (
                  <div key={cat} className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[150px]">
                    {iconMap[cat]}
                    <div>
                      <p className="text-[10px] text-muted-foreground leading-tight">{cat}</p>
                      <p className="text-sm font-semibold text-foreground font-mono-tabular">{formatCurrency(total)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="border-b border-border bg-card">
          <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Total" value={filtered.length} icon={<Clock className="h-4 w-4" />} color="text-foreground" />
            <StatCard label="Confirmados" value={confirmed} icon={<CheckCircle2 className="h-4 w-4" />} color="text-success" />
            <StatCard label="Pendentes" value={pending} icon={<AlertTriangle className="h-4 w-4" />} color="text-warning" />
            <div className="bg-muted rounded-xl p-3 border border-border">
              <p className="text-xs text-muted-foreground mb-1">Progresso</p>
              <p className="text-2xl font-semibold text-foreground font-mono-tabular">{percent}%</p>
              <div className="mt-2 h-1.5 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full row-transition" style={{ width: `${percent}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Cash Snapshot Card */}
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-success" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Contagem de Dinheiro</span>
              </div>
              {cashSnapshotSaved ? (
                <span className="flex items-center gap-1 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Salvo
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-warning">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Não salvo
                </span>
              )}
            </div>
            {cashSnapshotData ? (
              <div className="mt-2 flex items-center gap-4">
                <span className="text-lg font-bold text-foreground font-mono">{formatCurrency(cashSnapshotData.total)}</span>
                <span className="text-xs text-muted-foreground">
                  Salvo em {new Date(cashSnapshotData.updated_at).toLocaleString('pt-BR')}
                </span>
                <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setShowCashCalc(true)}>
                  <Calculator className="h-3.5 w-3.5 mr-1" />
                  Ver detalhes
                </Button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-3">
                <span className="text-xs text-muted-foreground">Nenhuma contagem salva ainda.</span>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowCashCalc(true)}>
                  <Calculator className="h-3.5 w-3.5 mr-1" />
                  Abrir Calculadora
                </Button>
              </div>
            )}
          </div>
        </div>




        {/* Import History Toggle */}
        {importRecords.length > 0 && (
          <div className="border-b border-border bg-card">
            <div className="px-6">
              <button
                onClick={() => setShowImportHistory(!showImportHistory)}
                className="w-full py-2 text-xs text-muted-foreground hover:text-foreground row-transition text-left"
              >
                {showImportHistory ? '▾' : '▸'} Histórico de importações ({importRecords.length})
              </button>
              {showImportHistory && (
                <div className="pb-3 space-y-1.5">
                  {importRecords.map((imp) => (
                    <div key={imp.id} className="flex items-center justify-between text-xs bg-muted/50 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-foreground font-medium">{imp.file_name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span>{imp.total_rows} lidos</span>
                        <span className="text-success">{imp.new_rows} novos</span>
                        <span>{imp.duplicate_rows} duplicados</span>
                        <span>{new Date(imp.created_at).toLocaleString('pt-BR')}</span>
                      </div>
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
              <Input placeholder="Buscar pedido..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Formas de Pagamento</span>
              <Select value={filterPayment} onValueChange={setFilterPayment}>
                <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="Forma de pagamento" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as formas de pagamento</SelectItem>
                  <SelectItem value="only_offline">Somente pagamentos offline</SelectItem>
                  <SelectItem value="only_online">Somente pagamentos online</SelectItem>
                  <SelectItem value="offline_card_delivery">Cartão Delivery (sem dinheiro)</SelectItem>
                  {paymentMethods.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Motoboy</span>
              <Select value={filterDelivery} onValueChange={setFilterDelivery}>
                <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Entregador" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os entregadores</SelectItem>
                  {deliveryPersons.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="confirmed">Confirmados</SelectItem>
                  <SelectItem value="pending">Pendentes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                className="h-9"
                onClick={() => setShowColumnSettings(!showColumnSettings)}
              >
                <Settings2 className="h-4 w-4 mr-1" />
                Colunas
              </Button>
              {showColumnSettings && (
                <div className="absolute right-0 top-10 z-20 bg-card border border-border rounded-lg shadow-lg p-3 space-y-2 min-w-[200px]">
                  {([
                    { key: 'sale_date' as const, label: 'Data' },
                    { key: 'sale_time' as const, label: 'Hora' },
                    { key: 'sales_channel' as const, label: 'Canal de Venda' },
                    { key: 'partner_order_number' as const, label: 'Nº Pedido Parceiro' },
                  ]).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => toggleColumn(key)}
                      className="flex items-center gap-2 w-full text-left text-sm py-1 px-2 rounded hover:bg-muted/50 transition-colors"
                    >
                      {visibleColumns[key]
                        ? <Eye className="h-4 w-4 text-primary" />
                        : <EyeOff className="h-4 w-4 text-muted-foreground" />
                      }
                      <span className={visibleColumns[key] ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <div className="px-6 py-4">
            <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <SortableHeader field="is_confirmed" label="✓" currentField={sortField} currentDirection={sortDirection} onSort={toggleSort} className="w-12" />
                    <SortableHeader field="order_number" label="Pedido" currentField={sortField} currentDirection={sortDirection} onSort={toggleSort} />
                    {visibleColumns.sale_date && <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Data</th>}
                    {visibleColumns.sale_time && <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Hora</th>}
                    {visibleColumns.sales_channel && <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Canal</th>}
                    {visibleColumns.partner_order_number && <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Nº Parceiro</th>}
                    <SortableHeader field="payment_method" label="Pagamento" currentField={sortField} currentDirection={sortDirection} onSort={toggleSort} />
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Total</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Entregador</th>
                  </tr>
                </thead>
                <tbody>
                {filtered.map((order) => {
                    const hasMultiple = needsBreakdown(order.payment_method);
                    const isExpanded = expandedOrderId === order.id;
                    const breakdownValid = breakdownValidity[order.id];
                    const badgeType = getPaymentBadgeType(order.payment_method);
                    const autoOnline = isAllOnline(order.payment_method);

                    return (
                      <OrderRow
                        key={order.id}
                        order={order}
                        hasMultiple={hasMultiple}
                        badgeType={badgeType}
                        isExpanded={isExpanded}
                        breakdownValid={breakdownValid}
                        isCompleted={isCompleted}
                        isAutoOnline={autoOnline}
                        visibleColumns={visibleColumns}
                        onRowClick={() => handleRowClick(order)}
                        onCheckboxClick={(e) => {
                          e.stopPropagation();
                          if (!isCompleted) toggleConfirm(order.id, order.is_confirmed);
                        }}
                        onBreakdownValid={(valid) => handleBreakdownValid(order.id, valid)}
                        onBreakdownSaved={async () => {
                          if (!order.is_confirmed) {
                            toggleConfirm(order.id, false);
                          }
                          // Reload breakdowns to update totals
                          const orderIds = orders.map(o => o.id);
                          const { data: bkData } = await supabase
                            .from('order_payment_breakdowns')
                            .select('imported_order_id, payment_method_name, payment_type, amount')
                            .in('imported_order_id', orderIds);
                          setAllBreakdowns((bkData || []).map(b => ({ ...b, amount: Number(b.amount) })));
                        }}
                        onUpdateField={(field, value) => handleUpdateOrderField(order.id, field, value)}
                        allPaymentMethods={paymentMethods}
                        offlinePaymentMethods={offlinePaymentMethods}
                        allDeliveryPersons={deliveryPersons}
                      />
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  Nenhum pedido encontrado com os filtros aplicados.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border bg-card sticky bottom-0">
          <div className="px-6 py-3 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {isCompleted ? (
                <span className="flex items-center gap-2 text-success font-medium">
                  <PartyPopper className="h-4 w-4" />
                  Fechamento concluído
                </span>
              ) : pending > 0 ? (
                <span className="flex items-center gap-2 text-warning">
                  <AlertTriangle className="h-4 w-4" />
                  {pending} pedido(s) pendente(s)
                </span>
              ) : (
                <span className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="h-4 w-4" />
                  Todos os pedidos conferidos!
                </span>
              )}
            </div>
            <Button
              onClick={handleSaveConference}
              disabled={isCompleted || completing}
              className="bg-success hover:bg-success/90 text-success-foreground"
            >
              {completing ? 'Finalizando...' : 'Finalizar Fechamento'}
            </Button>
          </div>
        </div>
      </div>
      <AppSidebar />

      {/* Cash Calculator Dialog */}
      <Dialog open={showCashCalc} onOpenChange={setShowCashCalc}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Calculadora de Dinheiro
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">
              <span>Cédula/Moeda</span>
              <span className="text-center">Qtd</span>
              <span className="text-right">Subtotal</span>
            </div>
            {CASH_DENOMINATIONS.map(denom => (
              <div key={denom} className="grid grid-cols-[1fr_80px_1fr] gap-2 items-center">
                <span className="text-sm font-medium text-foreground">
                  {formatCurrency(denom)}
                </span>
                <Input
                  type="number"
                  min={0}
                  value={cashCounts[denom] || ''}
                  onChange={(e) => setCashCounts(prev => ({ ...prev, [denom]: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="h-8 text-center text-sm"
                  placeholder="0"
                />
                <span className="text-sm text-right font-mono text-foreground">
                  {formatCurrency(denom * (cashCounts[denom] || 0))}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-3 mt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Total em espécie:</span>
              <span className="text-xl font-bold text-primary font-mono">{formatCurrency(cashTotal)}</span>
            </div>
            {offlineMethodTotals['Dinheiro'] > 0 && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-muted-foreground">Dinheiro confirmado nos pedidos:</span>
                <span className="text-sm font-medium text-muted-foreground font-mono">{formatCurrency(offlineMethodTotals['Dinheiro'])}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCashCounts({})}>
              Limpar
            </Button>
            <Button size="sm" onClick={handleSaveCashSnapshot} disabled={savingCash || isCompleted}>
              {savingCash ? 'Salvando...' : cashSnapshotSaved ? 'Atualizar Contagem' : 'Salvar Contagem'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conference Errors Dialog */}
      <Dialog open={showConferenceErrors} onOpenChange={setShowConferenceErrors}>
        <DialogContent className="sm:max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Pendências na Conferência
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {conferenceErrors.map((err, i) => (
              <div key={i} className="flex items-start gap-2 text-sm bg-destructive/10 text-destructive rounded-md px-3 py-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{err}</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConferenceErrors(false)}>
              Entendi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Sub-components ---

interface SortableHeaderProps {
  field: SortField;
  label: string;
  currentField: SortField;
  currentDirection: SortDirection;
  onSort: (field: SortField) => void;
  className?: string;
}

function SortableHeader({ field, label, currentField, currentDirection, onSort, className }: SortableHeaderProps) {
  const isActive = currentField === field;
  return (
    <th
      className={`text-left p-3 text-xs font-medium uppercase tracking-wider cursor-pointer select-none hover:bg-muted/50 transition-colors ${
        isActive ? 'text-primary' : 'text-muted-foreground'
      } ${className || ''}`}
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {isActive ? (
          currentDirection === 'asc' ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </div>
    </th>
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

type ColumnVisibility = {
  sale_date: boolean;
  sale_time: boolean;
  sales_channel: boolean;
  partner_order_number: boolean;
};

interface OrderRowProps {
  order: Order;
  hasMultiple: boolean;
  badgeType: PaymentBadgeType;
  isExpanded: boolean;
  breakdownValid: boolean;
  isCompleted: boolean;
  isAutoOnline: boolean;
  visibleColumns: ColumnVisibility;
  onRowClick: () => void;
  onCheckboxClick: (e: React.MouseEvent) => void;
  onBreakdownValid: (valid: boolean) => void;
  onBreakdownSaved?: () => void;
  onUpdateField: (field: 'payment_method' | 'delivery_person', value: string) => void;
  allPaymentMethods: string[];
  offlinePaymentMethods: string[];
  allDeliveryPersons: string[];
}

function PaymentBadge({ type, breakdownValid }: { type: PaymentBadgeType; breakdownValid?: boolean }) {
  if (type === 'online') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-primary/10 text-primary">
        <Wifi className="h-3 w-3" />
        Pagamento Online
      </span>
    );
  }
  if (type === 'fisico') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-muted text-muted-foreground">
        <CreditCard className="h-3 w-3" />
        Pagamento no ato
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
      breakdownValid
        ? 'bg-success/10 text-success'
        : 'bg-warning/10 text-warning'
    }`}>
      <SplitSquareHorizontal className="h-3 w-3" />
      {breakdownValid ? 'Rateio OK' : 'Rateio necessário'}
    </span>
  );
}

function OrderRow({ order, hasMultiple, badgeType, isExpanded, breakdownValid, isCompleted, isAutoOnline, visibleColumns, onRowClick, onCheckboxClick, onBreakdownValid, onBreakdownSaved, onUpdateField, allPaymentMethods, offlinePaymentMethods, allDeliveryPersons }: OrderRowProps) {
  const colCount = 5 + Object.values(visibleColumns).filter(Boolean).length;
  const cellClass = order.is_confirmed ? 'text-muted-foreground' : 'text-foreground';

  const [editingField, setEditingField] = useState<'payment_method' | 'delivery_person' | null>(null);
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [paymentPopoverOpen, setPaymentPopoverOpen] = useState(false);

  const formatSaleDate = (d: string | null) => {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  const startEdit = (e: React.MouseEvent, field: 'payment_method' | 'delivery_person') => {
    e.stopPropagation();
    if (isCompleted) return;
    if (field === 'payment_method') {
      const current = order.payment_method.split(',').map(m => m.trim()).filter(Boolean);
      setSelectedMethods(current);
      setPaymentPopoverOpen(true);
    } else {
      setEditingField(field);
    }
  };

  const handleSelectValue = (value: string) => {
    if (editingField && value !== (order[editingField] || '')) {
      onUpdateField(editingField, value);
    }
    setEditingField(null);
  };

  const togglePaymentMethod = (method: string) => {
    setSelectedMethods(prev => {
      if (prev.includes(method)) {
        return prev.filter(m => m !== method);
      }
      return [...prev, method];
    });
  };

  const savePaymentMethods = () => {
    if (selectedMethods.length === 0) {
      toast.error('Selecione ao menos uma forma de pagamento.');
      return;
    }
    const newValue = selectedMethods.join(', ');
    if (newValue !== order.payment_method) {
      onUpdateField('payment_method', newValue);
    }
    setPaymentPopoverOpen(false);
  };

  return (
    <>
      <tr
        className={`border-b border-border/50 row-transition cursor-pointer ${
          order.is_confirmed
            ? isAutoOnline ? 'bg-blue-50/50 dark:bg-blue-950/20 opacity-70' : 'bg-muted/50 opacity-60'
            : 'hover:bg-primary/5'
        }`}
        onClick={onRowClick}
      >
        <td className="p-3">
          <div
            className={`h-5 w-5 rounded border-2 flex items-center justify-center row-transition ${
              order.is_confirmed
                ? isAutoOnline
                  ? 'bg-blue-500 border-blue-500'
                  : 'bg-success border-success'
                : 'border-border'
            }`}
            onClick={onCheckboxClick}
          >
            {order.is_confirmed && <CheckCircle2 className={`h-3.5 w-3.5 ${isAutoOnline ? 'text-white' : 'text-success-foreground'}`} />}
          </div>
        </td>
        <td className={`p-3 font-medium ${order.is_confirmed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
          #{order.order_number}
        </td>
        {visibleColumns.sale_date && (
          <td className={`p-3 text-sm ${cellClass}`}>{formatSaleDate(order.sale_date)}</td>
        )}
        {visibleColumns.sale_time && (
          <td className={`p-3 text-sm ${cellClass}`}>{order.sale_time || '—'}</td>
        )}
        {visibleColumns.sales_channel && (
          <td className={`p-3 text-sm ${cellClass}`}>{order.sales_channel || '—'}</td>
        )}
        {visibleColumns.partner_order_number && (
          <td className={`p-3 text-sm ${cellClass}`}>{order.partner_order_number || '—'}</td>
        )}
        <td className={`p-3 text-sm ${cellClass}`}>
          <div className="flex items-center gap-2 group">
            <Popover open={paymentPopoverOpen} onOpenChange={(open) => {
              if (!open && paymentPopoverOpen) {
                savePaymentMethods();
              }
              setPaymentPopoverOpen(open);
            }}>
              <PopoverTrigger asChild>
                <span className="truncate cursor-default">{order.payment_method}</span>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start" onClick={(e) => e.stopPropagation()}>
                <div className="p-3 border-b border-border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Formas de Pagamento</p>
                </div>
                <div className="p-2 space-y-1 max-h-60 overflow-auto">
                  {offlinePaymentMethods.map(method => (
                    <label
                      key={method}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selectedMethods.includes(method)}
                        onCheckedChange={() => togglePaymentMethod(method)}
                      />
                      <span>{method}</span>
                    </label>
                  ))}
                </div>
                <div className="p-2 border-t border-border flex justify-end">
                  <Button size="sm" className="h-7 text-xs" onClick={savePaymentMethods}>
                    Confirmar
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            <PaymentBadge type={badgeType} breakdownValid={breakdownValid} />
            {hasMultiple && (
              isExpanded
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            {!isCompleted && (
              <button onClick={(e) => startEdit(e, 'payment_method')} className="shrink-0">
                <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-50 transition-opacity" />
              </button>
            )}
          </div>
        </td>
        <td className={`p-3 text-right font-mono-tabular text-sm ${cellClass}`}>
          {formatCurrency(order.total_amount)}
        </td>
        <td className={`p-3 text-sm ${cellClass}`}>
          {editingField === 'delivery_person' ? (
            <div onClick={(e) => e.stopPropagation()}>
              <Select
                defaultOpen
                value={order.delivery_person || ''}
                onValueChange={handleSelectValue}
                onOpenChange={(open) => { if (!open) setEditingField(null); }}
              >
                <SelectTrigger className="h-7 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allDeliveryPersons.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex items-center gap-1 group">
              <span>{order.delivery_person || '—'}</span>
              {!isCompleted && (
                <button onClick={(e) => startEdit(e, 'delivery_person')} className="shrink-0">
                  <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-50 transition-opacity" />
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
      {hasMultiple && isExpanded && (
        <tr>
          <td colSpan={colCount} className="p-0">
            <PaymentBreakdown
              orderId={order.id}
              paymentMethod={order.payment_method}
              totalAmount={order.total_amount}
              isCompleted={isCompleted}
              onBreakdownValid={onBreakdownValid}
              onSaved={onBreakdownSaved}
            />
          </td>
        </tr>
      )}
    </>
  );
}