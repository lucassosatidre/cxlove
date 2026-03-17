import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Search, CheckCircle2, Clock, AlertTriangle, PartyPopper, CheckCheck, XCircle, ChevronDown, ChevronRight, ChevronUp, SplitSquareHorizontal, Wifi, CreditCard, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import PaymentBreakdown from '@/components/PaymentBreakdown';
import AppSidebar from '@/components/AppSidebar';
import { needsBreakdown, formatCurrency, getPaymentBadgeType, type PaymentBadgeType } from '@/lib/payment-utils';

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
}

// Legacy reconciliation page for imports without daily_closing_id
export default function ReconciliationLegacy() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [importData, setImportData] = useState<{ file_name: string; status: string } | null>(null);
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

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  const loadData = async () => {
    const [{ data: impData }, { data: ordData }] = await Promise.all([
      supabase.from('imports').select('file_name, status').eq('id', id!).single(),
      supabase.from('imported_orders').select('id, order_number, payment_method, total_amount, delivery_person, is_confirmed').eq('import_id', id!),
    ]);
    setImportData(impData);
    setOrders(ordData || []);
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
      .update({ is_confirmed: newVal, confirmed_at: newVal ? new Date().toISOString() : null, confirmed_by: newVal ? user.id : null })
      .eq('id', orderId);
    if (error) {
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, is_confirmed: current } : o));
      toast.error('Erro ao atualizar pedido.');
    }
  }, [user, orders, breakdownValidity]);

  const handleRowClick = useCallback((order: Order) => {
    if (needsBreakdown(order.payment_method)) {
      setExpandedOrderId(prev => prev === order.id ? null : order.id);
    } else {
      if (importData?.status !== 'completed') toggleConfirm(order.id, order.is_confirmed);
    }
  }, [toggleConfirm, importData]);

  const handleBreakdownValid = useCallback((orderId: string, valid: boolean) => {
    setBreakdownValidity(prev => ({ ...prev, [orderId]: valid }));
  }, []);

  const toggleSort = useCallback((field: SortField) => {
    setSortField(prev => {
      if (prev === field) { setSortDirection(d => d === 'asc' ? 'desc' : 'asc'); return field; }
      setSortDirection('asc');
      return field;
    });
  }, []);

  const bulkUpdate = useCallback(async (confirm: boolean) => {
    if (!user || !id) return;
    if (confirm) {
      const invalid = orders.filter(o => needsBreakdown(o.payment_method) && !breakdownValidity[o.id]);
      if (invalid.length > 0) { toast.error(`${invalid.length} pedido(s) precisam de detalhamento.`); return; }
    }
    const { error } = await supabase.from('imported_orders').update({ is_confirmed: confirm, confirmed_at: confirm ? new Date().toISOString() : null, confirmed_by: confirm ? user.id : null }).eq('import_id', id);
    if (error) { toast.error('Erro ao atualizar pedidos.'); return; }
    setOrders(prev => prev.map(o => ({ ...o, is_confirmed: confirm })));
    toast.success(confirm ? 'Todos marcados.' : 'Todos desmarcados.');
  }, [user, id, orders, breakdownValidity]);

  const finalize = useCallback(async () => {
    if (!id) return;
    const invalid = orders.filter(o => needsBreakdown(o.payment_method) && !breakdownValidity[o.id]);
    if (invalid.length > 0) { toast.error(`${invalid.length} pedido(s) com rateio pendente.`); return; }
    setCompleting(true);
    const { error } = await supabase.from('imports').update({ status: 'completed' }).eq('id', id);
    if (error) { toast.error('Erro ao finalizar.'); }
    else { setImportData(prev => prev ? { ...prev, status: 'completed' } : prev); toast.success('Fechamento concluído!'); }
    setCompleting(false);
  }, [id, orders, breakdownValidity]);

  const confirmed = useMemo(() => orders.filter(o => o.is_confirmed).length, [orders]);
  const pending = orders.length - confirmed;
  const percent = orders.length ? Math.round((confirmed / orders.length) * 100) : 0;
  const paymentMethods = useMemo(() => [...new Set(orders.map(o => o.payment_method).filter(Boolean))].sort(), [orders]);
  const deliveryPersons = useMemo(() => [...new Set(orders.map(o => o.delivery_person).filter(Boolean) as string[])].sort(), [orders]);

  const filtered = useMemo(() => {
    const result = orders.filter(o => {
      if (search && !o.order_number.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterPayment !== 'all' && o.payment_method !== filterPayment) return false;
      if (filterDelivery !== 'all' && o.delivery_person !== filterDelivery) return false;
      if (filterStatus === 'confirmed' && !o.is_confirmed) return false;
      if (filterStatus === 'pending' && o.is_confirmed) return false;
      return true;
    });
    const dir = sortDirection === 'asc' ? 1 : -1;
    result.sort((a, b) => {
      if (sortField === 'order_number') return (extractOrderNumber(a.order_number) - extractOrderNumber(b.order_number)) * dir;
      if (sortField === 'payment_method') { const c = a.payment_method.localeCompare(b.payment_method, 'pt-BR'); if (c !== 0) return c * dir; return extractOrderNumber(a.order_number) - extractOrderNumber(b.order_number); }
      const av = a.is_confirmed ? 1 : 0, bv = b.is_confirmed ? 1 : 0;
      if (av !== bv) return (av - bv) * dir;
      return extractOrderNumber(a.order_number) - extractOrderNumber(b.order_number);
    });
    return result;
  }, [orders, search, filterPayment, filterDelivery, filterStatus, sortField, sortDirection]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-background"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  const isCompleted = importData?.status === 'completed';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppSidebar />
      <div className="ml-56 flex flex-col flex-1">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}><ArrowLeft className="h-4 w-4" /></Button>
            <div>
              <h1 className="text-base font-semibold text-foreground">{importData?.file_name} (Legado)</h1>
              <p className="text-xs text-muted-foreground">{orders.length} pedidos</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => bulkUpdate(true)} disabled={isCompleted}><CheckCheck className="h-4 w-4 mr-1" /><span className="hidden sm:inline">Marcar todos</span></Button>
            <Button variant="outline" size="sm" onClick={() => bulkUpdate(false)} disabled={isCompleted}><XCircle className="h-4 w-4 mr-1" /><span className="hidden sm:inline">Desmarcar todos</span></Button>
          </div>
        </div>
      </header>

      <div className="border-b border-border bg-card">
        <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total" value={orders.length} icon={<Clock className="h-4 w-4" />} color="text-foreground" />
          <StatCard label="Confirmados" value={confirmed} icon={<CheckCircle2 className="h-4 w-4" />} color="text-success" />
          <StatCard label="Pendentes" value={pending} icon={<AlertTriangle className="h-4 w-4" />} color="text-warning" />
          <div className="bg-muted rounded-xl p-3 border border-border">
            <p className="text-xs text-muted-foreground mb-1">Progresso</p>
            <p className="text-2xl font-semibold text-foreground font-mono-tabular">{percent}%</p>
            <div className="mt-2 h-1.5 bg-border rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full row-transition" style={{ width: `${percent}%` }} /></div>
          </div>
        </div>
      </div>

      <div className="border-b border-border bg-card">
        <div className="px-6 py-3 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Buscar pedido..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" /></div>
          <Select value={filterPayment} onValueChange={setFilterPayment}><SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Pagamento" /></SelectTrigger><SelectContent><SelectItem value="all">Todos pagamentos</SelectItem>{paymentMethods.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
          <Select value={filterDelivery} onValueChange={setFilterDelivery}><SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Entregador" /></SelectTrigger><SelectContent><SelectItem value="all">Todos entregadores</SelectItem>{deliveryPersons.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent></Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}><SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="confirmed">Confirmados</SelectItem><SelectItem value="pending">Pendentes</SelectItem></SelectContent></Select>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="px-6 py-4">
          <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <SortableHeader field="is_confirmed" label="✓" currentField={sortField} currentDirection={sortDirection} onSort={toggleSort} className="w-12" />
                  <SortableHeader field="order_number" label="Pedido" currentField={sortField} currentDirection={sortDirection} onSort={toggleSort} />
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
                  return (
                    <OrderRow key={order.id} order={order} hasMultiple={hasMultiple} badgeType={badgeType} isExpanded={isExpanded} breakdownValid={breakdownValid} isCompleted={isCompleted}
                      onRowClick={() => handleRowClick(order)}
                      onCheckboxClick={(e) => { e.stopPropagation(); if (!isCompleted) toggleConfirm(order.id, order.is_confirmed); }}
                      onBreakdownValid={(valid) => handleBreakdownValid(order.id, valid)}
                    />
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm">Nenhum pedido encontrado.</div>}
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-card sticky bottom-0">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {isCompleted ? <span className="flex items-center gap-2 text-success font-medium"><PartyPopper className="h-4 w-4" />Fechamento concluído</span>
              : pending > 0 ? <span className="flex items-center gap-2 text-warning"><AlertTriangle className="h-4 w-4" />{pending} pendente(s)</span>
              : <span className="flex items-center gap-2 text-success"><CheckCircle2 className="h-4 w-4" />Todos conferidos!</span>}
          </div>
          <Button onClick={finalize} disabled={pending > 0 || isCompleted || completing} className="bg-success hover:bg-success/90 text-success-foreground">
            {completing ? 'Finalizando...' : 'Finalizar Fechamento'}
          </Button>
        </div>
      </div>
      </div>
    </div>
  );
}

