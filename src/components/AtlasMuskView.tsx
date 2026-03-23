/**
 * [ATLAS MUSK] Acerto Inteligente Delivery
 * Driver-centric reconciliation view with proper payment decomposition.
 */
import { useState, useMemo, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Users, CheckCircle2, AlertTriangle, Clock, ChevronDown, ChevronUp,
  Download, Link2, Unlink, GripVertical, CreditCard, Banknote,
  Search, ShieldCheck, MessageSquare, Wifi, Landmark, Tag,
} from 'lucide-react';
import { formatCurrency } from '@/lib/payment-utils';
import {
  buildDriverSummaries,
  exportMatchesXLSX,
  exportPendingXLSX,
  exportDriverSummaryXLSX,
  exportDayBaseXLSX,
  type DriverSummary,
} from '@/lib/delivery-export';
import { getCategoryLabel } from '@/lib/delivery-decomposition';

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
    case 'Sem maquininha': return 'bg-primary/10 text-primary border-primary/30';
    case 'Divergência por pedido': return 'bg-destructive/10 text-destructive border-destructive/30';
    default: return 'bg-muted text-muted-foreground border-border';
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'Bateu': return <CheckCircle2 className="h-4 w-4" />;
    case 'Bateu com ressalva': return <AlertTriangle className="h-4 w-4" />;
    case 'Sem maquininha': return <Wifi className="h-4 w-4" />;
    default: return <Clock className="h-4 w-4" />;
  }
}

function getCatBadge(cat: string) {
  switch (cat) {
    case 'online': return <Badge variant="secondary" className="text-[9px] bg-primary/10 text-primary">Online</Badge>;
    case 'cash': return <Badge variant="secondary" className="text-[9px] bg-success/10 text-success">Dinheiro</Badge>;
    case 'structural': return <Badge variant="secondary" className="text-[9px] bg-amber-500/10 text-amber-600">Estrutural</Badge>;
    case 'mixed': return <Badge variant="secondary" className="text-[9px] bg-orange-500/10 text-orange-600">Misto</Badge>;
    default: return <Badge variant="secondary" className="text-[9px]">Maquininha</Badge>;
  }
}

