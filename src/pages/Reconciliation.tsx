import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Search, CheckCircle2, Clock, AlertTriangle, PartyPopper, CheckCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';

interface Order {
  id: string;
  order_number: string;
  payment_method: string;
  total_amount: number;
  delivery_person: string | null;
  is_confirmed: boolean;
}

export default function Reconciliation() {
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
    const newVal = !current;
    // Optimistic update
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
  }, [user]);

  const bulkUpdate = useCallback(async (confirm: boolean) => {
    if (!user || !id) return;
    const { error } = await supabase
      .from('imported_orders')
      .update({
        is_confirmed: confirm,
        confirmed_at: confirm ? new Date().toISOString() : null,
        confirmed_by: confirm ? user.id : null,
      })
      .eq('import_id', id);

    if (error) {
      toast.error('Erro ao atualizar pedidos.');
      return;
    }
    setOrders(prev => prev.map(o => ({ ...o, is_confirmed: confirm })));
    toast.success(confirm ? 'Todos marcados como conferidos.' : 'Todos desmarcados.');
  }, [user, id]);

  const finalize = useCallback(async () => {
    if (!id) return;
    setCompleting(true);
    const { error } = await supabase.from('imports').update({ status: 'completed' }).eq('id', id);
    if (error) {
      toast.error('Erro ao finalizar fechamento.');
    } else {
      setImportData(prev => prev ? { ...prev, status: 'completed' } : prev);
      toast.success('Fechamento concluído com sucesso!');
    }
    setCompleting(false);
  }, [id]);

  const confirmed = useMemo(() => orders.filter(o => o.is_confirmed).length, [orders]);
  const pending = useMemo(() => orders.length - confirmed, [orders, confirmed]);
  const percent = useMemo(() => orders.length ? Math.round((confirmed / orders.length) * 100) : 0, [orders, confirmed]);

  const paymentMethods = useMemo(() => [...new Set(orders.map(o => o.payment_method).filter(Boolean))].sort(), [orders]);
  const deliveryPersons = useMemo(() => [...new Set(orders.map(o => o.delivery_person).filter(Boolean) as string[])].sort(), [orders]);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (search && !o.order_number.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterPayment !== 'all' && o.payment_method !== filterPayment) return false;
      if (filterDelivery !== 'all' && o.delivery_person !== filterDelivery) return false;
      if (filterStatus === 'confirmed' && !o.is_confirmed) return false;
      if (filterStatus === 'pending' && o.is_confirmed) return false;
      return true;
    });
  }, [orders, search, filterPayment, filterDelivery, filterStatus]);

  const formatCurrency = (val: number) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const isCompleted = importData?.status === 'completed';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-base font-semibold text-foreground">{importData?.file_name}</h1>
              <p className="text-xs text-muted-foreground">{orders.length} pedidos</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => bulkUpdate(true)} disabled={isCompleted}>
              <CheckCheck className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Marcar todos</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => bulkUpdate(false)} disabled={isCompleted}>
              <XCircle className="h-4 w-4 mr-1" />
              <span className="hidden sm:inline">Desmarcar todos</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Stats */}
      <div className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total" value={orders.length} icon={<Clock className="h-4 w-4" />} color="text-foreground" />
          <StatCard label="Confirmados" value={confirmed} icon={<CheckCircle2 className="h-4 w-4" />} color="text-success" />
          <StatCard label="Pendentes" value={pending} icon={<AlertTriangle className="h-4 w-4" />} color="text-warning" />
          <div className="bg-secondary rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-1">Progresso</p>
            <p className="text-2xl font-semibold text-foreground font-mono-tabular">{percent}%</p>
            <div className="mt-2 h-1.5 bg-border rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full row-transition" style={{ width: `${percent}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar pedido..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9" />
          </div>
          <Select value={filterPayment} onValueChange={setFilterPayment}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Pagamento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos pagamentos</SelectItem>
              {paymentMethods.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterDelivery} onValueChange={setFilterDelivery}>
            <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Entregador" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos entregadores</SelectItem>
              {deliveryPersons.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="confirmed">Confirmados</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="bg-card rounded-lg shadow-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider w-12">✓</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Pedido</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Pagamento</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Total</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Entregador</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <tr
                    key={order.id}
                    className={`border-b border-border/50 row-transition cursor-pointer ${
                      order.is_confirmed
                        ? 'bg-muted/50 opacity-60'
                        : 'hover:bg-primary/5'
                    }`}
                    onClick={() => !isCompleted && toggleConfirm(order.id, order.is_confirmed)}
                  >
                    <td className="p-3">
                      <div className={`h-5 w-5 rounded border-2 flex items-center justify-center row-transition ${
                        order.is_confirmed
                          ? 'bg-success border-success animate-check-pop'
                          : 'border-border'
                      }`}>
                        {order.is_confirmed && <CheckCircle2 className="h-3.5 w-3.5 text-success-foreground" />}
                      </div>
                    </td>
                    <td className={`p-3 font-medium ${order.is_confirmed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                      #{order.order_number}
                    </td>
                    <td className={`p-3 text-sm ${order.is_confirmed ? 'text-muted-foreground' : 'text-foreground'}`}>
                      {order.payment_method}
                    </td>
                    <td className={`p-3 text-right font-mono-tabular text-sm ${order.is_confirmed ? 'text-muted-foreground' : 'text-foreground'}`}>
                      {formatCurrency(order.total_amount)}
                    </td>
                    <td className={`p-3 text-sm ${order.is_confirmed ? 'text-muted-foreground' : 'text-foreground'}`}>
                      {order.delivery_person || '—'}
                    </td>
                  </tr>
                ))}
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
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
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
            onClick={finalize}
            disabled={pending > 0 || isCompleted || completing}
            className="bg-success hover:bg-success/90 text-success-foreground"
          >
            {completing ? 'Finalizando...' : 'Finalizar Fechamento'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-secondary rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className={color}>{icon}</span>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className={`text-2xl font-semibold font-mono-tabular ${color}`}>{value}</p>
    </div>
  );
}
