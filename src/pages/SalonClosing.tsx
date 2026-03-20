import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search } from 'lucide-react';
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
  const navigate = useNavigate();
  const [orders, setOrders] = useState<SalonOrder[]>([]);
  const [closing, setClosing] = useState<ClosingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  
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
      if (filterType && o.order_type !== filterType) return false;
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

  const completedCount = filtered.filter(o => getOrderPaymentStatus(o.id, o.total_amount) === 'complete').length;

  return (
    <AppLayout
      title={`Salão — ${formatDate(closing.closing_date)}`}
      subtitle={`${orders.length} pedidos`}
      headerActions={
        <Button variant="outline" onClick={() => navigate('/salon')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar
        </Button>
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
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground"
        >
          <option value="">Todos os tipos</option>
          {orderTypes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
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
    </AppLayout>
  );
}
