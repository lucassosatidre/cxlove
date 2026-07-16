import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Percent, ChevronDown, ChevronUp, RefreshCw, Copy, AlertTriangle, Loader2, Ticket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/payment-utils';
import { toast } from 'sonner';

interface DiscountSale {
  id_sale: number;
  sale_number: string;
  order_type: string;
  sale_time: string | null;
  total_amount: number;
  items_amount: number;
  discount_amount: number;
  discount_pct: number;
  coupon: string | null;
  coupon_discount: number | null;
  reason: string | null;
  note: string | null;
  customer_name: string | null;
  is_zeroed: boolean;
}

interface ApiResponse {
  closing_date: string;
  scope: 'salon' | 'tele';
  partial?: boolean;
  warning?: string;
  discounts: DiscountSale[];
  counts: { total: number; zeroed: number; sum_discount: number };
}

interface Props {
  closingDate: string;
  scope: 'salon' | 'tele';
}

function saleRef(s: DiscountSale): string {
  const parts: string[] = [`#${s.sale_number}`];
  if (s.customer_name) parts.push(s.customer_name);
  return parts.join(' — ');
}

function motivoDe(s: DiscountSale): string | null {
  if (s.coupon) return `Cupom: ${s.coupon}`;
  if (s.reason) return `Motivo: ${s.reason}`;
  if (s.note) return `Obs.: ${s.note}`;
  return null;
}

