import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Search, FileSpreadsheet, CheckCircle2, Clock } from 'lucide-react';
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
  is_confirmed: boolean;
}

interface ClosingData {
  id: string;
  closing_date: string;
  status: string;
}

export default function SalonClosing() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<SalonOrder[]>([]);
  const [closing, setClosing] = useState<ClosingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPayment, setFilterPayment] = useState('');

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
    setOrders((ordersData as SalonOrder[]) || []);
    setLoading(false);
  };

  const formatDate = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  };

  const orderTypes = useMemo(() => [...new Set(orders.map(o => o.order_type))].sort(), [orders]);
  const paymentMethods = useMemo(() => [...new Set(orders.map(o => o.payment_method).filter(Boolean))].sort(), [orders]);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (search) {
        const s = search.toLowerCase();
        if (!o.order_type.toLowerCase().includes(s) &&
            !o.payment_method.toLowerCase().includes(s) &&
            !(o.sale_time || '').includes(s)) return false;
      }
      if (filterType && o.order_type !== filterType) return false;
      if (filterPayment && o.payment_method !== filterPayment) return false;
      return true;
    });
  }, [orders, search, filterType, filterPayment]);

  const totalAmount = useMemo(() => filtered.reduce((sum, o) => sum + o.total_amount, 0), [filtered]);

  // Payment method summary — split comma-separated methods and aggregate individually
  const paymentSummary = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    filtered.forEach(o => {
      const raw = o.payment_method || '(sem pagamento)';
      const methods = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (methods.length <= 1) {
        const key = methods[0] || '(sem pagamento)';
        if (!map[key]) map[key] = { count: 0, total: 0 };
        map[key].count++;
        map[key].total += o.total_amount;
      } else {
        // Multiple methods: count each occurrence, split total evenly
        const perMethod: Record<string, number> = {};
        methods.forEach(m => {
          perMethod[m] = (perMethod[m] || 0) + 1;
        });
        const share = o.total_amount / methods.length;
        Object.entries(perMethod).forEach(([method, qty]) => {
          if (!map[method]) map[method] = { count: 0, total: 0 };
          map[method].count += qty;
          map[method].total += share * qty;
        });
      }
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [filtered]);

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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-card rounded-xl shadow-card p-4 border border-border">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Total</p>
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
        <select
          value={filterPayment}
          onChange={(e) => setFilterPayment(e.target.value)}
          className="border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground"
        >
          <option value="">Todos os pagamentos</option>
          {paymentMethods.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl shadow-card border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Hora</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    Nenhum pedido encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{order.order_type}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {order.sale_time || '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {order.payment_method || <span className="text-muted-foreground italic">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      R$ {order.total_amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppLayout>
  );
}
