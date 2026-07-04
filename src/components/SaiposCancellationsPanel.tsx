import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Ban, ChevronDown, ChevronUp, RefreshCw, Copy, AlertTriangle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/payment-utils';
import { toast } from 'sonner';

interface CanceledSale {
  id_sale: number;
  sale_number: string;
  order_type: string;
  sale_time: string | null;
  total_amount: number;
  desc_sale: string | null;
  customer_name: string | null;
  canceled_items_count?: number;
}

interface ApiResponse {
  closing_date: string;
  scope: 'salon' | 'tele';
  canceled_sales: CanceledSale[];
  canceled_item_sales: CanceledSale[];
  counts: { canceled_sales: number; canceled_item_sales: number };
}

interface Props {
  closingDate: string;
  scope: 'salon' | 'tele';
}

function refLabel(s: CanceledSale, scope: 'salon' | 'tele'): string {
  if (scope === 'tele') {
    const parts: string[] = [`#${s.sale_number}`];
    if (s.customer_name) parts.push(s.customer_name);
    return parts.join(' — ');
  }
  const parts: string[] = [];
  if (s.desc_sale) parts.push(s.desc_sale);
  if (s.sale_number) parts.push(`#${s.sale_number}`);
  return parts.join(' — ') || `#${s.sale_number}`;
}

function typeBadgeCls(t: string): string {
  switch (t) {
    case 'Delivery': return 'bg-primary/10 text-primary';
    case 'Salão': return 'bg-success/10 text-success';
    case 'Retirada': return 'bg-warning/10 text-warning';
    case 'Ficha': return 'bg-muted text-muted-foreground';
    default: return 'bg-muted text-muted-foreground';
  }
}

export function SaiposCancellationsPanel({ closingDate, scope }: Props) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const fetchData = async () => {
    if (!closingDate) return;
    setLoading(true);
    setError(null);
    try {
      const { data: resp, error: err } = await supabase.functions.invoke('saipos-cancellations', {
        body: { closing_date: closingDate, scope },
      });
      if (err) throw err;
      if ((resp as any)?.error) throw new Error((resp as any).error);
      setData(resp as ApiResponse);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading && closingDate) {
      fetchData();
    }
  };

  const handleCopy = () => {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`Cancelamentos ${scope === 'salon' ? 'Salão' : 'Tele'} — ${closingDate}`);
    lines.push('');
    lines.push(`🔴 Vendas canceladas (${data.canceled_sales.length})`);
    if (data.canceled_sales.length === 0) {
      lines.push('  Nenhuma');
    } else {
      data.canceled_sales.forEach(s => {
        lines.push(`  • ${s.sale_time || ''} — ${s.order_type} — ${formatCurrency(s.total_amount)} — ${refLabel(s, scope)}`);
      });
    }
    lines.push('');
    lines.push(`🟠 Vendas com item cancelado (${data.canceled_item_sales.length})`);
    if (data.canceled_item_sales.length === 0) {
      lines.push('  Nenhuma');
    } else {
      data.canceled_item_sales.forEach(s => {
        lines.push(`  • ${s.sale_time || ''} — ${s.order_type} — ${formatCurrency(s.total_amount)} — ${refLabel(s, scope)} — ${s.canceled_items_count} item(ns) cancelado(s)`);
      });
    }
    navigator.clipboard.writeText(lines.join('\n'));
    toast.success('Resumo copiado!');
  };

  const totalCount = data ? data.counts.canceled_sales + data.counts.canceled_item_sales : 0;

  return (
    <div className="border-b border-border bg-card">
      <div className="px-6 py-3">
        <button
          onClick={handleToggle}
          className="w-full flex items-center justify-between hover:bg-muted/40 rounded-md px-2 py-1.5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-destructive" />
            <span className="text-sm font-semibold text-foreground">Cancelamentos do dia (Saipos)</span>
            {loaded && data && (
              <Badge variant="secondary" className="bg-destructive/10 text-destructive text-[10px]">
                {totalCount}
              </Badge>
            )}
          </div>
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {open && (
          <div className="mt-3 space-y-3">
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Consultando o Saipos...</span>
              </div>
            )}

            {error && !loading && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 flex items-center justify-between">
                <span className="text-xs text-destructive">{error}</span>
                <Button size="sm" variant="outline" onClick={fetchData}>Tentar de novo</Button>
              </div>
            )}

            {!loading && !error && data && (
              <>
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={fetchData} className="h-7 text-xs">
                    <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleCopy} className="h-7 text-xs">
                    <Copy className="h-3 w-3 mr-1" /> Copiar resumo
                  </Button>
                </div>

                <div className="rounded-md border border-destructive/30 bg-destructive/5">
                  <div className="px-3 py-2 border-b border-destructive/20 flex items-center justify-between">
                    <span className="text-xs font-semibold text-destructive">🔴 Vendas canceladas</span>
                    <Badge variant="secondary" className="bg-destructive/10 text-destructive text-[10px]">
                      {data.canceled_sales.length}
                    </Badge>
                  </div>
                  {data.canceled_sales.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">Nenhuma venda cancelada.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {data.canceled_sales.map(s => (
                        <div key={s.id_sale} className="px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                          <span className="font-mono tabular-nums text-muted-foreground">{s.sale_time || ''}</span>
                          <Badge className={`text-[9px] ${typeBadgeCls(s.order_type)}`}>{s.order_type}</Badge>
                          <span className="font-mono tabular-nums font-semibold">{formatCurrency(s.total_amount)}</span>
                          <span className="text-muted-foreground">{refLabel(s, scope)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-warning/30 bg-warning/5">
                  <div className="px-3 py-2 border-b border-warning/20 flex items-center justify-between">
                    <span className="text-xs font-semibold text-warning">🟠 Vendas com item cancelado</span>
                    <Badge variant="secondary" className="bg-warning/10 text-warning text-[10px]">
                      {data.canceled_item_sales.length}
                    </Badge>
                  </div>
                  {data.canceled_item_sales.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">Nenhuma venda com item cancelado.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {data.canceled_item_sales.map(s => (
                        <div key={s.id_sale} className="px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                          <span className="font-mono tabular-nums text-muted-foreground">{s.sale_time || ''}</span>
                          <Badge className={`text-[9px] ${typeBadgeCls(s.order_type)}`}>{s.order_type}</Badge>
                          <span className="font-mono tabular-nums font-semibold">{formatCurrency(s.total_amount)}</span>
                          <span className="text-muted-foreground">{refLabel(s, scope)}</span>
                          <Badge variant="secondary" className="bg-warning/10 text-warning text-[10px]">
                            {s.canceled_items_count} item(ns) cancelado(s)
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-start gap-2 px-2 py-1.5 text-[10px] text-muted-foreground">
                  <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>
                    ⚠️ A API do Saipos informa QUE houve cancelamento e QUANTOS itens, mas NÃO informa qual item foi modificado ou transferido, nem QUEM (garçom/atendente) fez. Para ver o responsável, use o "Relatório de vendas canceladas" no painel do Saipos.
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