export function SaiposDiscountsPanel({ closingDate, scope }: Props) {
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
      const { data: resp, error: err } = await supabase.functions.invoke('saipos-discounts', {
        body: { closing_date: closingDate, scope },
      });
      if (err) {
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
        throw new Error(backendMsg || 'Não consegui carregar os descontos agora. Tente de novo em alguns segundos.');
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
    const zeradas = data.discounts.filter((d) => d.is_zeroed);
    const grandes = data.discounts.filter((d) => !d.is_zeroed);
    const lines: string[] = [];
    lines.push(`Descontos ${scope === 'salon' ? 'Salão' : 'Tele/Delivery'} — ${closingDate}`);
    lines.push('(sem os descontos automáticos do iFood/Brendi)');
    lines.push('');
    lines.push(`🔴 Comandas zeradas (${zeradas.length})`);
    if (zeradas.length === 0) lines.push('  Nenhuma');
    else zeradas.forEach((s) => {
      lines.push(`  • ${s.sale_time || ''} — ${saleRef(s)} — itens ${formatCurrency(s.items_amount)} → pago ${formatCurrency(s.total_amount)} (desconto ${formatCurrency(s.discount_amount)})`);
      const m = motivoDe(s);
      if (m) lines.push(`      ${m}`);
    });
    lines.push('');
    lines.push(`🟠 Descontos aplicados (${grandes.length})`);
    if (grandes.length === 0) lines.push('  Nenhum');
    else grandes.forEach((s) => {
      lines.push(`  • ${s.sale_time || ''} — ${saleRef(s)} — desconto ${formatCurrency(s.discount_amount)} (−${s.discount_pct}%) · pago ${formatCurrency(s.total_amount)}`);
      const m = motivoDe(s);
      if (m) lines.push(`      ${m}`);
    });
    navigator.clipboard.writeText(lines.join('\n'));
    toast.success('Resumo copiado!');
  };

  const zeradas = data ? data.discounts.filter((d) => d.is_zeroed) : [];
  const grandes = data ? data.discounts.filter((d) => !d.is_zeroed) : [];

  const renderRow = (s: DiscountSale) => {
    const m = motivoDe(s);
    return (
      <div key={`ds-${s.id_sale}`} className="px-3 py-2 text-xs space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono tabular-nums text-muted-foreground">{s.sale_time || ''}</span>
          <span className="text-muted-foreground">{saleRef(s)}</span>
          <span className="text-muted-foreground">
            itens <span className="font-mono tabular-nums">{formatCurrency(s.items_amount)}</span>
            {' → '}
            pago <span className="font-mono tabular-nums font-semibold text-foreground">{formatCurrency(s.total_amount)}</span>
          </span>
          <Badge className="bg-destructive/10 text-destructive text-[9px]">
            − {formatCurrency(s.discount_amount)}{s.discount_pct ? ` (${s.discount_pct}%)` : ''}
          </Badge>
          {s.is_zeroed && (
            <Badge className="bg-destructive/15 text-destructive text-[9px]">comanda zerada</Badge>
          )}
        </div>
        {m && (
          <div className="text-[10px] text-muted-foreground pl-1 flex items-center gap-1">
            {s.coupon && <Ticket className="h-3 w-3 flex-shrink-0" />}
            <span className="text-foreground">{m}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="border-b border-border bg-card">
      <div className="px-6 py-3">
        <button
          onClick={handleToggle}
          className="w-full flex items-center justify-between hover:bg-muted/40 rounded-md px-2 py-1.5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Percent className="h-4 w-4 text-warning" />
            <span className="text-sm font-semibold text-foreground">Descontos e comandas zeradas (Saipos)</span>
            {loaded && data && (
              <Badge variant="secondary" className="bg-warning/10 text-warning text-[10px]">
                {data.counts.total}
              </Badge>
            )}
            {loaded && data && data.counts.zeroed > 0 && (
              <Badge variant="secondary" className="bg-destructive/10 text-destructive text-[10px]">
                {data.counts.zeroed} zerada{data.counts.zeroed > 1 ? 's' : ''}
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
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    Total descontado (manual): <span className="font-semibold text-foreground">{formatCurrency(data.counts.sum_discount)}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={fetchData} className="h-7 text-xs">
                      <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleCopy} className="h-7 text-xs">
                      <Copy className="h-3 w-3 mr-1" /> Copiar resumo
                    </Button>
                  </div>
                </div>

                {data.partial && data.warning && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning mt-0.5 flex-shrink-0" />
                    <span className="text-[11px] text-warning-foreground/90 flex-1">{data.warning}</span>
                  </div>
                )}

                {/* Comandas zeradas */}
                <div className="rounded-md border border-destructive/30 bg-destructive/5">
                  <div className="px-3 py-2 border-b border-destructive/20 flex items-center justify-between">
                    <span className="text-xs font-semibold text-destructive">🔴 Comandas zeradas</span>
                    <Badge variant="secondary" className="bg-destructive/10 text-destructive text-[10px]">
                      {zeradas.length}
                    </Badge>
                  </div>
                  {zeradas.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">Nenhuma comanda zerada.</p>
                  ) : (
                    <div className="divide-y divide-border">{zeradas.map(renderRow)}</div>
                  )}
                </div>

                {/* Descontos aplicados */}
                <div className="rounded-md border border-warning/30 bg-warning/5">
                  <div className="px-3 py-2 border-b border-warning/20 flex items-center justify-between">
                    <span className="text-xs font-semibold text-warning">🟠 Descontos aplicados na comanda</span>
                    <Badge variant="secondary" className="bg-warning/10 text-warning text-[10px]">
                      {grandes.length}
                    </Badge>
                  </div>
                  {grandes.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-muted-foreground">Nenhum desconto manual.</p>
                  ) : (
                    <div className="divide-y divide-border">{grandes.map(renderRow)}</div>
                  )}
                </div>

                <div className="flex items-start gap-2 px-2 py-1.5 text-[10px] text-muted-foreground">
                  <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                  <span>
                    Aqui aparecem só os descontos aplicados manualmente na comanda. Os descontos automáticos do iFood/Brendi
                    (ex.: "Desconto do Restaurante") NÃO entram, pois são promoções normais dos aplicativos. Quando houver, mostramos o
                    código do cupom ou o motivo digitado pelo atendente.
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
