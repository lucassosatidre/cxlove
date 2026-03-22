/**
 * [ATLAS MUSK] Acerto Inteligente Delivery
 * Driver-centric reconciliation view.
 * The primary unit is the DRIVER, not the individual order.
 */
import { useState, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Users, CheckCircle2, AlertTriangle, Clock, ChevronDown, ChevronUp,
  Download, Link2, Unlink, GripVertical, Truck, CreditCard, Banknote,
  Search, ArrowLeft, FileSpreadsheet, ShieldCheck, MessageSquare,
} from 'lucide-react';
import { formatCurrency } from '@/lib/payment-utils';
import {
  buildDriverSummaries,
  exportMatchesXLSX,
  exportPendingXLSX,
  exportDriverSummaryXLSX,
  type DriverSummary,
} from '@/lib/delivery-export';

interface Order {
  id: string;
  order_number: string;
  payment_method: string;
  total_amount: number;
  delivery_person: string | null;
  sale_time: string | null;
  is_confirmed: boolean;
  sales_channel?: string | null;
  partner_order_number?: string | null;
}

interface CardTransaction {
  id: string;
  sale_time: string | null;
  payment_method: string;
  brand: string | null;
  gross_amount: number;
  net_amount: number;
  machine_serial: string | null;
  transaction_id: string | null;
  matched_order_id: string | null;
  match_type: string | null;
  match_confidence: string | null;
}

interface Breakdown {
  imported_order_id: string;
  payment_method_name: string;
  payment_type: string;
  amount: number;
}

interface AtlasMuskProps {
  closingDate: string;
  orders: Order[];
  transactions: CardTransaction[];
  breakdowns: Breakdown[];
  serialToDeliveryPerson: Map<string, string>;
  onManualMatch: (txId: string, orderId: string) => void;
  onUnmatch: (txId: string) => void;
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'Bateu': return 'bg-success/10 text-success border-success/30';
    case 'Bateu com ressalva': return 'bg-amber-500/10 text-amber-600 border-amber-500/30';
    case 'Divergência por pedido': return 'bg-destructive/10 text-destructive border-destructive/30';
    case 'Divergência por forma': return 'bg-warning/10 text-warning border-warning/30';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'Bateu': return <CheckCircle2 className="h-4 w-4" />;
    case 'Bateu com ressalva': return <AlertTriangle className="h-4 w-4" />;
    default: return <Clock className="h-4 w-4" />;
  }
}