export default function AtlasMuskView({
  closingDate, orders, transactions, breakdowns, serialToDeliveryPerson, onManualMatch, onUnmatch,
}: AtlasMuskProps) {
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);
  const [searchDriver, setSearchDriver] = useState('');
  const [dragTxId, setDragTxId] = useState<string | null>(null);

  const exportParams = useMemo(() => ({
    closingDate, orders, transactions, breakdowns, serialToDeliveryPerson,
  }), [closingDate, orders, transactions, breakdowns, serialToDeliveryPerson]);

  const summaries = useMemo(() => buildDriverSummaries(exportParams), [exportParams]);

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

  // Global stats — decomposed
  const gs = useMemo(() => {
    const total = summaries.length;
    const ok = summaries.filter(s => s.status === 'Bateu').length;
    const withNote = summaries.filter(s => s.status === 'Bateu com ressalva').length;
    const divergent = summaries.filter(s => s.status.startsWith('Divergência')).length;
    const totalAmount = summaries.reduce((s, d) => s + d.totalAmount, 0);
    const totalOnline = summaries.reduce((s, d) => s + d.totalOnline, 0);
    const totalCash = summaries.reduce((s, d) => s + d.totalCash, 0);
    const totalMachineExp = summaries.reduce((s, d) => s + d.totalMachineExpected, 0);
    const totalVoucher = summaries.reduce((s, d) => s + d.totalVoucherPartner, 0);
    const totalStructural = summaries.reduce((s, d) => s + d.totalStructural, 0);
    const totalMachineFound = summaries.reduce((s, d) => s + d.totalMachineFound, 0);
    const machineDiff = totalMachineFound - totalMachineExp;
    return { total, ok, withNote, divergent, totalAmount, totalOnline, totalCash, totalMachineExp, totalVoucher, totalStructural, totalMachineFound, machineDiff };
  }, [summaries]);

  const handleDrop = useCallback((orderId: string) => {
    if (dragTxId) { onManualMatch(dragTxId, orderId); setDragTxId(null); }
  }, [dragTxId, onManualMatch]);

  return (
    <div className="flex flex-col gap-4">
      {/* CAMADA 1 — VISÃO GERAL DO DIA (DECOMPOSED) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <MiniStat icon={<Banknote className="h-4 w-4" />} label="Total do Dia" value={formatCurrency(gs.totalAmount)} />
        <MiniStat icon={<Wifi className="h-4 w-4" />} label="Online / Automático" value={formatCurrency(gs.totalOnline)} color="text-primary" />
        <MiniStat icon={<Banknote className="h-4 w-4" />} label="Dinheiro" value={formatCurrency(gs.totalCash)} color="text-success" />
        <MiniStat icon={<CreditCard className="h-4 w-4" />} label="Esperado Maquininha" value={formatCurrency(gs.totalMachineExp)} />
        <MiniStat icon={<CreditCard className="h-4 w-4" />} label="Conciliado Maquininha" value={formatCurrency(gs.totalMachineFound)} color={Math.abs(gs.machineDiff) < 0.05 ? 'text-success' : undefined} />
        <MiniStat
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Diferença Conciliável"
          value={formatCurrency(gs.machineDiff)}
          color={Math.abs(gs.machineDiff) < 0.05 ? 'text-success' : 'text-destructive'}
        />
      </div>
      {(gs.totalVoucher > 0 || gs.totalStructural > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <MiniStat icon={<Tag className="h-4 w-4" />} label="Voucher Parceiro" value={formatCurrency(gs.totalVoucher)} color="text-amber-500" />
          <MiniStat icon={<Landmark className="h-4 w-4" />} label="Estrutural Pendente" value={formatCurrency(gs.totalStructural)} color="text-amber-600" />
          <MiniStat icon={<Users className="h-4 w-4" />} label={`${gs.ok}/${gs.total} entregadores OK`} value={`${gs.divergent} divergências`} color={gs.divergent > 0 ? 'text-destructive' : 'text-success'} />
        </div>
      )}

      {/* Export buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => exportMatchesXLSX(exportParams)}>
          <Download className="h-4 w-4 mr-1" /> Matches
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportPendingXLSX(exportParams)}>
          <Download className="h-4 w-4 mr-1" /> Pendências
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportDriverSummaryXLSX(exportParams)}>
          <Download className="h-4 w-4 mr-1" /> Resumo Entregadores
        </Button>
        <Button variant="outline" size="sm" onClick={() => exportDayBaseXLSX(exportParams)}>
          <Download className="h-4 w-4 mr-1" /> Base do Dia
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input className="w-48 h-8 text-sm" placeholder="Buscar entregador..." value={searchDriver} onChange={e => setSearchDriver(e.target.value)} />
        </div>
      </div>

      {/* CAMADA 2 — LISTA DE ENTREGADORES */}
      <div className="space-y-3">
        {filteredSummaries.map(summary => {
          const isExpanded = expandedDriver === summary.deliveryPerson;
          return (
            <Card key={summary.deliveryPerson} className="overflow-hidden">
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
                    <p className="text-xs text-muted-foreground">
                      {summary.orderCount} ped · {summary.machineOrderCount} maq · {summary.onlineCount} online · {summary.cashCount} din
                      {summary.structuralCount > 0 && ` · ${summary.structuralCount} estrut`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs shrink-0">
                  <div className="text-right">
                    <p className="text-muted-foreground">Esperado Maq.</p>
                    <p className="font-mono-tabular font-medium text-foreground">{formatCurrency(summary.totalMachineExpected)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Conciliado</p>
                    <p className="font-mono-tabular font-medium text-foreground">{formatCurrency(summary.totalMachineFound)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-muted-foreground">Diferença</p>
                    <p className={`font-mono-tabular font-medium ${Math.abs(summary.machineDiff) < 0.05 ? 'text-success' : 'text-destructive'}`}>
                      {formatCurrency(summary.machineDiff)}
                    </p>
                  </div>
                  <Badge variant="secondary" className={`text-[10px] ${getStatusColor(summary.status)}`}>
                    {summary.status}
                  </Badge>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>

              {isExpanded && (
                <CardContent className="border-t border-border pt-4 space-y-4">
                  {/* Driver totals overview */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div className="bg-muted rounded-lg p-2 border border-border text-center">
                      <p className="text-[10px] text-muted-foreground">Total Econômico</p>
                      <p className="text-sm font-semibold font-mono-tabular text-foreground">{formatCurrency(summary.totalAmount)}</p>
                    </div>
                    <div className="bg-primary/5 rounded-lg p-2 border border-primary/20 text-center">
                      <p className="text-[10px] text-primary">Online</p>
                      <p className="text-sm font-semibold font-mono-tabular text-primary">{formatCurrency(summary.totalOnline)}</p>
                    </div>
                    <div className="bg-success/5 rounded-lg p-2 border border-success/20 text-center">
                      <p className="text-[10px] text-success">Dinheiro</p>
                      <p className="text-sm font-semibold font-mono-tabular text-success">{formatCurrency(summary.totalCash)}</p>
                    </div>
                    <div className="bg-muted rounded-lg p-2 border border-border text-center">
                      <p className="text-[10px] text-muted-foreground">Esperado Maq.</p>
                      <p className="text-sm font-semibold font-mono-tabular text-foreground">{formatCurrency(summary.totalMachineExpected)}</p>
                    </div>
                    {summary.totalVoucherPartner > 0 && (
                      <div className="bg-amber-500/5 rounded-lg p-2 border border-amber-500/20 text-center">
                        <p className="text-[10px] text-amber-600">Voucher Parceiro</p>
                        <p className="text-sm font-semibold font-mono-tabular text-amber-600">{formatCurrency(summary.totalVoucherPartner)}</p>
                      </div>
                    )}
                  </div>

                  {/* BLOCO A — Resumo por Forma (machine methods only) */}
                  {(summary.expectedByMethod.size > 0 || summary.foundByMethod.size > 0) && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                        Acerto por Forma de Pagamento (Maquininha)
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
                          return (
                            <div key={method} className="grid grid-cols-4 gap-0 text-xs px-3 py-1.5 border-b border-border/50 last:border-b-0">
                              <span className="text-foreground font-medium">{method}</span>
                              <span className="text-right font-mono-tabular text-foreground">{formatCurrency(exp)}</span>
                              <span className="text-right font-mono-tabular text-foreground">{formatCurrency(found)}</span>
                              <span className={`text-right font-mono-tabular font-medium ${Math.abs(diff) < 0.05 ? 'text-success' : 'text-destructive'}`}>
                                {formatCurrency(diff)}
                              </span>
                            </div>
                          );
                        })}
                        <div className="grid grid-cols-4 gap-0 text-xs px-3 py-2 font-semibold bg-card">
                          <span className="text-foreground">TOTAL MAQUININHA</span>
                          <span className="text-right font-mono-tabular text-foreground">{formatCurrency(summary.totalMachineExpected)}</span>
                          <span className="text-right font-mono-tabular text-foreground">{formatCurrency(summary.totalMachineFound)}</span>
                          <span className={`text-right font-mono-tabular ${Math.abs(summary.machineDiff) < 0.05 ? 'text-success' : 'text-destructive'}`}>
                            {formatCurrency(summary.machineDiff)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

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
                          const decomp = summary.orderDecompositions.get(order.id);
                          const cat = decomp?.category || 'machine';

                          return (
                            <div
                              key={order.id}
                              className={`bg-card rounded-lg border p-2.5 text-xs ${isMatched ? 'border-success/30 bg-success/5' : cat === 'online' ? 'border-primary/30 bg-primary/5' : cat === 'cash' ? 'border-success/30 bg-success/5' : cat === 'structural' ? 'border-amber-500/30 bg-amber-500/5' : 'border-border'}`}
                              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-primary'); }}
                              onDragLeave={e => e.currentTarget.classList.remove('ring-2', 'ring-primary')}
                              onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('ring-2', 'ring-primary'); handleDrop(order.id); }}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className={`h-5 w-5 rounded-full flex items-center justify-center ${isMatched ? 'bg-success text-success-foreground' : cat === 'online' ? 'bg-primary text-primary-foreground' : cat === 'cash' ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'}`}>
                                    {isMatched ? <CheckCircle2 className="h-3 w-3" /> : cat === 'online' ? <Wifi className="h-3 w-3" /> : cat === 'cash' ? <Banknote className="h-3 w-3" /> : <span className="text-[9px] font-bold">?</span>}
                                  </div>
                                  <span className="font-medium text-foreground">#{order.order_number}</span>
                                  {order.sale_time && <span className="text-muted-foreground text-[10px]">{order.sale_time}</span>}
                                  {getCatBadge(cat)}
                                </div>
                                <span className="font-mono-tabular font-medium text-foreground">{formatCurrency(order.total_amount)}</span>
                              </div>

                              {/* Decomposition details */}
                              {decomp && (cat === 'mixed' || cat === 'structural') && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {decomp.machineExpected > 0 && <Badge variant="secondary" className="text-[9px]">Maq: {formatCurrency(decomp.machineExpected)}</Badge>}
                                  {decomp.onlineAmount > 0 && <Badge variant="secondary" className="text-[9px] bg-primary/10 text-primary">Online: {formatCurrency(decomp.onlineAmount)}</Badge>}
                                  {decomp.cashAmount > 0 && <Badge variant="secondary" className="text-[9px] bg-success/10 text-success">Din: {formatCurrency(decomp.cashAmount)}</Badge>}
                                  {decomp.voucherPartnerAmount > 0 && <Badge variant="secondary" className="text-[9px] bg-amber-500/10 text-amber-600">VP: {formatCurrency(decomp.voucherPartnerAmount)}</Badge>}
                                </div>
                              )}

                              {cat === 'structural' && (
                                <div className="mt-1.5 text-[10px] text-amber-600 bg-amber-500/5 rounded px-2 py-1 border border-amber-500/20">
                                  ⚠ Voucher Parceiro Desconto — valor físico conciliável não definido
                                </div>
                              )}

                              {cat === 'online' && (
                                <div className="mt-1 text-[10px] text-primary">Pagamento online — não passa pela maquininha</div>
                              )}

                              {cat === 'cash' && (
                                <div className="mt-1 text-[10px] text-success">Dinheiro — repasse em espécie, não na maquininha</div>
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
                        Transações ({summary.matchedTransactions.length + summary.unmatchedTransactions.length})
                      </h4>
                      <div className="space-y-1.5 max-h-[400px] overflow-auto">
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
                            Nenhuma transação associada.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* CAMADA 4 — Fechamento */}
                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={getStatusColor(summary.status)}>
                        {getStatusIcon(summary.status)}
                        <span className="ml-1">{summary.status}</span>
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {summary.matchedCount} conciliados · {summary.pendingCount} pend. maq · Auto: {summary.autoMatchCount}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {summary.pendingCount === 0 && Math.abs(summary.machineDiff) < 1 ? (
                        <Button size="sm" className="bg-success hover:bg-success/90 text-success-foreground">
                          <ShieldCheck className="h-4 w-4 mr-1" /> Fechar Entregador
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline">
                          <MessageSquare className="h-4 w-4 mr-1" /> Fechar com Ressalva
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
