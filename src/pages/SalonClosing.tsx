import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, AlertTriangle, AlertCircle, CheckCircle2, ShieldCheck, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import SalonPaymentEditor from '@/components/SalonPaymentEditor';

interface SalonOrder {
  id: string;
  order_type: string;
  sale_time: string | null;
  sale_date: string | null;
  payment_method: string;
  total_amount: number;
  is_confirmed: boolean;
}

interface ClosingData {
  id: string;
  closing_date: string;
  status: string;
}

interface PaymentEntry {
  id?: string;
  payment_method: string;
  amount: number;
}

export default function SalonClosing() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin } = useUserRole();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<SalonOrder[]>([]);
  const [closing, setClosing] = useState<ClosingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [finalizing, setFinalizing] = useState(false);
  
  // Map of orderId -> PaymentEntry[]
  const [orderPayments, setOrderPayments] = useState<Record<string, PaymentEntry[]>>({});

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  const loadData = async () => {
    const [{ data: closingData }, { data: ordersData }] = await Promise.all([
      supabase.from('salon_closings').select('*').eq('id', id!).single(),
      supabase.from('salon_orders').select('*').eq('salon_closing_id', id!).order('sale_time', { ascending: true }),
    ]);
    setClosing(closingData as ClosingData | null);
    const ordersList = (ordersData as SalonOrder[]) || [];
    setOrders(ordersList);

    // Load all payments for these orders
    if (ordersList.length > 0) {
      const orderIds = ordersList.map(o => o.id);
      const { data: paymentsData } = await supabase
        .from('salon_order_payments')
        .select('*')
        .in('salon_order_id', orderIds);

      if (paymentsData) {
        const map: Record<string, PaymentEntry[]> = {};
        paymentsData.forEach((p: any) => {
          if (!map[p.salon_order_id]) map[p.salon_order_id] = [];
          map[p.salon_order_id].push({
            id: p.id,
            payment_method: p.payment_method,
            amount: Number(p.amount),
          });
        });
        setOrderPayments(map);
      }
    }
    setLoading(false);
  };

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
            !(o.sale_time || '').includes(s)) return false;
      }
      if (filterType && filterType !== '__all__' && o.order_type !== filterType) return false;
      return true;
    });
  }, [orders, search, filterType]);

  const totalAmount = useMemo(() => filtered.reduce((sum, o) => sum + o.total_amount, 0), [filtered]);

  // Payment summary from manually entered payments only
  const paymentSummary = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    Object.values(orderPayments).flat().forEach(p => {
      if (!p.payment_method) return;
      if (!map[p.payment_method]) map[p.payment_method] = { count: 0, total: 0 };
      map[p.payment_method].count++;
      map[p.payment_method].total += p.amount;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [orderPayments]);

  const totalAssigned = useMemo(() => {
    return Object.values(orderPayments).flat().reduce((sum, p) => sum + p.amount, 0);
  }, [orderPayments]);

  const handlePaymentsChanged = useCallback((orderId: string, payments: PaymentEntry[]) => {
    setOrderPayments(prev => ({ ...prev, [orderId]: payments }));
  }, []);

  const getOrderPaymentStatus = useCallback((orderId: string, totalAmount: number) => {
    const payments = orderPayments[orderId] || [];
    if (payments.length === 0) return 'pending';
    const sum = payments.reduce((acc, p) => acc + p.amount, 0);
    return Math.abs(totalAmount - sum) < 0.01 ? 'complete' : 'partial';
  }, [orderPayments]);

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

  const completedCount = orders.filter(o => getOrderPaymentStatus(o.id, o.total_amount) === 'complete').length;
  const isCompleted = closing?.status === 'completed';

  const handleFinalize = async () => {
    const errs: string[] = [];
    orders.forEach((order, idx) => {
      const status = getOrderPaymentStatus(order.id, order.total_amount);
      if (status !== 'complete') {
        const label = order.order_type.toLowerCase() === 'ficha' ? 'Ficha'
          : /^\d+$/.test(order.order_type.trim()) ? `Retirada`
          : order.order_type;
        errs.push(`${label} (${order.sale_time || 'sem hora'}) — pagamento ${status === 'partial' ? 'parcial' : 'pendente'}`);
      }
    });

    if (errs.length > 0) {
      setErrors(errs);
      setShowErrors(true);
      return;
    }

    setFinalizing(true);
    const { error } = await supabase
      .from('salon_closings')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', id!);

    if (error) {
      toast.error('Erro ao finalizar conferência');
    } else {
      toast.success('Conferência concluída com sucesso!');
      setClosing(prev => prev ? { ...prev, status: 'completed' } : prev);
    }
    setFinalizing(false);
  };

  return (
    <AppLayout
      title={`Salão — ${formatDate(closing.closing_date)}`}
      subtitle={`${orders.length} pedidos`}
      headerActions={
        <div className="flex items-center gap-2">
          <Button variant="default" onClick={() => navigate(`/salon/reconciliation/${id}`)}>
            Conciliação Salão
          </Button>
          <Button variant="outline" onClick={() => navigate('/salon')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>
        </div>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-card rounded-xl shadow-card p-4 border border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Total Vendas</p>
          <p className="text-2xl font-bold text-foreground">
            R$ {totalAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-card rounded-xl shadow-card p-4 border border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Total Lançado</p>
          <p className="text-2xl font-bold text-foreground">
            R$ {totalAssigned.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-card rounded-xl shadow-card p-4 border border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Preenchidos</p>
          <p className="text-2xl font-bold text-foreground">{completedCount} / {filtered.length}</p>
        </div>
        <div className="bg-card rounded-xl shadow-card p-4 border border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Status</p>
          <Badge className={closing.status === 'completed' ? 'bg-success text-success-foreground' : 'bg-warning/15 text-warning border-warning/30'}>
            {closing.status === 'completed' ? 'Concluído' : 'Pendente'}
          </Badge>
        </div>
      </div>

      {/* Payment summary */}
      {paymentSummary.length > 0 && (
        <div className="bg-card rounded-xl shadow-card border border-border p-4 mb-6">
          <h3 className="text-sm font-semibold text-foreground mb-3">Resumo por Pagamento</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {paymentSummary.map(([method, data]) => (
              <div key={method} className="bg-muted/50 rounded-lg px-3 py-2">
                <p className="text-xs font-medium text-foreground truncate">{method}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-muted-foreground">{data.count}x</span>
                  <span className="text-xs font-semibold text-foreground">
                    R$ {data.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Todos os tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todos os tipos</SelectItem>
            {orderTypes.map(t => {
              const isNumber = /^\d+$/.test(t.trim());
              const label = t.toLowerCase() === 'ficha' ? 'Ficha'
                : isNumber ? 'Retirada'
                : (t.toLowerCase() === 'salão' || t.toLowerCase() === 'salao') ? 'Salão'
                : t;
              return (
                <SelectItem key={t} value={t}>
                  <span className={
                    t.toLowerCase() === 'ficha'
                      ? 'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium bg-foreground text-background'
                      : isNumber
                      ? 'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium bg-foreground text-warning'
                      : (t.toLowerCase() === 'salão' || t.toLowerCase() === 'salao')
                      ? 'inline-block rounded-full px-2 py-0.5 text-[11px] font-medium bg-warning text-foreground'
                      : ''
                  }>
                    {label}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">Tipo</TableHead>
                <TableHead className="w-[60px]">Hora</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead className="text-right w-[100px]">Total</TableHead>
                <TableHead className="w-[90px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Nenhum pedido encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((order) => {
                  const status = getOrderPaymentStatus(order.id, order.total_amount);
                  const payments = orderPayments[order.id] || [];
                  const isNumber = /^\d+$/.test(order.order_type.trim());

                  return (
                    <TableRow key={order.id}>
                      <TableCell>
                        {order.order_type.toLowerCase() === 'ficha' ? (
                          <Badge className="bg-foreground text-background border-transparent text-xs">Ficha</Badge>
                        ) : isNumber ? (
                          <Badge className="bg-foreground text-warning border-transparent text-xs">Retirada</Badge>
                        ) : order.order_type.toLowerCase() === 'salão' || order.order_type.toLowerCase() === 'salao' ? (
                          <Badge className="bg-warning text-foreground border-transparent text-xs">Salão</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">{order.order_type}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {order.sale_time || '—'}
                      </TableCell>
                      <TableCell className="py-2">
                        <SalonPaymentEditor
                          orderId={order.id}
                          totalAmount={order.total_amount}
                          payments={payments}
                          onPaymentsChanged={(p) => handlePaymentsChanged(order.id, p)}
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-sm">
                        R$ {order.total_amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        {status === 'complete' ? (
                          <Badge className="bg-success/15 text-success border-success/30 text-[10px]">
                            ✅ OK
                          </Badge>
                        ) : status === 'partial' ? (
                          <Badge className="bg-warning/15 text-warning border-warning/30 text-[10px]">
                            ⚠️ Parcial
                          </Badge>
                        ) : (
                          <Badge className="bg-muted text-muted-foreground text-[10px]">
                            Pendente
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Sticky footer */}
      <div className="sticky bottom-0 left-0 right-0 bg-card border-t border-border px-5 py-3 flex items-center justify-between mt-6 rounded-b-xl shadow-card">
        <div className="flex items-center gap-3">
          <Badge className={isCompleted ? 'bg-success/15 text-success border-success/30' : 'bg-warning/15 text-warning border-warning/30'}>
            {isCompleted ? '✅ Conferência concluída' : `⏳ ${completedCount}/${orders.length} preenchidos`}
          </Badge>
          {!isCompleted && completedCount === orders.length && orders.length > 0 && (
            <span className="text-xs text-success font-medium">Todos preenchidos — pronto para concluir!</span>
          )}
        </div>
        <Button
          onClick={handleFinalize}
          disabled={finalizing || isCompleted}
          className="bg-success hover:bg-success/90 text-success-foreground"
        >
          <CheckCircle2 className="h-4 w-4 mr-2" />
          {isCompleted ? 'Conferência Concluída' : finalizing ? 'Concluindo...' : 'Concluir Conferência'}
        </Button>
      </div>

      {/* Error dialog */}
      <Dialog open={showErrors} onOpenChange={setShowErrors}>
        <DialogContent className="sm:max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Pendências na Conferência
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {errors.length} pedido(s) com pagamento incompleto:
          </p>
          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {errors.map((err, i) => (
              <div key={i} className="flex items-start gap-2 text-sm bg-destructive/10 text-destructive rounded-md px-3 py-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{err}</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowErrors(false)}>
              Entendi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
