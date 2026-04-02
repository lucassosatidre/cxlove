import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { CalendarIcon, Printer, RefreshCw, Search, CheckSquare, Square, Eye } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import AppSidebar from '@/components/AppSidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { getOperationalDate } from '@/lib/operational-date';

interface OrderItem {
  name: string;
  type: 'pizza' | 'drink';
  quantity: number;
}

interface Order {
  id: number;
  sale_number: string;
  total: number;
  items: OrderItem[];
  sale_time: string | null;
  printed: boolean;
  printed_at: string | null;
  db_id?: string;
}

type FilterMode = 'all' | 'not_printed' | 'printed';

const formatItemDisplay = (item: OrderItem) => {
  return `▸ ${item.quantity}x ${item.name}`;
};

const formatOrderNumber = (saleNumber: string) => {
  return `${parseInt(saleNumber, 10) || saleNumber}`;
};

const getTotalItemCount = (order: Order) =>
  order.items.reduce((sum, i) => sum + i.quantity, 0);

const getLabelFontSizes = (order: Order, index: number, total: number) => {
  const headerLine = formatHeaderLine(order, index, total);
  const itemLines = order.items.map(i => formatItemDisplay(i));
  const totalLine = `Total de itens: ${getTotalItemCount(order)}`;
  const allLines = [headerLine, ...itemLines, totalLine];
  const lineCount = allLines.length;
  const maxChars = Math.max(...allLines.map(l => l.length));

  let fontSize = 16;
  if (lineCount >= 5) fontSize = 9;
  else if (lineCount >= 4) fontSize = 11;
  else if (lineCount >= 3) fontSize = 12;
  else fontSize = 14;

  const maxWidth = 212;
  const charWidth = fontSize * 0.6;
  if (maxChars * charWidth > maxWidth) {
    fontSize = Math.floor(maxWidth / (maxChars * 0.6));
  }

  const maxHeight = 98;
  let lineHeight = 1.3;
  if (lineCount * fontSize * lineHeight > maxHeight) {
    fontSize = Math.floor(maxHeight / (lineCount * lineHeight));
  }
  if (fontSize < 8) {
    fontSize = 8;
    lineHeight = 1.1;
  }

  const headerSize = Math.min(fontSize + 2, 16);
  return { header: `${headerSize}px`, item: `${fontSize}px`, lineHeight: `${lineHeight}` };
};

const getLabelPrintClass = (order: Order, index: number, total: number) => {
  const sizes = getLabelFontSizes(order, index, total);
  const fs = parseInt(sizes.item);
  if (fs >= 14) return 'font-xl';
  if (fs >= 12) return 'font-lg';
  if (fs >= 11) return 'font-md';
  return 'font-sm';
};

const formatHeaderLine = (order: Order, index: number, total: number) => {
  const num = formatOrderNumber(order.sale_number);
  return `Nº ${num}  -  Pizza: ${index}/${total}`;
};

const getPizzaCount = (order: Order) =>
  order.items.filter(i => i.type === 'pizza').reduce((sum, i) => sum + i.quantity, 0);

const expandLabels = (orders: Order[]) => {
  const labels: { order: Order; index: number; total: number }[] = [];
  for (const order of orders) {
    const count = Math.max(1, getPizzaCount(order));
    for (let i = 0; i < count; i++) {
      labels.push({ order, index: i + 1, total: count });
    }
  }
  return labels;
};

function LabelPreview({ order, index, total }: { order: Order; index: number; total: number }) {
  const fonts = getLabelFontSizes(order, index, total);
  const header = formatHeaderLine(order, index, total);
  const totalItems = getTotalItemCount(order);
  return (
    <div className="border border-dashed border-muted-foreground/40 rounded bg-white text-black flex flex-col justify-center"
         style={{ width: '227px', minHeight: '113px', padding: '7.5px', fontFamily: 'Arial, sans-serif', lineHeight: fonts.lineHeight }}>
      <div style={{ fontSize: fonts.header, fontWeight: 'bold', lineHeight: fonts.lineHeight, wordWrap: 'break-word', overflowWrap: 'break-word' }}>
        {header}
      </div>
      {order.items.map((item, i) => (
        <div key={i} style={{ fontSize: fonts.item, lineHeight: fonts.lineHeight, wordWrap: 'break-word', overflowWrap: 'break-word' }}>
          {formatItemDisplay(item)}
        </div>
      ))}
      {order.items.length === 0 && <div style={{ fontSize: fonts.item }}>-</div>}
      <div style={{ fontSize: fonts.item, lineHeight: fonts.lineHeight }}>
        Total de itens: {totalItems}
      </div>
    </div>
  );
}