function SortableHeader({ field, label, currentField, currentDirection, onSort, className }: { field: SortField; label: string; currentField: SortField; currentDirection: SortDirection; onSort: (f: SortField) => void; className?: string }) {
  const isActive = currentField === field;
  return (
    <th className={`text-left p-3 text-xs font-medium uppercase tracking-wider cursor-pointer select-none hover:bg-muted/50 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground'} ${className || ''}`} onClick={() => onSort(field)}>
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {isActive ? (currentDirection === 'asc' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </div>
    </th>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return <div className="bg-muted rounded-xl p-3 border border-border"><div className="flex items-center gap-1.5 mb-1"><span className={color}>{icon}</span><p className="text-xs text-muted-foreground">{label}</p></div><p className={`text-2xl font-semibold font-mono-tabular ${color}`}>{value}</p></div>;
}

function PaymentBadge({ type, breakdownValid }: { type: PaymentBadgeType; breakdownValid?: boolean }) {
  if (type === 'online') return <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-primary/10 text-primary"><Wifi className="h-3 w-3" />Online</span>;
  if (type === 'fisico') return <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 bg-muted text-muted-foreground"><CreditCard className="h-3 w-3" />No ato</span>;
  return <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${breakdownValid ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}><SplitSquareHorizontal className="h-3 w-3" />{breakdownValid ? 'Rateio OK' : 'Rateio necessário'}</span>;
}

function OrderRow({ order, hasMultiple, badgeType, isExpanded, breakdownValid, isCompleted, onRowClick, onCheckboxClick, onBreakdownValid }: { order: Order; hasMultiple: boolean; badgeType: PaymentBadgeType; isExpanded: boolean; breakdownValid: boolean; isCompleted: boolean; onRowClick: () => void; onCheckboxClick: (e: React.MouseEvent) => void; onBreakdownValid: (valid: boolean) => void }) {
  return (
    <>
      <tr className={`border-b border-border/50 row-transition cursor-pointer ${order.is_confirmed ? 'bg-muted/50 opacity-60' : 'hover:bg-primary/5'}`} onClick={onRowClick}>
        <td className="p-3"><div className={`h-5 w-5 rounded border-2 flex items-center justify-center row-transition ${order.is_confirmed ? 'bg-success border-success' : 'border-border'}`} onClick={onCheckboxClick}>{order.is_confirmed && <CheckCircle2 className="h-3.5 w-3.5 text-success-foreground" />}</div></td>
        <td className={`p-3 font-medium ${order.is_confirmed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>#{order.order_number}</td>
        <td className={`p-3 text-sm ${order.is_confirmed ? 'text-muted-foreground' : 'text-foreground'}`}>
          <div className="flex items-center gap-2"><span className="truncate">{order.payment_method}</span><PaymentBadge type={badgeType} breakdownValid={breakdownValid} />{hasMultiple && (isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />)}</div>
        </td>
        <td className={`p-3 text-right font-mono-tabular text-sm ${order.is_confirmed ? 'text-muted-foreground' : 'text-foreground'}`}>{formatCurrency(order.total_amount)}</td>
        <td className={`p-3 text-sm ${order.is_confirmed ? 'text-muted-foreground' : 'text-foreground'}`}>{order.delivery_person || '—'}</td>
      </tr>
      {hasMultiple && isExpanded && <tr><td colSpan={5} className="p-0"><PaymentBreakdown orderId={order.id} paymentMethod={order.payment_method} totalAmount={order.total_amount} isCompleted={isCompleted} onBreakdownValid={onBreakdownValid} /></td></tr>}
    </>
  );
}
