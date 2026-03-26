import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowLeft, Search, CheckCircle2, Clock, AlertTriangle, PartyPopper, CheckCheck, XCircle, ChevronDown, ChevronRight, ChevronUp, SplitSquareHorizontal, Wifi, CreditCard, ArrowUpDown, Plus, FileSpreadsheet, Eye, EyeOff, Settings2, Truck, Pencil, Banknote, QrCode, CreditCard as CreditCardIcon, Calculator, Save, AlertCircle, X, RotateCcw, ShieldCheck, Trash2, RefreshCw, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import PaymentBreakdown from '@/components/PaymentBreakdown';
import AppSidebar from '@/components/AppSidebar';

import { needsBreakdown, formatCurrency, getPaymentBadgeType, isAllOnline, isOnlinePayment, type PaymentBadgeType } from '@/lib/payment-utils';
import MachineReadingsSection from '@/components/MachineReadingsSection';
import { getLatestCashSnapshots } from '@/lib/cash-snapshot-utils';

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
  const { isCaixaTele, isAdmin } = useUserRole();
  
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
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const [deletingImports, setDeletingImports] = useState(false);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [allBreakdowns, setAllBreakdowns] = useState<Array<{ imported_order_id: string; payment_method_name: string; payment_type: string; amount: number }>>([]);
  const [visibleColumns, setVisibleColumns] = useState({
  });

  // Cash calculator state - Abertura
  const [showCashCalcAbertura, setShowCashCalcAbertura] = useState(false);
  const CASH_DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.50, 0.25, 0.10, 0.05];
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

  // Save conference state
  const [showConferenceErrors, setShowConferenceErrors] = useState(false);
  const [conferenceErrors, setConferenceErrors] = useState<string[]>([]);

  // Saipos sync state
  const [syncingSaipos, setSyncingSaipos] = useState(false);
  const [lastAutoSync, setLastAutoSync] = useState<string | null>(null);

  const handleSyncSaipos = useCallback(async () => {
    if (!id || !closingData || !user) return;
    setSyncingSaipos(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-saipos-sales', {
        body: { closing_date: closingData.closing_date, daily_closing_id: id },
      });
      if (error) throw new Error(error.message || 'Erro ao sincronizar');
      if (data?.error) throw new Error(data.error);
      console.log("SYNC RESPONSE:", JSON.stringify(data));
      toast.success(`✅ ${data.new_orders} pedidos importados · ⚠️ ${data.duplicates} duplicados ignorados`);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao sincronizar com Saipos');
    } finally {
      setSyncingSaipos(false);
    }
  }, [id, closingData, user]);


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

    // Load saved cash snapshots (abertura + fechamento)
    if (id) {
      const { data: snapList } = await supabase
        .from('cash_snapshots')
        .select('counts, total, updated_at, snapshot_type')
        .eq('daily_closing_id', id)
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

    // Load admin's expected cash for this date
    if (closing?.closing_date) {
      const { data: expectation } = await supabase
        .from('cash_expectations')
        .select('counts, total')
        .eq('closing_date', closing.closing_date)
        .eq('sector', 'tele')
        .maybeSingle();

      if (expectation) {
        setExpectedCash({
          counts: expectation.counts as Record<string, number>,
          total: Number(expectation.total),
        });
      }
    }

    // Load last auto-sync timestamp
    const { data: lastSyncImport } = await supabase
      .from('imports')
      .select('created_at')
      .like('file_name', 'saipos-api-%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    setLastAutoSync(lastSyncImport?.created_at || null);

    setLoading(false);
  };

  const toggleImportSelection = (importId: string) => {
    setSelectedImports(prev => {
      const next = new Set(prev);
      if (next.has(importId)) next.delete(importId);
      else next.add(importId);
      return next;
    });
  };

  const handleDeleteSelectedImports = async () => {
    if (selectedImports.size === 0) return;
    const confirmed = window.confirm(`Tem certeza que deseja apagar ${selectedImports.size} importação(ões)? Os pedidos associados serão removidos, mas contagens de dinheiro e maquininhas serão preservadas.`);
    if (!confirmed) return;

    setDeletingImports(true);
    try {
      const importIds = Array.from(selectedImports);

      const { data: ordersToDelete } = await supabase
        .from('imported_orders')
        .select('id')
        .in('import_id', importIds);

      if (ordersToDelete && ordersToDelete.length > 0) {
        const orderIds = ordersToDelete.map(o => o.id);
        await supabase.from('card_transactions')
          .update({ matched_order_id: null, match_type: null, match_confidence: null })
          .in('matched_order_id', orderIds);
        await supabase.from('order_payment_breakdowns').delete().in('imported_order_id', orderIds);
        await supabase.from('imported_orders').delete().in('import_id', importIds);
      }

      await supabase.from('imports').delete().in('id', importIds);

      toast.success(`${importIds.length} importação(ões) removida(s). Contagens e maquininhas preservadas.`);
      setSelectedImports(new Set());
      await loadData();
    } catch (err) {
      toast.error('Erro ao apagar importações.');
      console.error(err);
    } finally {
      setDeletingImports(false);
    }
  };

  const toggleConfirm = useCallback(async (orderId: string, current: boolean, skipValidation = false) => {
    if (!user) return;

    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    // Checkbox confirms delivery directly — no breakdown validation needed
    if (false) {
      const methods = order.payment_method.split(',').map(m => m.trim()).filter(Boolean);
      const hasPhysical = methods.some(m => !isOnlinePayment(m));
      
      if (hasPhysical) {
        const orderBks = allBreakdowns.filter(b => b.imported_order_id === orderId);
        const physicalBks = orderBks.filter(b => b.payment_type === 'fisico');
        
        if (physicalBks.length === 0) {
          toast.error('Preencha a coluna Valores antes de confirmar.');
          return;
        }
        
        if (needsBreakdown(order.payment_method) && !breakdownValidity[orderId]) {
          toast.error('Preencha o detalhamento das formas de pagamento antes de confirmar.');
          setExpandedOrderId(orderId);
          return;
        }
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
  }, [user, orders, breakdownValidity, allBreakdowns]);

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

  const handleAdminForceFinalize = useCallback(async () => {
    if (!id || !isAdmin) return;
    const confirmed = window.confirm('Deseja forçar a finalização deste fechamento mesmo com pendências?');
    if (!confirmed) return;
    setCompleting(true);
    const { error } = await supabase.from('daily_closings').update({ status: 'completed' }).eq('id', id);
    if (error) {
      toast.error('Erro ao finalizar fechamento.');
    } else {
      setClosingData(prev => prev ? { ...prev, status: 'completed' } : prev);
      toast.success('Fechamento finalizado pelo administrador.');
    }
    setCompleting(false);
  }, [id, isAdmin]);

  const handleReopenClosing = useCallback(async () => {
    if (!id || !isAdmin) return;
    const confirmed = window.confirm('Deseja reabrir este fechamento? O status voltará para pendente.');
    if (!confirmed) return;
    const { error } = await supabase.from('daily_closings').update({ status: 'pending' }).eq('id', id);
    if (error) {
      toast.error('Erro ao reabrir fechamento.');
    } else {
      setClosingData(prev => prev ? { ...prev, status: 'pending' } : prev);
      toast.success('Fechamento reaberto com sucesso.');
    }
  }, [id, isAdmin]);

  const handleSaveCashSnapshotAbertura = useCallback(async () => {
    if (!id || !user) return;
    setSavingCashAbertura(true);
    const countsJson: Record<string, number> = {};
    for (const [k, v] of Object.entries(cashCountsAbertura)) {
      if (v > 0) countsJson[k] = v;
    }

    const { error } = await supabase
      .from('cash_snapshots')
      .upsert({
        daily_closing_id: id,
        user_id: user.id,
        counts: countsJson,
        total: cashTotalAbertura,
        updated_at: new Date().toISOString(),
        snapshot_type: 'abertura',
      }, { onConflict: 'daily_closing_id,user_id,snapshot_type' });

    if (error) {
      toast.error('Erro ao salvar contagem de abertura.');
    } else {
      setCashSnapshotSavedAbertura(true);
      setCashSnapshotDataAbertura({ counts: countsJson, total: cashTotalAbertura, updated_at: new Date().toISOString() });
      toast.success(`Contagem abertura salva: ${formatCurrency(cashTotalAbertura)}`);
      setShowCashCalcAbertura(false);
    }
    setSavingCashAbertura(false);
  }, [id, user, cashCountsAbertura, cashTotalAbertura]);

  const handleSaveCashSnapshotFechamento = useCallback(async () => {
    if (!id || !user) return;
    setSavingCashFechamento(true);
    const countsJson: Record<string, number> = {};
    for (const [k, v] of Object.entries(cashCountsFechamento)) {
      if (v > 0) countsJson[k] = v;
    }

    const { error } = await supabase
      .from('cash_snapshots')
      .upsert({
        daily_closing_id: id,
        user_id: user.id,
        counts: countsJson,
        total: cashTotalFechamento,
        updated_at: new Date().toISOString(),
        snapshot_type: 'fechamento',
      }, { onConflict: 'daily_closing_id,user_id,snapshot_type' });

    if (error) {
      toast.error('Erro ao salvar contagem de fechamento.');
    } else {
      setCashSnapshotSavedFechamento(true);
      setCashSnapshotDataFechamento({ counts: countsJson, total: cashTotalFechamento, updated_at: new Date().toISOString() });
      toast.success(`Contagem fechamento salva: ${formatCurrency(cashTotalFechamento)}`);
      setShowCashCalcFechamento(false);
    }
    setSavingCashFechamento(false);
  }, [id, user, cashCountsFechamento, cashTotalFechamento]);

  const handleSaveConference = useCallback(() => {
    // Admin can force-finalize even with errors
    if (isAdmin) {
      const errors: string[] = [];

      if (!cashSnapshotSavedAbertura) errors.push('Contagem de Dinheiro na Abertura não salva.');
      if (!cashSnapshotSavedFechamento) errors.push('Contagem de Dinheiro no Fechamento não salva.');

      for (const order of orders) {
        if (!order.is_confirmed) errors.push(`Comanda #${order.order_number}: não confirmada.`);
        if (!order.delivery_person || order.delivery_person.trim() === '') errors.push(`Comanda #${order.order_number}: sem entregador.`);
        
      }

      if (errors.length === 0) {
        finalize();
      } else {
        // Show errors but allow admin to force
        setConferenceErrors(errors);
        setShowConferenceErrors(true);
      }
      return;
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    if (!cashSnapshotSavedAbertura) {
      errors.push('Contagem de Dinheiro na Abertura: não foi salva. Abra a calculadora e salve antes de finalizar.');
    }
    if (!cashSnapshotSavedFechamento) {
      errors.push('Contagem de Dinheiro no Fechamento: não foi salva. Abra a calculadora e salve antes de finalizar.');
    }

    for (const order of orders) {
      if (!order.is_confirmed) {
        errors.push(`Comanda #${order.order_number}: não está confirmada.`);
      }
      if (!order.delivery_person || order.delivery_person.trim() === '') {
        warnings.push(`Comanda #${order.order_number}: sem entregador atribuído.`);
      }
    }

    if (errors.length === 0 && warnings.length === 0) {
      finalize();
    } else if (errors.length === 0 && warnings.length > 0) {
      // Only warnings (missing delivery person) — allow finalization with confirmation
      setConferenceErrors(warnings);
      setConferenceOnlyWarnings(true);
      setShowConferenceErrors(true);
    } else {
      setConferenceErrors([...errors, ...warnings]);
      setConferenceOnlyWarnings(false);
      setShowConferenceErrors(true);
    }
  }, [orders, breakdownValidity, finalize, cashSnapshotSavedAbertura, cashSnapshotSavedFechamento, isAdmin]);

  const paymentMethods = useMemo(() => [...new Set(orders.map(o => o.payment_method).filter(Boolean))].sort(), [orders]);
  const offlinePaymentMethods = useMemo(() => [
    'Crédito', 'Débito', '(COBRAR) Pix', 'Dinheiro', 'Voucher', '(PAGO) Pix Banco do Brasil', 'Sob Demanda Ifood', 'Pagamento não cadastrado'
  ], []);
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
  const OFFLINE_CATEGORIES = ['(COBRAR) Pix', 'Crédito', 'Débito', 'Voucher'] as const;

  const offlineMethodTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    OFFLINE_CATEGORIES.forEach(c => totals[c] = 0);

    const allOrders = orders;
    const breakdownsByOrder = new Map<string, typeof allBreakdowns>();
    allBreakdowns.forEach(b => {
      if (!breakdownsByOrder.has(b.imported_order_id)) breakdownsByOrder.set(b.imported_order_id, []);
      breakdownsByOrder.get(b.imported_order_id)!.push(b);
    });

    const matchCategory = (methodName: string): string | null => {
      const lower = methodName.toLowerCase().trim();
      // Exclude online/pago payments — they are not offline receivables
      if (lower.includes('pago online') || lower.includes('(pago)') || lower.includes('online')) return null;
      if (lower === 'dinheiro') return 'Dinheiro';
      if (lower.includes('(cobrar) pix') || lower === '(cobrar) pix') return '(COBRAR) Pix';
      if (lower.includes('crédit') || lower.includes('crédito') || lower === 'credito') return 'Crédito';
      if (lower.includes('débit') || lower.includes('débito') || lower === 'debito') return 'Débito';
      if (lower.includes('voucher') && !lower.includes('voucher parceiro')) return 'Voucher';
      return null;
    };

    for (const order of allOrders) {
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

  const allFilteredConfirmed = filtered.length > 0 && filtered.every(o => o.is_confirmed);
  const someFilteredConfirmed = filtered.some(o => o.is_confirmed);

  const toggleConfirmAll = async () => {
    if (!user || isCompleted) return;
    const newVal = !allFilteredConfirmed;
    const ids = filtered.map(o => o.id);
    setOrders(prev => prev.map(o => ids.includes(o.id) ? { ...o, is_confirmed: newVal } : o));
    const { error } = await supabase
      .from('imported_orders')
      .update({
        is_confirmed: newVal,
        confirmed_at: newVal ? new Date().toISOString() : null,
        confirmed_by: newVal ? user.id : null,
      })
      .in('id', ids);
    if (error) {
      toast.error('Erro ao atualizar pedidos.');
      loadData();
    } else {
      toast.success(newVal ? `${ids.length} pedidos confirmados` : `${ids.length} pedidos desconfirmados`);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="ml-56 flex flex-col flex-1">
        
        {/* Header */}
        <header className="border-b border-border bg-card sticky top-0 z-10">
          <div className="px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => navigate('/tele')}>
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
              <Button variant="outline" size="sm" onClick={() => navigate(isCaixaTele ? '/tele/import' : '/import')} disabled={isCompleted}>
                <Plus className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Importar mais</span>
              </Button>
              <div className="flex flex-col items-start">
                <Button variant="outline" size="sm" onClick={handleSyncSaipos} disabled={isCompleted || syncingSaipos}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${syncingSaipos ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{syncingSaipos ? 'Sincronizando...' : 'Sincronizar via Saipos'}</span>
                </Button>
                {lastAutoSync && (
                  <span className="text-[11px] text-muted-foreground mt-0.5 ml-1">
                    Última sincronização: {new Date(lastAutoSync).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <Button variant="default" size="sm" onClick={handleSaveConference} disabled={isCompleted && !isAdmin} className="bg-success hover:bg-success/90 text-success-foreground">
                <Save className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Salvar Conferência</span>
              </Button>
              {isAdmin && isCompleted && (
                <Button variant="outline" size="sm" onClick={handleReopenClosing}>
                  <RotateCcw className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Reabrir</span>
                </Button>
              )}
              {isAdmin && !isCompleted && (
                <Button variant="outline" size="sm" onClick={handleAdminForceFinalize} disabled={completing} className="border-warning text-warning hover:bg-warning/10">
                  <ShieldCheck className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Forçar Fechamento</span>
                </Button>
              )}
            </div>
          </div>
        </header>

        {/* 1. Cash Snapshot - Abertura */}
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-success" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Contagem de Dinheiro na Abertura</span>
              </div>
              {cashSnapshotSavedAbertura ? (
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
            {cashSnapshotDataAbertura ? (
              <div className="mt-2 flex items-center gap-4">
                <span className="text-lg font-bold text-foreground font-mono">{formatCurrency(cashSnapshotDataAbertura.total)}</span>
                <span className="text-xs text-muted-foreground">
                  Salvo em {new Date(cashSnapshotDataAbertura.updated_at).toLocaleString('pt-BR')}
                </span>
                <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setShowCashCalcAbertura(true)}>
                  <Calculator className="h-3.5 w-3.5 mr-1" />
                  Ver detalhes
                </Button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-3">
                <span className="text-xs text-muted-foreground">Nenhuma contagem salva ainda.</span>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowCashCalcAbertura(true)}>
                  <Calculator className="h-3.5 w-3.5 mr-1" />
                  Abrir Calculadora
                </Button>
              </div>
            )}
          </div>
        </div>




        {/* 3. Total Teórico via Saipos */}
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Total Teórico via Saipos</p>
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
              {(() => {
                const totalGeral = OFFLINE_CATEGORIES.reduce((sum, cat) => sum + (offlineMethodTotals[cat] || 0), 0);
                return (
                  <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2 border border-primary/30 min-w-[150px]">
                    <Wallet className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-[10px] text-primary font-semibold leading-tight">Total Geral</p>
                      <p className="text-sm font-bold text-primary font-mono-tabular">{formatCurrency(totalGeral)}</p>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* 4. Total Recebido via Maquininhas + Conferência */}
        {id && (
          <MachineReadingsSection
            dailyClosingId={id}
            deliveryPersons={deliveryPersons}
            isCompleted={isCompleted}
          />
        )}

        {/* 5. Cash Snapshot - Fechamento */}
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-primary" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Contagem de Dinheiro no Fechamento</span>
              </div>
              {cashSnapshotSavedFechamento ? (
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
            {cashSnapshotDataFechamento ? (
              <div className="mt-2 flex items-center gap-4">
                <span className="text-lg font-bold text-foreground font-mono">{formatCurrency(cashSnapshotDataFechamento.total)}</span>
                <span className="text-xs text-muted-foreground">
                  Salvo em {new Date(cashSnapshotDataFechamento.updated_at).toLocaleString('pt-BR')}
                </span>
                <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setShowCashCalcFechamento(true)}>
                  <Calculator className="h-3.5 w-3.5 mr-1" />
                  Ver detalhes
                </Button>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-3">
                <span className="text-xs text-muted-foreground">Nenhuma contagem salva ainda.</span>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowCashCalcFechamento(true)}>
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
                        <Checkbox
                          checked={selectedImports.has(imp.id)}
                          onCheckedChange={() => toggleImportSelection(imp.id)}
                          className="h-4 w-4"
                        />
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
                  {selectedImports.size > 0 && (
                    <div className="flex items-center gap-3 pt-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={handleDeleteSelectedImports}
                        disabled={deletingImports}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        {deletingImports ? 'Apagando...' : `Apagar ${selectedImports.size} importação(ões)`}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedImports(new Set())}
                      >
                        Cancelar
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. Stats (pedidos) */}
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Resumo de Pedidos</p>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[120px]">
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Total Vendas</p>
                  <p className="text-sm font-semibold text-foreground font-mono">{formatCurrency(filtered.reduce((sum, o) => sum + o.total_amount, 0))}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[120px]">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Total</p>
                  <p className="text-sm font-semibold text-foreground font-mono-tabular">{filtered.length}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[120px]">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Confirmados</p>
                  <p className="text-sm font-semibold text-success font-mono-tabular">{confirmed}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2 border border-border min-w-[120px]">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Pendentes</p>
                  <p className="text-sm font-semibold text-warning font-mono-tabular">{pending}</p>
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

        {/* Filters */}
        <div className="border-b border-border bg-card">
          <div className="px-6 py-3 flex flex-wrap gap-2">
            <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Buscar</span>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar pedido..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
              </div>
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
                    <th className="w-12 p-3">
                      <Checkbox
                        checked={allFilteredConfirmed ? true : (someFilteredConfirmed ? 'indeterminate' : false)}
                        onCheckedChange={() => toggleConfirmAll()}
                        disabled={isCompleted || filtered.length === 0}
                        className="h-4 w-4"
                        title={allFilteredConfirmed ? 'Desconfirmar todos' : 'Confirmar todos'}
                      />
                    </th>
                    <SortableHeader field="order_number" label="Pedido" currentField={sortField} currentDirection={sortDirection} onSort={toggleSort} />
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Data</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Hora</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Canal</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Nº Parceiro</th>
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
                    const hasBreakdowns = allBreakdowns.some(b => b.imported_order_id === order.id);

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
                        hasBreakdowns={hasBreakdowns}
                        isTestMode={true}
                        visibleColumns={visibleColumns}
                        orderBreakdowns={allBreakdowns.filter(b => b.imported_order_id === order.id)}
                        onRowClick={() => handleRowClick(order)}
                        onCheckboxClick={(e) => {
                          e.stopPropagation();
                          if (!isCompleted) toggleConfirm(order.id, order.is_confirmed);
                        }}
                        onBreakdownValid={(valid) => handleBreakdownValid(order.id, valid)}
                        onBreakdownSaved={async () => {
                          const orderIds = orders.map(o => o.id);
                          const { data: bkData } = await supabase
                            .from('order_payment_breakdowns')
                            .select('imported_order_id, payment_method_name, payment_type, amount')
                            .in('imported_order_id', orderIds);
                          setAllBreakdowns((bkData || []).map(b => ({ ...b, amount: Number(b.amount) })));
                        }}
                        onUpdateField={(field, value) => handleUpdateOrderField(order.id, field, value)}
                        onAutoConfirm={() => {
                          if (!order.is_confirmed) {
                            toggleConfirm(order.id, false, true);
                          }
                        }}
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
            <div className="flex items-center gap-2">
              {isAdmin && isCompleted && (
                <Button variant="outline" size="sm" onClick={handleReopenClosing}>
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Reabrir
                </Button>
              )}
              <Button
                onClick={handleSaveConference}
                disabled={(isCompleted && !isAdmin) || completing}
                className="bg-success hover:bg-success/90 text-success-foreground"
              >
                {completing ? 'Finalizando...' : 'Finalizar Fechamento'}
              </Button>
            </div>
          </div>
        </div>
      </div>
      <AppSidebar />

      {/* Cash Calculator Dialog - Abertura */}
      <Dialog open={showCashCalcAbertura} onOpenChange={setShowCashCalcAbertura}>
        <DialogContent className={expectedCash ? "sm:max-w-2xl" : "sm:max-w-md"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Calculadora de Dinheiro — Abertura
            </DialogTitle>
            {expectedCash && (
              <p className="text-xs text-muted-foreground mt-1">
                Valores esperados definidos pelo administrador estão exibidos ao lado.
              </p>
            )}
          </DialogHeader>
          <div className="space-y-2">
            <div className={`grid ${expectedCash ? 'grid-cols-[1fr_80px_1fr_1fr]' : 'grid-cols-[1fr_80px_1fr]'} gap-2 items-center text-xs font-medium text-muted-foreground uppercase tracking-wider px-1`}>
              <span>Cédula/Moeda</span>
              <span className="text-center">Qtd</span>
              <span className="text-right">Subtotal</span>
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
            <Button size="sm" onClick={handleSaveCashSnapshotAbertura} disabled={savingCashAbertura || isCompleted}>
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
              Calculadora de Dinheiro — Fechamento
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
            {offlineMethodTotals['Dinheiro'] > 0 && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-muted-foreground">Dinheiro confirmado nos pedidos:</span>
                <span className="text-sm font-medium text-muted-foreground font-mono">{formatCurrency(offlineMethodTotals['Dinheiro'])}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCashCountsFechamento({})}>Limpar</Button>
            <Button size="sm" onClick={handleSaveCashSnapshotFechamento} disabled={savingCashFechamento || isCompleted}>
              {savingCashFechamento ? 'Salvando...' : cashSnapshotSavedFechamento ? 'Atualizar Contagem' : 'Salvar Contagem'}
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
            {isAdmin && (
              <Button variant="destructive" onClick={() => { setShowConferenceErrors(false); handleAdminForceFinalize(); }}>
                <ShieldCheck className="h-4 w-4 mr-1" />
                Forçar Fechamento
              </Button>
            )}
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
    <div className="bg-card rounded-lg p-3 border border-border shadow-card">
      <div className="flex items-center justify-between mb-1">
        <p className="section-title">{label}</p>
        <span className={`${color} opacity-60`}>{icon}</span>
      </div>
      <p className={`text-2xl font-bold font-mono-tabular ${color}`}>{value}</p>
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
  breakdownValid?: boolean;
  isCompleted: boolean;
  isAutoOnline: boolean;
  hasBreakdowns: boolean;
  isTestMode?: boolean;
  visibleColumns: Record<string, boolean>;
  orderBreakdowns: Array<{ imported_order_id: string; payment_method_name: string; payment_type: string; amount: number }>;
  onRowClick: () => void;
  onCheckboxClick: (e: React.MouseEvent) => void;
  onBreakdownValid: (valid: boolean) => void;
  onBreakdownSaved?: () => void;
  onUpdateField: (field: 'payment_method' | 'delivery_person', value: string) => void;
  onAutoConfirm?: () => void;
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
        Pagamento na entrega
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

// Check if payment method is a raw import value (not yet confirmed by operator).
// Any payment containing physical methods that hasn't been through breakdown is considered raw import.
function isOriginalImportPayment(method: string): boolean {
  // If ALL methods are online, it's not a raw import needing confirmation
  if (isAllOnline(method)) return false;
  // Any payment with physical components is considered raw import until operator confirms via breakdown
  return true;
}

interface ValoresCellProps {
  order: Order;
  orderBreakdowns: Array<{ imported_order_id: string; payment_method_name: string; payment_type: string; amount: number }>;
  hasMultiple: boolean;
  isCompleted: boolean;
  offlinePaymentMethods: string[];
  onSaved?: () => void;
  onAutoConfirm?: () => void;
}

function ValoresCell({ order, orderBreakdowns, hasMultiple, isCompleted, offlinePaymentMethods, onSaved, onAutoConfirm }: ValoresCellProps) {
  const [editing, setEditing] = useState(false);
  const [entries, setEntries] = useState<Array<{ method: string; amount: string }>>([{ method: '', amount: '' }]);
  const [saving, setSaving] = useState(false);

  const physicalBreakdowns = orderBreakdowns.filter(b => b.payment_type === 'fisico' && b.amount > 0);

  // Detect if this is a hybrid order (has both online and physical methods)
  const parsedMethods = order.payment_method.split(',').map(m => m.trim()).filter(Boolean);
  const hasOnlineComponent = parsedMethods.some(m => isOnlinePayment(m));
  const hasPhysicalComponent = parsedMethods.some(m => !isOnlinePayment(m));
  const isHybrid = hasOnlineComponent && hasPhysicalComponent;

  // If already has saved breakdowns, show them
  if (physicalBreakdowns.length > 0 && !editing) {
    return (
      <div className="flex flex-col gap-0.5">
        {physicalBreakdowns.map((b, i) => (
          <span key={i} className="text-xs font-medium text-foreground">
            {b.payment_method_name} / <span className="font-mono-tabular">{formatCurrency(b.amount)}</span>
          </span>
        ))}
        {!isCompleted && (
          <button
            onClick={() => {
              setEntries(physicalBreakdowns.map(b => ({ method: b.payment_method_name, amount: b.amount.toFixed(2).replace('.', ',') })));
              setEditing(true);
            }}
            className="text-[10px] text-primary hover:underline text-left mt-0.5"
          >
            Editar
          </button>
        )}
      </div>
    );
  }

  if (isCompleted) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="text-xs text-primary hover:underline font-medium"
      >
        + Informar valores
      </button>
    );
  }

  const addEntry = () => setEntries(prev => [...prev, { method: '', amount: '' }]);
  const removeEntry = (idx: number) => setEntries(prev => prev.filter((_, i) => i !== idx));
  const updateEntry = (idx: number, field: 'method' | 'amount', value: string) => {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const handleSave = async (autoConfirmAfter = false) => {
    const valid = entries.filter(e => e.method && e.amount);
    if (valid.length === 0) {
      toast.error('Informe ao menos um método e valor.');
      return;
    }

    setSaving(true);

    // Delete existing breakdowns
    await supabase
      .from('order_payment_breakdowns')
      .delete()
      .eq('imported_order_id', order.id);

    // Build inserts: physical entries from user + online entries if mixed
    const inserts: Array<{ imported_order_id: string; payment_method_name: string; payment_type: string; amount: number; is_auto_calculated: boolean }> = [];

    const methods = order.payment_method.split(',').map(m => m.trim()).filter(Boolean);
    const onlineMethods = methods.filter(m => isOnlinePayment(m));

    // Add physical entries from user input
    let physicalTotal = 0;
    for (const e of valid) {
      const cleaned = e.amount.replace(/[^\d.,]/g, '').replace(',', '.');
      const amount = Math.round((parseFloat(cleaned) || 0) * 100) / 100;
      physicalTotal += amount;
      inserts.push({
        imported_order_id: order.id,
        payment_method_name: e.method,
        payment_type: 'fisico',
        amount,
        is_auto_calculated: false,
      });
    }

    // If there are online methods, add them with remaining amount
    if (onlineMethods.length > 0) {
      const onlineAmount = Math.round((order.total_amount - physicalTotal) * 100) / 100;
      for (const m of onlineMethods) {
        inserts.push({
          imported_order_id: order.id,
          payment_method_name: m,
          payment_type: 'online',
          amount: onlineMethods.length === 1 ? Math.max(0, onlineAmount) : 0,
          is_auto_calculated: true,
        });
      }
    }

    const { error } = await supabase.from('order_payment_breakdowns').insert(inserts);

    if (error) {
      toast.error('Erro ao salvar valores.');
    } else {
      toast.success('Valores salvos!');
      setEditing(false);
      onSaved?.();
      if (autoConfirmAfter) {
        onAutoConfirm?.();
      }
    }
    setSaving(false);
  };

  return (
    <div className="space-y-1.5 min-w-[180px]">
      {entries.map((entry, idx) => (
        <div key={idx} className="flex items-center gap-1">
          <Select value={entry.method} onValueChange={(v) => updateEntry(idx, 'method', v)}>
            <SelectTrigger className="h-7 text-[11px] w-[100px] px-1.5">
              <SelectValue placeholder="Método" />
            </SelectTrigger>
            <SelectContent>
              {offlinePaymentMethods.map(m => (
                <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="text"
            inputMode="decimal"
            placeholder="0,00"
            className="h-7 text-[11px] w-[70px] text-right font-mono-tabular px-1.5"
            value={entry.amount}
            onChange={(e) => updateEntry(idx, 'amount', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (entries.length === 1 && entry.method && entry.amount) {
                  const cleaned = entry.amount.replace(/[^\d.,]/g, '').replace(',', '.');
                  const amount = Math.round((parseFloat(cleaned) || 0) * 100) / 100;
                  if (isHybrid && amount > 0 && amount <= order.total_amount) {
                    // Hybrid: auto-save with online remainder and auto-confirm
                    handleSave(true);
                  } else if (Math.abs(amount - order.total_amount) < 0.01) {
                    // Exact match: auto-save AND auto-confirm
                    handleSave(true);
                  }
                } else if (entries.length > 1) {
                  const allFilled = entries.every(en => en.method && en.amount);
                  if (allFilled) {
                    const total = entries.reduce((sum, en) => {
                      const c = en.amount.replace(/[^\d.,]/g, '').replace(',', '.');
                      return sum + (Math.round((parseFloat(c) || 0) * 100) / 100);
                    }, 0);
                    if (Math.abs(total - order.total_amount) < 0.01 || (isHybrid && total > 0 && total <= order.total_amount)) {
                      handleSave(true);
                    }
                  }
                }
              }
            }}
          />
          {entries.length > 1 && (
            <button onClick={() => removeEntry(idx)} className="text-destructive hover:text-destructive/80">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      <div className="flex items-center gap-1">
        <button onClick={addEntry} className="text-[10px] text-primary hover:underline">+ Rateio</button>
        <Button size="sm" className="h-6 text-[10px] px-2 ml-auto" onClick={() => handleSave(false)} disabled={saving}>
          {saving ? '...' : 'Salvar'}
        </Button>
        <button onClick={() => setEditing(false)} className="text-[10px] text-muted-foreground hover:underline">
          Cancelar
        </button>
      </div>
    </div>
  );
}


function isUnidentifiedPayment(method: string): boolean {
  const methods = method.split(',').map(m => m.trim()).filter(Boolean);
  if (methods.length === 0) return false;
  // If ALL individual methods are online, it's identified (auto-filled) — no tag needed
  if (methods.every(m => isOnlinePayment(m))) return false;
  // Any payment containing at least one physical method needs operator confirmation
  return true;
}

function OrderRow({ order, hasMultiple, badgeType, isExpanded, breakdownValid, isCompleted, isAutoOnline, hasBreakdowns, isTestMode: rowTestMode, visibleColumns, orderBreakdowns, onRowClick, onCheckboxClick, onBreakdownValid, onBreakdownSaved, onAutoConfirm, onUpdateField, allPaymentMethods, offlinePaymentMethods, allDeliveryPersons }: OrderRowProps) {
  const colCount = (rowTestMode ? 5 : 6) + Object.values(visibleColumns).filter(Boolean).length;
  const cellClass = order.is_confirmed ? 'text-muted-foreground' : 'text-foreground';

  const [editingField, setEditingField] = useState<'payment_method' | 'delivery_person' | null>(null);
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [paymentPopoverOpen, setPaymentPopoverOpen] = useState(false);

  const isUnidentified = isUnidentifiedPayment(order.payment_method);
  const parsedMethods = order.payment_method.split(',').map(m => m.trim()).filter(Boolean);
  const hasOnlineComponent = parsedMethods.some(isOnlinePayment);
  const hasPhysicalComponent = parsedMethods.some(m => !isOnlinePayment(m));

  const formatSaleDate = (d: string | null) => {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  const startEdit = (e: React.MouseEvent, field: 'payment_method' | 'delivery_person') => {
    e.stopPropagation();
    if (isCompleted) return;
    if (field === 'payment_method') {
      // If it's a raw import value, start empty; otherwise keep operator's previous selection
      const isRawImport = isOriginalImportPayment(order.payment_method);
      const current = isRawImport ? [] : order.payment_method.split(',').map(m => m.trim()).filter(Boolean);
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
        <td className={`p-3 text-sm ${cellClass}`}>{formatSaleDate(order.sale_date)}</td>
        <td className={`p-3 text-sm ${cellClass}`}>{order.sale_time || '—'}</td>
        <td className={`p-3 text-sm ${cellClass}`}>{order.sales_channel || '—'}</td>
        <td className={`p-3 text-sm ${cellClass}`}>{order.partner_order_number || '—'}</td>
        <td className={`p-3 text-sm ${cellClass}`}>
          <div className="flex items-center gap-2 group flex-wrap">
            <Popover open={paymentPopoverOpen} onOpenChange={(open) => {
              if (!open && paymentPopoverOpen) {
                savePaymentMethods();
              }
              setPaymentPopoverOpen(open);
            }}>
              {rowTestMode ? (
                <>
                  {/* Test mode: show imported payment_method as plain text */}
                  <span className="text-xs text-foreground">{order.payment_method}</span>
                  {isAllOnline(order.payment_method) && <PaymentBadge type="online" />}
                  {hasBreakdowns && orderBreakdowns.length > 1 && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-warning/15 text-warning border border-warning/30">
                      <AlertTriangle className="h-3 w-3" />
                      Rateio
                    </span>
                  )}
                  {!isCompleted && (
                    <PopoverTrigger asChild>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const current = order.payment_method.split(',').map(m => m.trim()).filter(Boolean);
                          setSelectedMethods(current);
                        }}
                        className="text-[10px] text-primary hover:underline shrink-0"
                      >
                        ✏️ Alterar
                      </button>
                    </PopoverTrigger>
                  )}
                </>
              ) : isUnidentified ? (
                <>
                  {hasOnlineComponent && <PaymentBadge type="online" />}
                  {hasPhysicalComponent && (
                    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full font-medium shrink-0 border ${
                      order.is_confirmed
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-muted text-muted-foreground border-border'
                    }`}>
                      {order.is_confirmed ? (
                        <>
                          <CreditCard className="h-3 w-3" />
                          Pagamento na entrega
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="h-3 w-3" />
                          Pagamento na entrega
                        </>
                      )}
                    </span>
                  )}
                  {hasMultiple && !hasBreakdowns && (
                    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full font-medium shrink-0 bg-warning/15 text-warning border border-warning/30">
                      <AlertTriangle className="h-3 w-3" />
                      Rateio necessário
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="truncate cursor-default">{order.payment_method}</span>
                  <PopoverTrigger asChild>
                    <span />
                  </PopoverTrigger>
                </>
              )}
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
                <div className="p-2 border-t border-border flex justify-end gap-2">
                  {rowTestMode && selectedMethods.length > 1 && (
                    <span className="text-[10px] text-muted-foreground self-center mr-auto">Múltiplas formas → rateio</span>
                  )}
                  <Button size="sm" className="h-7 text-xs" onClick={savePaymentMethods}>
                    Confirmar
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            {!rowTestMode && !isUnidentified && <PaymentBadge type={badgeType} breakdownValid={breakdownValid} />}
            {hasMultiple && (
              isExpanded
                ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )}
            {!isCompleted && !rowTestMode && !isUnidentified && (
              <button onClick={(e) => startEdit(e, 'payment_method')} className="shrink-0">
                <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-50 transition-opacity" />
              </button>
            )}
          </div>
        </td>
        {!rowTestMode && (
          <td className={`p-3 text-sm ${cellClass}`} onClick={(e) => e.stopPropagation()}>
            {isUnidentified ? (
              <ValoresCell
                order={order}
                orderBreakdowns={orderBreakdowns}
                hasMultiple={hasMultiple}
                isCompleted={isCompleted}
                offlinePaymentMethods={offlinePaymentMethods}
                onSaved={onBreakdownSaved}
                onAutoConfirm={onAutoConfirm}
              />
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </td>
        )}
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