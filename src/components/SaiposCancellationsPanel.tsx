import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Ban, ChevronDown, ChevronUp, RefreshCw, Copy, AlertTriangle, Loader2, ArrowRightLeft } from 'lucide-react';
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
  reason: string | null;
  done_by: string | null;
  authorized_by: string | null;
}

interface CanceledItem {
  id_sale: number;
  sale_number: string;
  order_type: string;
  sale_time: string | null;
  desc_sale: string | null;
  customer_name: string | null;
  desc_sale_item: string;
  removed_by: string | null;
  authorized_by: string | null;
  waiter_id: number | null;
}

interface TransferredItem {
  desc_sale_item: string;
  from_sale: number;
  from_ref: string;
  to_sale: number;
  to_ref: string;
  sale_time: string | null;
  waiter_id: number | null;
}

interface ApiResponse {
  closing_date: string;
  scope: 'salon' | 'tele';
  partial?: boolean;
  warning?: string;
  canceled_sales: CanceledSale[];
  canceled_items: CanceledItem[];
  transferred_items: TransferredItem[];
  counts: { canceled_sales: number; canceled_items: number; transferred_items: number };
}

interface Props {
  closingDate: string;
  scope: 'salon' | 'tele';
}

function saleRef(s: CanceledSale | CanceledItem, scope: 'salon' | 'tele'): string {
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
      if (err) {
        // Try to read real backend error from FunctionsHttpError context
        let backendMsg: string | null = null;
        try {
          const ctx = (err as any)?.context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error) backendMsg = String(body.error);
          }
        } catch { /* ignore */ }
        const raw = backendMsg || (err instanceof Error ? err.message : String(err));
        if (/504|502|timeout|timed out|pool/i.test(raw)) {
          throw new Error("O Saipos está instável no momento e demorou para responder. Já tentei algumas vezes automaticamente — aguarde alguns segundos e clique em 'Tentar de novo'.");
        }
        throw new Error(backendMsg || 'Não consegui carregar os cancelamentos agora. Tente de novo em alguns segundos.');
      }
      if ((resp as any)?.error) {
        const raw = String((resp as any).error);
        if (/504|502|timeout|timed out|pool/i.test(raw)) {
          throw new Error("O Saipos está instável no momento e demorou para responder. Já tentei algumas vezes automaticamente — aguarde alguns segundos e clique em 'Tentar de novo'.");
        }
        throw new Error(raw);
      }
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
    if (next && !loaded && !loading && closingDate) fetchData();
  };

  const handleCopy = () => {
    if (!data) return;
    const lines: string[] = [];
    lines.push(`Cancelamentos ${scope === 'salon' ? 'Salão' : 'Tele'} — ${closingDate}`);
    lines.push('');
    lines.push(`🔴 Vendas canceladas (${data.canceled_sales.length})`);
    if (data.canceled_sales.length === 0) lines.push('  Nenhuma');
    else data.canceled_sales.forEach(s => {
      lines.push(`  • ${s.sale_time || ''} — ${s.order_type} — ${formatCurrency(s.total_amount)} — ${saleRef(s, scope)}`);
      const extras: string[] = [];
      if (s.reason) extras.push(`Motivo: ${s.reason}`);
      if (s.authorized_by) extras.push(`Autorizado por: ${s.authorized_by}`);
      if (s.done_by && s.done_by !== s.authorized_by) extras.push(`feito no login: ${s.done_by}`);
      if (extras.length) lines.push(`      ${extras.join(' · ')}`);
    });
    lines.push('');
    lines.push(`🟠 Itens cancelados (${data.canceled_items.length})`);
    if (data.canceled_items.length === 0) lines.push('  Nenhum');
    else data.canceled_items.forEach(it => {
      lines.push(`  • ${it.sale_time || ''} — ${saleRef(it, scope)} — ${it.desc_sale_item}`);
      const extras: string[] = [];
      if (it.authorized_by) extras.push(`Autorizado por: ${it.authorized_by}`);
      if (it.removed_by) extras.push(`Removido por: ${it.removed_by}`);
      if (it.waiter_id) extras.push(`garçom cód. ${it.waiter_id}`);
      if (extras.length) lines.push(`      ${extras.join(' · ')}`);
    });
    lines.push('');
    lines.push(`🔵 Itens transferidos (${data.transferred_items.length})`);
    if (data.transferred_items.length === 0) lines.push('  Nenhum');
    else data.transferred_items.forEach(t => {
      lines.push(`  • ${t.sale_time || ''} — ${t.desc_sale_item} — ${t.from_ref} → ${t.to_ref}`);
    });
    navigator.clipboard.writeText(lines.join('\n'));
    toast.success('Resumo copiado!');
  };

  const totalCount = data ? data.counts.canceled_sales + data.counts.canceled_items + data.counts.transferred_items : 0;

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

                {data.partial && data.warning && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 flex-shrink-0" />
                    <span className="text-[11px] text-warning-foreground/90 flex-1">{data.warning}</span>
                  </div>
                )}

                {/* Vendas canceladas */}
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
                        <div key={`cs-${s.id_sale}`} className="px-3 py-2 text-xs space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono tabular-nums text-muted-foreground">{s.sale_time || ''}</span>
                            <Badge className={`text-[9px] ${typeBadgeCls(s.order_type)}`}>{s.order_type}</Badge>
                            <span className="font-mono tabular-nums font-semibold">{formatCurrency(s.total_amount)}</span>
                            <span className="text-muted-foreground">{saleRef(s, scope)}</span>
                          </div>
                          {(s.reason || s.authorized_by || s.done_by) && (
                            <div className="text-[10px] text-muted-foreground pl-1">
                              {s.reason && <span>Motivo: <span className="text-foreground">{s.reason}</span></span>}
                              {s.reason && (s.authorized_by || s.done_by) && <span> · </span>}
                              {s.authorized_by && <span>Autorizado por: <span className="text-foreground">{s.authorized_by}</span></span>}
                              {s.done_by && s.done_by !== s.authorized_by && (
                                <span> · feito no login: <span className="text-foreground">{s.done_by}</span></span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Itens cancelados */}
                <div className="rounded-md border border-warning/30 bg-warning/5">
                  <div className="px-3 py-2 border-b border-warning/20 flex items-center justify-between">
                    <span className="text-xs font-semibold text-warning">🟠 Itens cancelados</span>
                    <Badge variant="secondary" className="bg-warning/10 text-warning text-[10px]">
                      {data.canceled_items.length}
                    </Badge>
                  </div>
                  {data.canceled_items.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">Nenhum item cancelado.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {data.canceled_items.map((it, i) => (
                        <div key={`ci-${it.id_sale}-${i}`} className="px-3 py-2 text-xs space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono tabular-nums text-muted-foreground">{it.sale_time || ''}</span>
                            <Badge className={`text-[9px] ${typeBadgeCls(it.order_type)}`}>{it.order_type}</Badge>
                            <span className="text-muted-foreground">{saleRef(it, scope)}</span>
                            <span className="font-semibold text-foreground">{it.desc_sale_item}</span>
                          </div>
                          {(it.authorized_by || it.removed_by || it.waiter_id) && (
                            <div className="text-[10px] text-muted-foreground pl-1">
                              {it.authorized_by && <span>Autorizado por: <span className="text-foreground">{it.authorized_by}</span></span>}
                              {it.authorized_by && it.removed_by && <span> · </span>}
                              {it.removed_by && <span>Removido por: <span className="text-foreground">{it.removed_by}</span></span>}
                              {it.waiter_id && <span> · garçom cód. {it.waiter_id}</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Itens transferidos */}
                <div className="rounded-md border border-primary/30 bg-primary/5">
                  <div className="px-3 py-2 border-b border-primary/20 flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary flex items-center gap-1">
                      <ArrowRightLeft className="h-3 w-3" /> 🔵 Itens transferidos entre mesas/comandas
                    </span>
                    <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px]">
                      {data.transferred_items.length}
                    </Badge>
                  </div>
                  {data.transferred_items.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">Nenhum item transferido.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {data.transferred_items.map((t, i) => (
                        <div key={`tr-${t.from_sale}-${t.to_sale}-${i}`} className="px-3 py-2 text-xs flex flex-wrap items-center gap-2">
                          <span className="font-mono tabular-nums text-muted-foreground">{t.sale_time || ''}</span>
                          <span className="font-semibold text-foreground">{t.desc_sale_item}</span>
                          <span className="text-muted-foreground">{t.from_ref} → {t.to_ref}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-start gap-2 px-2 py-1.5 text-[10px] text-muted-foreground">
                  <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>
                    ✅ Agora mostramos quem AUTORIZOU/removeu (pelo nome) e o motivo. ⚠️ Único limite: o garçom específico do item às vezes vem só como código interno (a API não fornece o nome do garçom por item).
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
