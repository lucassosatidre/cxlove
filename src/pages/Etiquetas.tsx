import { useState, useRef } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { CalendarIcon, Printer, RefreshCw, Search, CheckSquare, Square } from 'lucide-react';
import AppSidebar from '@/components/AppSidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface OrderItem {
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  id: number;
  sale_number: string;
  payment_method: string;
  total: number;
  items: OrderItem[];
  delivery_person: string | null;
  sale_time: string | null;
}

export default function Etiquetas() {
  const [date, setDate] = useState<Date>(new Date());
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [debugRawItems, setDebugRawItems] = useState<any[] | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const closingDate = format(date, 'yyyy-MM-dd');

  const fetchOrders = async () => {
    setLoading(true);
    setFetched(false);
    setSelected(new Set());
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: 'Erro', description: 'Sessão expirada', variant: 'destructive' });
        return;
      }

      const { data, error } = await supabase.functions.invoke('fetch-saipos-labels', {
        body: { closing_date: closingDate },
      });

      if (error) throw error;
      setOrders(data.orders || []);
      setDebugRawItems(data.debug_raw_items || null);
      setFetched(true);
      toast({ title: `${data.total_sales} pedidos encontrados` });
    } catch (err: any) {
      toast({ title: 'Erro ao buscar pedidos', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selected.size === orders.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(orders.map(o => o.id)));
    }
  };

  const handlePrint = () => {
    if (selected.size === 0) {
      toast({ title: 'Selecione ao menos um pedido', variant: 'destructive' });
      return;
    }
    window.print();
  };

  const formatCurrency = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const selectedOrders = orders.filter(o => selected.has(o.id));

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar open={!isMobile || sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className={cn('flex-1 transition-all duration-200', !isMobile && 'ml-56')}>
        {/* Screen content - hidden on print */}
        <div className="print:hidden">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-background border-b border-border px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold text-foreground">Etiquetas</h1>
                <p className="text-sm text-muted-foreground">Imprima etiquetas dos pedidos do dia</p>
              </div>
              {isMobile && (
                <button onClick={() => setSidebarOpen(true)} className="p-2 text-muted-foreground">
                  <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
                </button>
              )}
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    {format(date, "dd/MM/yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => d && setDate(d)}
                    locale={ptBR}
                  />
                </PopoverContent>
              </Popover>

              <Button onClick={fetchOrders} disabled={loading} className="gap-2">
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Buscar pedidos
              </Button>

              {orders.length > 0 && (
                <>
                  <Button variant="outline" onClick={selectAll} className="gap-2">
                    {selected.size === orders.length ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    {selected.size === orders.length ? 'Desmarcar todos' : 'Selecionar todos'}
                  </Button>
                  <Button onClick={handlePrint} disabled={selected.size === 0} className="gap-2">
                    <Printer className="h-4 w-4" />
                    Imprimir ({selected.size})
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Orders list */}
          <div className="p-4 sm:p-6 space-y-2">
            {loading && (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ))}
              </div>
            )}

            {!loading && fetched && orders.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                Nenhum pedido encontrado para {format(date, "dd/MM/yyyy")}
              </div>
            )}

            {!loading && orders.map(order => (
              <div
                key={order.id}
                onClick={() => toggleSelect(order.id)}
                className={cn(
                  'flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors',
                  selected.has(order.id)
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:bg-muted/50'
                )}
              >
                <Checkbox
                  checked={selected.has(order.id)}
                  onCheckedChange={() => toggleSelect(order.id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">
                      #{order.sale_number.padStart(4, '0')}
                    </span>
                    <span className="font-semibold text-foreground">
                      {formatCurrency(order.total)}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {order.items.length > 0
                      ? order.items.map(i => `${i.quantity}x ${i.name}`).join(', ')
                      : 'Sem itens'}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>{order.payment_method}</span>
                    {order.delivery_person && <span>• {order.delivery_person}</span>}
                  </div>
                </div>
              </div>
            ))}

            {debugRawItems && debugRawItems.length > 0 && (
              <div className="mt-6 border border-border rounded-lg bg-card">
                <button
                  onClick={() => setDebugOpen(!debugOpen)}
                  className="w-full flex items-center justify-between p-4 text-left font-semibold text-foreground"
                >
                  Debug — Dados brutos da API Saipos ({debugRawItems.length} itens)
                  <span className={cn('transition-transform', debugOpen && 'rotate-180')}>▼</span>
                </button>
                {debugOpen && (
                  <pre className="p-4 pt-0 text-xs text-muted-foreground overflow-auto max-h-[500px] whitespace-pre-wrap break-all">
                    {JSON.stringify(debugRawItems, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Print-only labels */}
        <div ref={printRef} className="hidden print:block">
          {selectedOrders.map(order => (
            <div key={order.id} className="etiqueta">
              <div className="label-header">PIZZARIA ESTRELA DA ILHA</div>
              <div className="label-order">PEDIDO #{order.sale_number.padStart(4, '0')}</div>
              <div className="label-section">
                <div className="label-title">ITENS:</div>
                {order.items.length > 0
                  ? order.items.map((item, i) => (
                      <div key={i} className="label-item">{item.quantity}x {item.name}</div>
                    ))
                  : <div className="label-item">-</div>
                }
              </div>
              <div className="label-footer">
                <div>PAGAMENTO: {order.payment_method}</div>
                <div>TOTAL: {formatCurrency(order.total)}</div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