export default function Etiquetas() {
  const [date, setDate] = useState<Date>(() => {
    const opDate = getOperationalDate();
    return new Date(opDate + 'T12:00:00');
  });
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingDb, setLoadingDb] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [printMode, setPrintMode] = useState<'single' | 'grid'>('single');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [printOrderIds, setPrintOrderIds] = useState<number[] | null>(null);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const closingDate = format(date, 'yyyy-MM-dd');

  // Load from DB on mount and date change
  useEffect(() => {
    loadFromDb();
  }, [closingDate]);

  const loadFromDb = async () => {
    setLoadingDb(true);
    try {
      const { data, error } = await supabase
        .from('label_orders')
        .select('*')
        .eq('shift_date', closingDate)
        .order('sale_number', { ascending: true });

      if (error) throw error;

      const dbOrders: Order[] = (data || []).map((row: any) => ({
        id: row.saipos_sale_id,
        sale_number: row.sale_number,
        total: 0,
        items: row.items as OrderItem[],
        sale_time: null,
        printed: row.printed,
        printed_at: row.printed_at,
        db_id: row.id,
      }));
      setOrders(dbOrders);
      setSelected(new Set());
    } catch (err: any) {
      console.error('Error loading label orders:', err);
    } finally {
      setLoadingDb(false);
    }
  };

  const fetchOrders = async () => {
    setLoading(true);
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
      const apiOrders: Array<{ id: number; sale_number: string; total: number; items: OrderItem[]; sale_time: string | null }> = data.orders || [];

      // Upsert into DB
      const userId = session.user.id;
      for (const order of apiOrders) {
        const pizzaCount = order.items.filter(i => i.type === 'pizza').reduce((s, i) => s + i.quantity, 0);
        await supabase
          .from('label_orders')
          .upsert({
            saipos_sale_id: order.id,
            sale_number: order.sale_number,
            items: order.items as any,
            pizza_count: pizzaCount,
            shift_date: closingDate,
            user_id: userId,
          }, { onConflict: 'saipos_sale_id,shift_date' });
      }

      // Reload from DB to get canonical state
      await loadFromDb();
      toast({ title: `${apiOrders.length} pedidos sincronizados` });
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
    const visible = filteredOrders.map(o => o.id);
    if (visible.every(id => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible));
    }
  };

  const markAsPrinted = async (orderIds: number[]) => {
    const now = new Date().toISOString();
    const dbIds = orders.filter(o => orderIds.includes(o.id) && o.db_id).map(o => o.db_id!);
    if (dbIds.length > 0) {
      await supabase
        .from('label_orders')
        .update({ printed: true, printed_at: now })
        .in('id', dbIds);
    }
    setOrders(prev => prev.map(o =>
      orderIds.includes(o.id) ? { ...o, printed: true, printed_at: now } : o
    ));
  };

  const handlePrint = async () => {
    if (selected.size === 0) {
      toast({ title: 'Selecione ao menos um pedido', variant: 'destructive' });
      return;
    }
    await markAsPrinted(Array.from(selected));
    const originalTitle = document.title;
    document.title = ' ';
    window.print();
    document.title = originalTitle;
  };

  const handlePreview = () => {
    if (selected.size === 0) {
      toast({ title: 'Selecione ao menos um pedido', variant: 'destructive' });
      return;
    }
    setPreviewOpen(true);
  };

  const filteredOrders = orders.filter(o => {
    if (filter === 'printed') return o.printed;
    if (filter === 'not_printed') return !o.printed;
    return true;
  });

  const selectedOrders = orders.filter(o => selected.has(o.id));
  const selectedLabels = expandLabels(selectedOrders);
  const totalLabelCount = selectedLabels.length;

  const isLoading = loading || loadingDb;

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
                  {/* Filter buttons */}
                  <div className="flex items-center gap-1 border border-border rounded-md overflow-hidden">
                    {([['all', 'Todos'], ['not_printed', 'Não impressos'], ['printed', 'Impressos']] as [FilterMode, string][]).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setFilter(key)}
                        className={cn('px-3 py-1.5 text-xs font-medium transition-colors', filter === key ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted')}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <Button variant="outline" onClick={selectAll} className="gap-2">
                    {filteredOrders.every(o => selected.has(o.id)) && filteredOrders.length > 0 ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                    {filteredOrders.every(o => selected.has(o.id)) && filteredOrders.length > 0 ? 'Desmarcar todos' : 'Selecionar todos'}
                  </Button>

                  <div className="flex items-center gap-1 border border-border rounded-md overflow-hidden">
                    <button
                      onClick={() => setPrintMode('single')}
                      className={cn('px-3 py-1.5 text-xs font-medium transition-colors', printMode === 'single' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted')}
                    >
                      1 por página
                    </button>
                    <button
                      onClick={() => setPrintMode('grid')}
                      className={cn('px-3 py-1.5 text-xs font-medium transition-colors', printMode === 'grid' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted')}
                    >
                      Múltiplas
                    </button>
                  </div>

                  <Button variant="outline" onClick={handlePreview} disabled={selected.size === 0} className="gap-2">
                    <Eye className="h-4 w-4" />
                    Prévia
                  </Button>
                  <Button onClick={handlePrint} disabled={selected.size === 0} className="gap-2">
                    <Printer className="h-4 w-4" />
                    Imprimir ({totalLabelCount})
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Orders list */}
          <div className="p-4 sm:p-6 space-y-2">
            {isLoading && (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ))}
              </div>
            )}

            {!isLoading && orders.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                Nenhum pedido encontrado para {format(date, "dd/MM/yyyy")}. Clique em "Buscar pedidos" para importar da API.
              </div>
            )}

            {!isLoading && filteredOrders.length === 0 && orders.length > 0 && (
              <div className="text-center py-12 text-muted-foreground">
                Nenhum pedido {filter === 'printed' ? 'impresso' : 'não impresso'} encontrado.
              </div>
            )}

            {!isLoading && filteredOrders.map(order => (
              <div
                key={order.id}
                onClick={() => toggleSelect(order.id)}
                className={cn(
                  'flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors',
                  selected.has(order.id)
                    ? 'border-primary bg-primary/5'
                    : order.printed
                    ? 'border-border bg-muted/30 hover:bg-muted/50'
                    : 'border-border bg-card hover:bg-muted/50'
                )}
              >
                <Checkbox
                  checked={selected.has(order.id)}
                  onCheckedChange={() => toggleSelect(order.id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className={cn('text-sm space-y-0.5', order.printed ? 'text-muted-foreground' : 'text-muted-foreground')}>
                    <div className={cn('font-semibold', order.printed ? 'text-muted-foreground' : 'text-foreground')}>
                      Nº {formatOrderNumber(order.sale_number)}  -  Pizza: {Math.max(1, getPizzaCount(order))}/{Math.max(1, getPizzaCount(order))}  |  Total de itens: {getTotalItemCount(order)}
                      {getPizzaCount(order) > 1 && <span className="ml-2 text-xs font-normal text-muted-foreground">({getPizzaCount(order)} etiquetas)</span>}
                      {order.printed && (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded">
                          ✓ Impresso
                        </span>
                      )}
                    </div>
                    {order.items.length > 0 ? (
                      order.items.map((item, i) => (
                        <div key={i}>{formatItemDisplay(item)}</div>
                      ))
                    ) : (
                      <div>Sem itens</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Print-only labels */}
        <div id="print-labels" ref={printRef} className={cn("hidden print:block", printMode === 'grid' ? 'print-grid' : 'print-single')}>
          {selectedLabels.map(({ order, index, total }) => {
            const header = formatHeaderLine(order, index, total);
            const totalItems = getTotalItemCount(order);
            return (
              <div key={`${order.id}-${index}`} className="etiqueta">
                <div className={cn("label-items", getLabelPrintClass(order, index, total))}>
                  <div className="label-header">{header}</div>
                  {order.items.map((item, i) => (
                    <div key={i} className="label-item">{formatItemDisplay(item)}</div>
                  ))}
                  {order.items.length === 0 && <div className="label-item">-</div>}
                  <div className="label-item">Total de itens: {totalItems}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Preview modal */}
        <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Prévia das Etiquetas ({totalLabelCount}) — {printMode === 'grid' ? 'Múltiplas por página' : '1 por página'}</DialogTitle>
            </DialogHeader>
            <div className={cn("py-2", printMode === 'grid' ? 'flex flex-wrap gap-1 justify-center' : 'space-y-4')}>
              {selectedLabels.map(({ order, index, total }) => (
                <div key={`${order.id}-${index}`} className={cn(printMode === 'grid' ? '' : 'flex justify-center')}>
                  <LabelPreview order={order} index={index} total={total} />
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
