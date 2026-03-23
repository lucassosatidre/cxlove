/**
 * Export utilities for delivery reconciliation data.
 * Generates XLSX exports for matches, pending orders, driver summaries, and full day base.
 */
import * as XLSX from 'xlsx';
import { formatCurrency } from './payment-utils';
import { decomposeOrder, type OrderDecomposition } from './delivery-decomposition';

interface ExportOrder {
  id: string;
  order_number: string;
  payment_method: string;
  total_amount: number;
  delivery_person: string | null;
  sale_time: string | null;
  sales_channel?: string | null;
  partner_order_number?: string | null;
}

interface ExportTransaction {
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

interface ExportBreakdown {
  imported_order_id: string;
  payment_method_name: string;
  payment_type: string;
  amount: number;
}

interface ExportParams {
  closingDate: string;
  orders: ExportOrder[];
  transactions: ExportTransaction[];
  breakdowns: ExportBreakdown[];
  serialToDeliveryPerson: Map<string, string>;
}

function getMatchLabel(matchType: string | null, confidence: string | null): string {
  switch (matchType) {
    case 'manual': return 'Manual';
    case 'combined': return 'Match combinado';
    case 'combined_undeclared': return 'Match combinado não declarado';
    case 'exact_method_divergence': return 'Match exato · método divergente';
    case 'exact_structure_divergence': return 'Match exato · estrutura divergente';
    case 'exact': return 'Match exato';
    case 'approximate': return 'Match aproximado';
    default: return confidence === 'high' ? 'Match exato' : confidence === 'medium' ? 'Match aproximado' : 'Sem vínculo';
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function getTxsForOrder(orderId: string, transactions: ExportTransaction[]): ExportTransaction[] {
  return transactions.filter(tx => tx.matched_order_id === orderId);
}

function buildOrderRow(order: ExportOrder, decomp: OrderDecomposition, txs: ExportTransaction[], closingDate: string) {
  const isMatched = txs.length > 0;
  const tx = txs[0];
  const sumGross = txs.reduce((s, t) => s + t.gross_amount, 0);
  const sumNet = txs.reduce((s, t) => s + t.net_amount, 0);

  return {
    'Data': closingDate,
    'Entregador': order.delivery_person || '',
    'Nº Pedido': order.order_number,
    'Canal': order.sales_channel || '',
    'Pedido Parceiro': order.partner_order_number || '',
    'Hora Pedido': order.sale_time || '',
    'Forma Saipos': order.payment_method,
    'Valor Total': order.total_amount,
    'Valor Online': decomp.onlineAmount,
    'Dinheiro': decomp.cashAmount,
    'Voucher Parceiro': decomp.voucherPartnerAmount,
    'Esperado Maquininha': decomp.machineExpected,
    'Categoria': decomp.category,
    'Status': isMatched ? 'Conciliado' : (decomp.isStructural ? 'Estrutural' : decomp.isFullyOnline ? 'Online' : decomp.isFullyCash ? 'Dinheiro' : 'Pendente'),
    'Tipo Vínculo': tx ? getMatchLabel(tx.match_type, tx.match_confidence) : '',
    'Qtd Transações': txs.length,
    'Hora Transação': txs.length === 1 ? (tx?.sale_time || '') : txs.map(t => t.sale_time || '').join(', '),
    'Método Transação': txs.length === 1 ? (tx?.payment_method || '') : txs.map(t => t.payment_method).join(', '),
    'Bandeira': txs.length === 1 ? (tx?.brand || '') : txs.map(t => t.brand || '').join(', '),
    'Valor Bruto Conciliado': isMatched ? sumGross : '',
    'Valor Líquido Conciliado': isMatched ? sumNet : '',
    'Serial Máquina': txs.length === 1 ? (tx?.machine_serial || '') : [...new Set(txs.map(t => t.machine_serial).filter(Boolean))].join(', '),
    'IDs Transação': txs.map(t => t.transaction_id || '').filter(Boolean).join(', '),
    'Divergência Método': tx?.match_type === 'exact_method_divergence' ? 'Sim' : '',
    'Divergência Estrutura': tx?.match_type === 'exact_structure_divergence' ? 'Sim' : '',
  };
}

// ═══════════════════════════════════════════════════════════
// Export 1: Matches only
// ═══════════════════════════════════════════════════════════
export function exportMatchesXLSX(params: ExportParams) {
  const { closingDate, orders, transactions, breakdowns } = params;
  const matchedOrders = orders.filter(o => transactions.some(tx => tx.matched_order_id === o.id));

  const rows = matchedOrders.map(order => {
    const decomp = decomposeOrder(order, breakdowns);
    const txs = getTxsForOrder(order.id, transactions);
    return buildOrderRow(order, decomp, txs, closingDate);
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Matches');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([buf]), `matches_delivery_${closingDate}.xlsx`);
}

// ═══════════════════════════════════════════════════════════
// Export 2: Pending only
// ═══════════════════════════════════════════════════════════
export function exportPendingXLSX(params: ExportParams) {
  const { closingDate, orders, transactions, breakdowns } = params;
  const matchedOrderIds = new Set(transactions.filter(tx => tx.matched_order_id).map(tx => tx.matched_order_id!));

  const pendingRows = orders.filter(o => !matchedOrderIds.has(o.id)).map(order => {
    const decomp = decomposeOrder(order, breakdowns);
    return {
      'Data': closingDate,
      'Entregador': order.delivery_person || '',
      'Nº Pedido': order.order_number,
      'Hora Pedido': order.sale_time || '',
      'Forma Saipos': order.payment_method,
      'Valor Total': order.total_amount,
      'Valor Online': decomp.onlineAmount,
      'Dinheiro': decomp.cashAmount,
      'Voucher Parceiro': decomp.voucherPartnerAmount,
      'Esperado Maquininha': decomp.machineExpected,
      'Categoria': decomp.category,
      'Tipo Pendência': decomp.isStructural ? 'Estrutural' : decomp.isFullyOnline ? 'Online (fora da maquininha)' : decomp.isFullyCash ? 'Dinheiro (fora da maquininha)' : 'Real',
    };
  });

  const unmatchedTxRows = transactions.filter(tx => !tx.matched_order_id).map(tx => ({
    'Data': closingDate,
    'Hora': tx.sale_time || '',
    'Método': tx.payment_method,
    'Bandeira': tx.brand || '',
    'Valor Bruto': tx.gross_amount,
    'Valor Líquido': tx.net_amount,
    'Serial': tx.machine_serial || '',
    'ID Transação': tx.transaction_id || '',
  }));

  const wb = XLSX.utils.book_new();
  if (pendingRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendingRows), 'Pedidos Pendentes');
  if (unmatchedTxRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(unmatchedTxRows), 'Transações Sem Vínculo');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([buf]), `pendencias_delivery_${closingDate}.xlsx`);
}

// ═══════════════════════════════════════════════════════════
// Export 3: Full day base (all orders with decomposition)
// ═══════════════════════════════════════════════════════════
export function exportDayBaseXLSX(params: ExportParams) {
  const { closingDate, orders, transactions, breakdowns } = params;

  const rows = orders.map(order => {
    const decomp = decomposeOrder(order, breakdowns);
    const txs = getTxsForOrder(order.id, transactions);
    return buildOrderRow(order, decomp, txs, closingDate);
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Base Completa');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([buf]), `base_completa_delivery_${closingDate}.xlsx`);
}

// ═══════════════════════════════════════════════════════════
// Driver Summary types and builder
// ═══════════════════════════════════════════════════════════
export interface DriverSummary {
  deliveryPerson: string;
  orderCount: number;
  totalOrders: number;
  // Decomposed totals
  totalAmount: number;
  totalOnline: number;
  totalCash: number;
  totalMachineExpected: number;
  totalVoucherPartner: number;
  totalStructural: number;
  totalMachineFound: number;
  machineDiff: number;
  // Per-method breakdown (machine only)
  expectedByMethod: Map<string, number>;
  foundByMethod: Map<string, number>;
  diffByMethod: Map<string, number>;
  // Counts
  matchedCount: number;
  pendingCount: number;
  onlineCount: number;
  cashCount: number;
  structuralCount: number;
  machineOrderCount: number;
  autoMatchCount: number;
  manualMatchCount: number;
  status: string;
  orders: ExportOrder[];
  orderDecompositions: Map<string, OrderDecomposition>;
  matchedTransactions: ExportTransaction[];
  unmatchedTransactions: ExportTransaction[];
}

export function buildDriverSummaries(params: ExportParams): DriverSummary[] {
  const { orders, transactions, breakdowns, serialToDeliveryPerson } = params;

  const txByOrderId = new Map<string, ExportTransaction[]>();
  transactions.forEach(tx => {
    if (tx.matched_order_id) {
      const arr = txByOrderId.get(tx.matched_order_id) || [];
      arr.push(tx);
      txByOrderId.set(tx.matched_order_id, arr);
    }
  });

  // Reverse map: delivery person → serials
  const personSerials = new Map<string, Set<string>>();
  for (const [serial, person] of serialToDeliveryPerson) {
    if (!personSerials.has(person)) personSerials.set(person, new Set());
    personSerials.get(person)!.add(serial);
  }

  const driverOrders = new Map<string, ExportOrder[]>();
  orders.forEach(o => {
    const dp = o.delivery_person || 'Sem entregador';
    if (!driverOrders.has(dp)) driverOrders.set(dp, []);
    driverOrders.get(dp)!.push(o);
  });

  const summaries: DriverSummary[] = [];

  for (const [dp, dpOrders] of driverOrders) {
    let totalAmount = 0, totalOnline = 0, totalCash = 0, totalMachineExpected = 0, totalVoucherPartner = 0, totalStructural = 0;
    let matchedCount = 0, onlineCount = 0, cashCount = 0, structuralCount = 0, machineOrderCount = 0;
    let autoCount = 0, manualCount = 0;

    const expectedByMethod = new Map<string, number>();
    const foundByMethod = new Map<string, number>();
    const orderDecomps = new Map<string, OrderDecomposition>();

    for (const order of dpOrders) {
      const decomp = decomposeOrder(order, breakdowns);
      orderDecomps.set(order.id, decomp);

      totalAmount += order.total_amount;
      totalOnline += decomp.onlineAmount;
      totalCash += decomp.cashAmount;
      totalVoucherPartner += decomp.voucherPartnerAmount;

      if (decomp.isStructural) {
        structuralCount++;
        totalStructural += order.total_amount;
      } else if (decomp.isFullyOnline) {
        onlineCount++;
      } else if (decomp.isFullyCash) {
        cashCount++;
      } else {
        machineOrderCount++;
        totalMachineExpected += decomp.machineExpected;
        // Add to per-method expected (only machine methods)
        const bks = breakdowns.filter(b => b.imported_order_id === order.id);
        if (bks.length > 0) {
          bks.forEach(b => {
            const lower = b.payment_method_name.toLowerCase();
            if (lower !== 'dinheiro' && !lower.includes('online') && !lower.includes('(pago)') && !lower.includes('voucher parceiro') && !lower.includes('anotaai')) {
              expectedByMethod.set(b.payment_method_name, (expectedByMethod.get(b.payment_method_name) || 0) + b.amount);
            }
          });
        } else {
          const methods = order.payment_method.split(',').map(m => m.trim()).filter(m => {
            const l = m.toLowerCase();
            return l !== 'dinheiro' && !l.includes('online') && !l.includes('(pago)') && !l.includes('voucher parceiro') && !l.includes('anotaai');
          });
          if (methods.length > 0) {
            const share = decomp.machineExpected / methods.length;
            methods.forEach(m => expectedByMethod.set(m, (expectedByMethod.get(m) || 0) + share));
          }
        }
      }

      const txs = txByOrderId.get(order.id);
      if (txs && txs.length > 0) {
        matchedCount++;
        if (txs[0].match_type === 'manual') manualCount++;
        else autoCount++;
        txs.forEach(tx => {
          foundByMethod.set(tx.payment_method, (foundByMethod.get(tx.payment_method) || 0) + tx.gross_amount);
        });
      }
    }

    const totalMachineFound = Array.from(foundByMethod.values()).reduce((s, v) => s + v, 0);
    const machineDiff = totalMachineFound - totalMachineExpected;

    const allMethods = new Set([...expectedByMethod.keys(), ...foundByMethod.keys()]);
    const diffByMethod = new Map<string, number>();
    allMethods.forEach(m => diffByMethod.set(m, (foundByMethod.get(m) || 0) - (expectedByMethod.get(m) || 0)));

    const pendingMachine = dpOrders.filter(o => {
      const d = orderDecomps.get(o.id)!;
      return !d.isFullyOnline && !d.isFullyCash && !d.isStructural && !txByOrderId.has(o.id);
    }).length;

    let status = 'Aguardando conferência';
    if (machineOrderCount === 0) status = 'Sem maquininha';
    else if (pendingMachine === 0 && Math.abs(machineDiff) < 0.05) status = 'Bateu';
    else if (pendingMachine === 0 && Math.abs(machineDiff) < 1) status = 'Bateu com ressalva';
    else if (pendingMachine > 0) status = 'Divergência por pedido';

    const driverSerials = personSerials.get(dp) || new Set();
    const driverUnmatchedTxs = transactions.filter(tx =>
      !tx.matched_order_id && tx.machine_serial && driverSerials.has(tx.machine_serial)
    );
    const driverMatchedTxs = dpOrders.flatMap(o => txByOrderId.get(o.id) || []);

    summaries.push({
      deliveryPerson: dp,
      orderCount: dpOrders.length,
      totalOrders: dpOrders.length,
      totalAmount,
      totalOnline,
      totalCash,
      totalMachineExpected,
      totalVoucherPartner,
      totalStructural,
      totalMachineFound: totalMachineFound,
      machineDiff,
      expectedByMethod,
      foundByMethod,
      diffByMethod,
      matchedCount,
      pendingCount: pendingMachine,
      onlineCount,
      cashCount,
      structuralCount,
      machineOrderCount,
      autoMatchCount: autoCount,
      manualMatchCount: manualCount,
      status,
      orders: dpOrders,
      orderDecompositions: orderDecomps,
      matchedTransactions: driverMatchedTxs,
      unmatchedTransactions: driverUnmatchedTxs,
    });
  }

  return summaries.sort((a, b) => b.orderCount - a.orderCount);
}

// ═══════════════════════════════════════════════════════════
// Export 4: Driver summary
// ═══════════════════════════════════════════════════════════
export function exportDriverSummaryXLSX(params: ExportParams) {
  const summaries = buildDriverSummaries(params);
  const { closingDate } = params;

  const rows = summaries.map(s => ({
    'Data': closingDate,
    'Entregador': s.deliveryPerson,
    'Qtd Pedidos': s.orderCount,
    'Pedidos Online': s.onlineCount,
    'Pedidos Dinheiro': s.cashCount,
    'Pedidos Maquininha': s.machineOrderCount,
    'Pedidos Estruturais': s.structuralCount,
    'Total Econômico': s.totalAmount,
    'Total Online': s.totalOnline,
    'Total Dinheiro': s.totalCash,
    'Total Voucher Parceiro': s.totalVoucherPartner,
    'Esperado Maquininha': s.totalMachineExpected,
    'Encontrado Maquininha': s.totalMachineFound,
    'Diferença Maquininha': s.machineDiff,
    'Status': s.status,
    'Conciliados': s.matchedCount,
    'Pendentes Maquininha': s.pendingCount,
    'Matches Auto': s.autoMatchCount,
    'Matches Manual': s.manualMatchCount,
    ...Object.fromEntries(Array.from(s.expectedByMethod.entries()).map(([m, v]) => [`Esperado ${m}`, v])),
    ...Object.fromEntries(Array.from(s.foundByMethod.entries()).map(([m, v]) => [`Encontrado ${m}`, v])),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Resumo Entregadores');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([buf]), `resumo_entregadores_${closingDate}.xlsx`);
}