export default function AtlasMuskView({
  closingDate,
  orders,
  transactions,
  breakdowns,
  serialToDeliveryPerson,
  onManualMatch,
  onUnmatch,
}: AtlasMuskProps) {
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);
  const [searchDriver, setSearchDriver] = useState('');
  const [dragTxId, setDragTxId] = useState<string | null>(null);

  const exportParams = useMemo(() => ({
    closingDate,
    orders,
    transactions,
    breakdowns,
    serialToDeliveryPerson,
  }), [closingDate, orders, transactions, breakdowns, serialToDeliveryPerson]);

  const summaries = useMemo(
    () => buildDriverSummaries(exportParams),
    [exportParams]
  );

  const txByOrderId = useMemo(() => {
    const map = new Map<string, CardTransaction[]>();
    transactions.forEach(tx => {
      if (tx.matched_order_id) {
        const arr = map.get(tx.matched_order_id) || [];
        arr.push(tx);
        map.set(tx.matched_order_id, arr);
      }
    });
    return map;
  }, [transactions]);

  const filteredSummaries = useMemo(() => {
    if (!searchDriver) return summaries;
    const q = searchDriver.toLowerCase();
    return summaries.filter(s => s.deliveryPerson.toLowerCase().includes(q));
  }, [summaries, searchDriver]);

  // Global stats
  const globalStats = useMemo(() => {
    const total = summaries.length;
    const ok = summaries.filter(s => s.status === 'Bateu').length;
    const withNote = summaries.filter(s => s.status === 'Bateu com ressalva').length;
    const divergent = summaries.filter(s => s.status.startsWith('Divergência')).length;
    const waiting = total - ok - withNote - divergent;
    const totalExpected = summaries.reduce((s, d) => s + d.totalExpected, 0);
    const totalFound = summaries.reduce((s, d) => s + d.totalFound, 0);
    return { total, ok, withNote, divergent, waiting, totalExpected, totalFound, diff: totalFound - totalExpected };
  }, [summaries]);

  const handleDrop = useCallback((orderId: string) => {
    if (dragTxId) {
      onManualMatch(dragTxId, orderId);
      setDragTxId(null);
    }
  }, [dragTxId, onManualMatch]);

  return (
    <div className="flex flex-col gap-4">
      {/* CAMADA 1 — VISÃO GERAL DO DIA */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <MiniStat icon={<Users className="h-4 w-4" />} label="Entregadores" value={globalStats.total} />
        <MiniStat icon={<CheckCircle2 className="h-4 w-4" />} label="Sem divergência" value={globalStats.ok} color="text-success" />
        <MiniStat icon={<AlertTriangle className="h-4 w-4" />} label="Com ressalva" value={globalStats.withNote} color="text-amber-500" />
        <MiniStat icon={<AlertTriangle className="h-4 w-4" />} label="Com divergência" value={globalStats.divergent} color="text-destructive" />
        <MiniStat icon={<Clock className="h-4 w-4" />} label="Aguardando" value={globalStats.waiting} />
        <MiniStat icon={<Banknote className="h-4 w-4" />} label="Esperado" value={formatCurrency(globalStats.totalExpected)} />
        <MiniStat icon={<CreditCard className="h-4 w-4" />} label="Maquininha" value={formatCurrency(globalStats.totalFound)} />
        <MiniStat
          icon={<Banknote className="h-4 w-4" />}
          label="Diferença"
          value={formatCurrency(globalStats.diff)}
          color={Math.abs(globalStats.diff) < 0.05 ? 'text-success' : 'text-destructive'}
        />
      </div>

      {/* Export buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => exportMatchesXLSX(exportParams)}>
          <Download className="h-4 w-4 mr-1" /> Exportar Matches
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportPendingXLSX(exportParams)}>
          <Download className="h-4 w-4 mr-1" /> Exportar Pendências
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportDriverSummaryXLSX(exportParams)}>
          <Download className="h-4 w-4 mr-1" /> Exportar Resumo Entregadores
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            className="w-48 h-8 text-sm"
            placeholder="Buscar entregador..."
            value={searchDriver}
            onChange={e => setSearchDriver(e.target.value)}
          />
        </div>
      </div>

      {/* CAMADA 2 — LISTA DE ENTREGADORES */}
      <div className="space-y-3">
        {filteredSummaries.map(summary => {
          const isExpanded = expandedDriver === summary.deliveryPerson;
          return (
            <Card key={summary.deliveryPerson} className="overflow-hidden">
              {/* Driver header */}
              <div
                className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedDriver(isExpanded ? null : summary.deliveryPerson)}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center ${getStatusColor(summary.status)}`}>
                    {getStatusIcon(summary.status)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{summary.deliveryPerson}</p>
                    <p className="text-xs text-muted-foreground">{summary.orderCount} pedidos · {summary.matchedCount} conciliados</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs shrink-0">
                  <div className="text-right">
                    <p className="text-muted-foreground">Esperado</p>
                    <p className="font-mono-tabular font-medium text-foreground">{formatCurrency(summary.totalExpected)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Maquininha</p>
                    <p className="font-mono-tabular font-medium text-foreground">{formatCurrency(summary.totalFound)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Diferença</p>
                    <p className={`font-mono-tabular font-medium ${Math.abs(summary.totalDiff) < 0.05 ? 'text-success' : 'text-destructive'}`}>
                      {formatCurrency(summary.totalDiff)}
                    </p>
                  </div>
                  <Badge variant="secondary" className={`text-[10px] ${getStatusColor(summary.status)}`}>
                    {summary.status}
                  </Badge>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {/* CAMADA 3 — DETALHE EXPANDIDO */}
              {isExpanded && (
                <CardContent className="border-t border-border pt-4 space-y-4">
                  {/* BLOCO A — Resumo por Forma */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                      Resumo do Acerto por Forma de Pagamento
                    </h4>
                    <div className="bg-muted rounded-lg border border-border overflow-hidden">
                      <div className="grid grid-cols-4 gap-0 text-xs font-semibold text-muted-foreground px-3 py-2 border-b border-border">
                        <span>Forma</span>
                        <span className="text-right">Esperado</span>
                        <span className="text-right">Conciliado</span>
                        <span className="text-right">Diferença</span>
                      </div>
                      {Array.from(new Set([...summary.expectedByMethod.keys(), ...summary.foundByMethod.keys()])).map(method => {
                        const exp = summary.expectedByMethod.get(method) || 0;
                        const found = summary.foundByMethod.get(method) || 0;
                        const diff = found - exp;
                        const isVoucher = method.toLowerCase().includes('voucher parceiro');
                        const isOnline = method.toLowerCase().includes('online') || method.toLowerCase().includes('(pago)');
                        return (
                          <div key={method} className={`grid grid-cols-4 gap-0 text-xs px-3 py-1.5 border-b border-border/50 last:border-b-0 ${isVoucher ? 'bg-amber-500/5' : isOnline ? 'bg-primary/5' : ''}`}>
                            <span className="text-foreground font-medium flex items-center gap-1">
                              {method}
                              {isVoucher && <Badge variant="secondary" className="text-[8px] bg-amber-500/10 text-amber-600">Parceiro</Badge>}
                              {isOnline && <Badge variant="secondary" className="text-[8px] bg-primary/10 text-primary">Online</Badge>}
                            </span>
                            <span className="text-right font-mono-tabular text-foreground">{formatCurrency(exp)}</span>
                            <span className="text-right font-mono-tabular text-foreground">{formatCurrency(found)}</span>
                            <span className={`text-right font-mono-tabular font-medium ${Math.abs(diff) < 0.05 ? 'text-success' : diff > 0 ? 'text-primary' : 'text-destructive'}`}>
                              {formatCurrency(diff)}
                            </span>
                          </div>
                        );
                      })}
                      <div className="grid grid-cols-4 gap-0 text-xs px-3 py-2 font-semibold bg-card">
                        <span className="text-foreground">TOTAL</span>
                        <span className="text-right font-mono-tabular text-foreground">{formatCurrency(summary.totalExpected)}</span>
                        <span className="text-right font-mono-tabular text-foreground">{formatCurrency(summary.totalFound)}</span>
                        <span className={`text-right font-mono-tabular ${Math.abs(summary.totalDiff) < 0.05 ? 'text-success' : 'text-destructive'}`}>
                          {formatCurrency(summary.totalDiff)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* BLOCO B — Pedidos do Entregador */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Pedidos ({summary.orders.length})
                      </h4>
                      <div className="space-y-1.5 max-h-[400px] overflow-auto">
                        {summary.orders.map(order => {
                          const txs = txByOrderId.get(order.id) || [];
                          const isMatched = txs.length > 0;
                          const bks = breakdowns.filter(b => b.imported_order_id === order.id);
                          const hasVoucher = order.payment_method.toLowerCase().includes('voucher parceiro') ||
                            bks.some(b => b.payment_method_name.toLowerCase().includes('voucher parceiro'));
                          const physicalBks = bks.filter(b => b.payment_type === 'fisico');
                          const onlineBks = bks.filter(b => b.payment_type === 'online');
                          const voucherBks = bks.filter(b => b.payment_method_name.toLowerCase().includes('voucher parceiro'));
                          const cashBks = bks.filter(b => b.payment_method_name.toLowerCase() === 'dinheiro');

                          return (
                            <div
                              key={order.id}
                              className={`bg-card rounded-lg border p-2.5 text-xs ${isMatched ? 'border-success/30 bg-success/5' : 'border-border'}`}
                              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-primary'); }}
                              onDragLeave={e => e.currentTarget.classList.remove('ring-2', 'ring-primary')}
                              onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('ring-2', 'ring-primary'); handleDrop(order.id); }}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className={`h-5 w-5 rounded-full flex items-center justify-center ${isMatched ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'}`}>
                                    {isMatched ? <CheckCircle2 className="h-3 w-3" /> : <span className="text-[9px] font-bold">?</span>}
                                  </div>
                                  <span className="font-medium text-foreground">#{order.order_number}</span>
                                  {order.sale_time && <span className="text-muted-foreground"><Clock className="h-2.5 w-2.5 inline mr-0.5" />{order.sale_time}</span>}
                                </div>
                                <span className="font-mono-tabular font-medium text-foreground">{formatCurrency(order.total_amount)}</span>
                              </div>

                              {/* Payment composition */}
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {physicalBks.length > 0 && physicalBks.map((b, i) => (
                                  <Badge key={i} variant="secondary" className="text-[9px]">{b.payment_method_name}: {formatCurrency(b.amount)}</Badge>
                                ))}
                                {onlineBks.length > 0 && onlineBks.map((b, i) => (
                                  <Badge key={`o${i}`} variant="secondary" className="text-[9px] bg-primary/10 text-primary">{b.payment_method_name}: {formatCurrency(b.amount)}</Badge>
                                ))}
                                {voucherBks.length > 0 && voucherBks.map((b, i) => (
                                  <Badge key={`v${i}`} variant="secondary" className="text-[9px] bg-amber-500/10 text-amber-600">{b.payment_method_name}: {formatCurrency(b.amount)}</Badge>
                                ))}
                                {cashBks.length > 0 && cashBks.map((b, i) => (
                                  <Badge key={`c${i}`} variant="secondary" className="text-[9px] bg-success/10 text-success">Dinheiro: {formatCurrency(b.amount)}</Badge>
                                ))}
                                {bks.length === 0 && (
                                  <Badge variant="secondary" className="text-[9px]">{order.payment_method}</Badge>
                                )}
                              </div>

                              {hasVoucher && (
                                <div className="mt-1.5 text-[10px] text-amber-600 bg-amber-500/5 rounded px-2 py-1 border border-amber-500/20">
                                  ⚠ Pedido com Voucher Parceiro Desconto — valor cheio não deve ser procurado na maquininha
                                </div>
                              )}

                              {/* Matched tx info */}
                              {isMatched && txs.map(tx => (
                                <div key={tx.id} className="mt-1.5 flex items-center justify-between bg-success/5 rounded px-2 py-1 border border-success/20">
                                  <div className="flex items-center gap-1.5 text-[10px]">
                                    <Link2 className="h-3 w-3 text-success" />
                                    <span className="text-muted-foreground">{tx.payment_method} {tx.sale_time ? `(${tx.sale_time})` : ''}</span>
                                    <span className="font-mono-tabular font-medium text-foreground">{formatCurrency(tx.gross_amount)}</span>
                                    {tx.brand && <span className="text-muted-foreground">· {tx.brand}</span>}
                                  </div>
                                  <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px] text-muted-foreground hover:text-destructive" onClick={() => onUnmatch(tx.id)}>
                                    <Unlink className="h-2.5 w-2.5" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* BLOCO C — Transações da Maquininha */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Transações da Maquininha ({summary.matchedTransactions.length + summary.unmatchedTransactions.length})
                      </h4>
                      <div className="space-y-1.5 max-h-[400px] overflow-auto">
                        {/* Matched txs */}
                        {summary.matchedTransactions.map(tx => {
                          const order = orders.find(o => o.id === tx.matched_order_id);
                          return (
                            <div key={tx.id} className="bg-success/5 rounded-lg border border-success/30 p-2 text-xs">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <CheckCircle2 className="h-3 w-3 text-success" />
                                  <span className="font-medium text-foreground">{tx.payment_method}</span>
                                  {tx.sale_time && <span className="text-muted-foreground">{tx.sale_time}</span>}
                                </div>
                                <span className="font-mono-tabular font-medium text-foreground">{formatCurrency(tx.gross_amount)}</span>
                              </div>
                              <div className="mt-0.5 text-[10px] text-muted-foreground flex items-center gap-2">
                                {tx.brand && <span>{tx.brand}</span>}
                                {tx.machine_serial && <span className="font-mono-tabular">{tx.machine_serial.slice(-6)}</span>}
                                {order && <span className="text-success">→ #{order.order_number}</span>}
                              </div>
                            </div>
                          );
                        })}

                        {/* Unmatched txs for this driver */}
                        {summary.unmatchedTransactions.length > 0 && (
                          <div className="pt-2 border-t border-border">
                            <p className="text-[10px] font-semibold text-warning uppercase tracking-wider mb-1">Sem Vínculo</p>
                          </div>
                        )}
                        {summary.unmatchedTransactions.map(tx => (
                          <div
                            key={tx.id}
                            draggable
                            onDragStart={() => setDragTxId(tx.id)}
                            onDragEnd={() => setDragTxId(null)}
                            className={`bg-card rounded-lg border border-border p-2 text-xs cursor-grab active:cursor-grabbing hover:border-primary/50 ${dragTxId === tx.id ? 'opacity-50 border-primary' : ''}`}
                          >
                            <div className="flex items-center gap-2">
                              <GripVertical className="h-3 w-3 text-muted-foreground" />
                              <div className="flex-1">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium text-foreground">{tx.payment_method}</span>
                                  <span className="font-mono-tabular font-medium text-foreground">{formatCurrency(tx.gross_amount)}</span>
                                </div>
                                <div className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                                  {tx.brand && <span>{tx.brand}</span>}
                                  {tx.sale_time && <span>{tx.sale_time}</span>}
                                  {tx.machine_serial && <span className="font-mono-tabular">{tx.machine_serial.slice(-6)}</span>}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}

                        {summary.matchedTransactions.length + summary.unmatchedTransactions.length === 0 && (
                          <div className="text-center py-4 text-xs text-muted-foreground">
                            Nenhuma transação associada a este entregador.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* CAMADA 4 — Fechamento do entregador */}
                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={`${getStatusColor(summary.status)}`}>
                        {getStatusIcon(summary.status)}
                        <span className="ml-1">{summary.status}</span>
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {summary.matchedCount}/{summary.orderCount} conciliados · Auto: {summary.autoMatchCount} · Manual: {summary.manualMatchCount}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {summary.pendingCount === 0 && Math.abs(summary.totalDiff) < 1 ? (
                        <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground">
                          <ShieldCheck className="h-4 w-4 mr-1" />
                          Fechar Entregador
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline">
                          <MessageSquare className="h-4 w-4 mr-1" />
                          Fechar com Ressalva
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}

        {filteredSummaries.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Nenhum entregador encontrado.
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-muted rounded-xl p-2.5 border border-border">
      <div className="flex items-center gap-1 mb-0.5">
        <span className={color || 'text-muted-foreground'}>{icon}</span>
        <p className="text-[10px] text-muted-foreground truncate">{label}</p>
      </div>
      <p className={`text-lg font-semibold font-mono-tabular ${color || 'text-foreground'}`}>{value}</p>
    </div>
  );
}
