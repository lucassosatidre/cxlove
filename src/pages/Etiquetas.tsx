import { useState, useRef } from 'react';
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
import AppSidebar from '@/components/AppSidebar';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

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
}

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

  // Width constraint: 60mm ≈ 227px, estimate ~7px per char at 12px font
  // Height constraint: 30mm ≈ 113px, with line-height 1.3
  let fontSize = 16;
  if (lineCount >= 5) fontSize = 9;
  else if (lineCount >= 4) fontSize = 11;
  else if (lineCount >= 3) fontSize = 12;
  else fontSize = 14;

  // Reduce if longest line is too wide (approx 0.6 * fontSize per char)
  const maxWidth = 212; // 227px - 15px padding
  const charWidth = fontSize * 0.6;
  if (maxChars * charWidth > maxWidth) {
    fontSize = Math.floor(maxWidth / (maxChars * 0.6));
  }

  // Ensure fits height (113px - 15px padding = 98px usable)
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
  );
}

export default function Etiquetas() {
  const [date, setDate] = useState<Date>(new Date());
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [printMode, setPrintMode] = useState<'single' | 'grid'>('single');
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

  const selectedOrders = orders.filter(o => selected.has(o.id));
  const selectedLabels = expandLabels(selectedOrders);
  const totalLabelCount = selectedLabels.length;

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
                  <div className="text-sm text-muted-foreground space-y-0.5">
                    <div className="font-semibold text-foreground">
                      Pedido: {formatOrderNumber(order.sale_number)}  Itens: {getTotalItemCount(order)}
                      {getPizzaCount(order) > 1 && <span className="ml-2 text-xs font-normal text-muted-foreground">({getPizzaCount(order)} etiquetas)</span>}
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
            const lineCount = 1 + order.items.length;
            const header = formatHeaderLine(order, index, total);
            return (
              <div key={`${order.id}-${index}`} className="etiqueta">
                <div className={cn("label-items", getLabelPrintClass(lineCount))}>
                  <div className="label-header">{header}</div>
                  {order.items.map((item, i) => (
                    <div key={i} className="label-item">{formatItemDisplay(item)}</div>
                  ))}
                  {order.items.length === 0 && <div className="label-item">-</div>}
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
