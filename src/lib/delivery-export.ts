/**
 * Export utilities for delivery reconciliation data.
 * Generates XLSX and CSV exports for matches, pending orders, and driver summaries.
 */
import * as XLSX from 'xlsx';
import { formatCurrency } from './payment-utils';

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

function getPhysicalAmount(order: ExportOrder, breakdowns: ExportBreakdown[]): number {
  const bks = breakdowns.filter(b => b.imported_order_id === order.id && b.payment_type === 'fisico');
  if (bks.length > 0) return bks.reduce((s, b) => s + b.amount, 0);
  return order.total_amount;
}

function getOnlineAmount(order: ExportOrder, breakdowns: ExportBreakdown[]): number {
  return breakdowns.filter(b => b.imported_order_id === order.id && b.payment_type === 'online')
    .reduce((s, b) => s + b.amount, 0);
}

function getVoucherAmount(order: ExportOrder, breakdowns: ExportBreakdown[]): number {
  return breakdowns.filter(b => b.imported_order_id === order.id &&
    b.payment_method_name.toLowerCase().includes('voucher parceiro'))
    .reduce((s, b) => s + b.amount, 0);
}

function getCashAmount(order: ExportOrder, breakdowns: ExportBreakdown[]): number {
  return breakdowns.filter(b => b.imported_order_id === order.id &&
    b.payment_method_name.toLowerCase() === 'dinheiro')
    .reduce((s, b) => s + b.amount, 0);
}

function getMachineExpectedAmount(order: ExportOrder, breakdowns: ExportBreakdown[]): number {
  const bks = breakdowns.filter(b => b.imported_order_id === order.id && b.payment_type === 'fisico');
  if (bks.length > 0) {
    return bks.filter(b => {
      const m = b.payment_method_name.toLowerCase();
      return m !== 'dinheiro';
    }).reduce((s, b) => s + b.amount, 0);
  }
  const methods = order.payment_method.split(',').map(m => m.trim().toLowerCase());
  const hasCash = methods.includes('dinheiro');
  if (hasCash) return order.total_amount * 0.75; // rough estimate
  return order.total_amount;
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

export function exportMatchesXLSX(params: ExportParams) {
  const { closingDate, orders, transactions, breakdowns, serialToDeliveryPerson } = params;
  const txByOrderId = new Map<string, ExportTransaction[]>();
  transactions.forEach(tx => {
    if (tx.matched_order_id) {
      const arr = txByOrderId.get(tx.matched_order_id) || [];
      arr.push(tx);
      txByOrderId.set(tx.matched_order_id, arr);
    }
  });

  const rows = orders.map(order => {
    const txs = txByOrderId.get(order.id) || [];
    const tx = txs[0];
    const isMatched = txs.length > 0;
    const physicalAmt = getPhysicalAmount(order, breakdowns);
    const onlineAmt = getOnlineAmount(order, breakdowns);
    const voucherAmt = getVoucherAmount(order, breakdowns);
    const cashAmt = getCashAmount(order, breakdowns);
    const machineExpected = getMachineExpectedAmount(order, breakdowns);
    const hasMethodDiv = tx?.match_type === 'exact_method_divergence';
    const hasStructDiv = tx?.match_type === 'exact_structure_divergence';

    return {
      'Data': closingDate,
      'Entregador': order.delivery_person || '',
      'Nº Pedido': order.order_number,
      'Canal': (order as any).sales_channel || '',
      'Pedido Parceiro': (order as any).partner_order_number || '',
      'Hora Pedido': order.sale_time || '',
      'Forma Saipos': order.payment_method,
      'Valor Total': order.total_amount,
      'Valor Físico': physicalAmt,
      'Valor Online': onlineAmt,
      'Voucher Parceiro': voucherAmt,
      'Dinheiro': cashAmt,
      'Esperado Maquininha': machineExpected,
      'Status': isMatched ? 'Conciliado' : 'Pendente',
      'Tipo Vínculo': tx ? getMatchLabel(tx.match_type, tx.match_confidence) : '',
      'Hora Transação': tx?.sale_time || '',
      'Método Transação': tx?.payment_method || '',
      'Bandeira': tx?.brand || '',
      'Valor Bruto': tx?.gross_amount || '',
      'Valor Líquido': tx?.net_amount || '',
      'Serial Máquina': tx?.machine_serial || '',
      'ID Transação': tx?.transaction_id || '',
      'Divergência Método': hasMethodDiv ? 'Sim' : '',
      'Divergência Estrutura': hasStructDiv ? 'Sim' : '',
      'Txs Combinadas': txs.length > 1 ? txs.map(t => `${t.payment_method} ${t.gross_amount}`).join(' + ') : '',
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Matches');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([buf]), `matches_delivery_${closingDate}.xlsx`);
}

export function exportPendingXLSX(params: ExportParams) {
  const { closingDate, orders, transactions, breakdowns } = params;
  const matchedOrderIds = new Set(transactions.filter(tx => tx.matched_order_id).map(tx => tx.matched_order_id!));

  const pendingRows = orders.filter(o => !matchedOrderIds.has(o.id)).map(order => ({
    'Data': closingDate,
    'Entregador': order.delivery_person || '',
    'Nº Pedido': order.order_number,
    'Hora Pedido': order.sale_time || '',
    'Forma Saipos': order.payment_method,
    'Valor Total': order.total_amount,
    'Valor Físico': getPhysicalAmount(order, breakdowns),
    'Voucher Parceiro': getVoucherAmount(order, breakdowns),
    'Dinheiro': getCashAmount(order, breakdowns),
    'Tipo Pendência': order.payment_method.toLowerCase().includes('voucher parceiro') ? 'Estrutural' : 'Real',
  }));

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
  if (pendingRows.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pendingRows), 'Pedidos Pendentes');
  }
  if (unmatchedTxRows.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(unmatchedTxRows), 'Transações Sem Vínculo');
  }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([buf]), `pendencias_delivery_${closingDate}.xlsx`);
}

export interface DriverSummary {
  deliveryPerson: string;
  orderCount: number;
  totalOrders: number;
  expectedByMethod: Map<string, number>;
  foundByMethod: Map<string, number>;
  diffByMethod: Map<string, number>;
  totalExpected: number;
  totalFound: number;
  totalDiff: number;
  matchedCount: number;
  pendingCount: number;
  autoMatchCount: number;
  manualMatchCount: number;
  status: string;
  orders: ExportOrder[];
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

  // Build reverse map: delivery person → serials
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
    const expectedByMethod = new Map<string, number>();
    const foundByMethod = new Map<string, number>();

    let totalExpected = 0;
    let matchedCount = 0;
    let autoCount = 0;
    let manualCount = 0;

    for (const order of dpOrders) {
      // Calculate expected by method from breakdowns or raw payment
      const bks = breakdowns.filter(b => b.imported_order_id === order.id);
      if (bks.length > 0) {
        bks.forEach(b => {
          const label = b.payment_method_name;
          expectedByMethod.set(label, (expectedByMethod.get(label) || 0) + b.amount);
          if (b.payment_type === 'fisico') totalExpected += b.amount;
        });
      } else {
        const methods = order.payment_method.split(',').map(m => m.trim());
        const perMethod = order.total_amount / methods.length;
        methods.forEach(m => {
          expectedByMethod.set(m, (expectedByMethod.get(m) || 0) + perMethod);
        });
        totalExpected += order.total_amount;
      }

      const txs = txByOrderId.get(order.id);
      if (txs && txs.length > 0) {
        matchedCount++;
        if (txs[0].match_type === 'manual') manualCount++;
        else autoCount++;
        txs.forEach(tx => {
          const label = tx.payment_method;
          foundByMethod.set(label, (foundByMethod.get(label) || 0) + tx.gross_amount);
        });
      }
    }

    const totalFound = Array.from(foundByMethod.values()).reduce((s, v) => s + v, 0);
    const allMethods = new Set([...expectedByMethod.keys(), ...foundByMethod.keys()]);
    const diffByMethod = new Map<string, number>();
    allMethods.forEach(m => {
      diffByMethod.set(m, (foundByMethod.get(m) || 0) - (expectedByMethod.get(m) || 0));
    });

    const totalDiff = totalFound - totalExpected;
    const pendingCount = dpOrders.length - matchedCount;

    let status = 'Aguardando conferência';
    if (pendingCount === 0 && Math.abs(totalDiff) < 0.05) status = 'Bateu';
    else if (pendingCount === 0 && Math.abs(totalDiff) < 1) status = 'Bateu com ressalva';
    else if (pendingCount > 0) status = 'Divergência por pedido';

    // Gather unmatched txs for this driver by serial
    const driverSerials = personSerials.get(dp) || new Set();
    const driverUnmatchedTxs = transactions.filter(tx =>
      !tx.matched_order_id && tx.machine_serial && driverSerials.has(tx.machine_serial)
    );
    const driverMatchedTxs = dpOrders.flatMap(o => txByOrderId.get(o.id) || []);

    summaries.push({
      deliveryPerson: dp,
      orderCount: dpOrders.length,
      totalOrders: dpOrders.length,
      expectedByMethod,
      foundByMethod,
      diffByMethod,
      totalExpected,
      totalFound,
      totalDiff,
      matchedCount,
      pendingCount,
      autoMatchCount: autoCount,
      manualMatchCount: manualCount,
      status,
      orders: dpOrders,
      matchedTransactions: driverMatchedTxs,
      unmatchedTransactions: driverUnmatchedTxs,
    });
  }

  return summaries.sort((a, b) => b.orderCount - a.orderCount);
}

export function exportDriverSummaryXLSX(params: ExportParams) {
  const summaries = buildDriverSummaries(params);
  const { closingDate } = params;

  const rows = summaries.map(s => ({
    'Data': closingDate,
    'Entregador': s.deliveryPerson,
    'Qtd Pedidos': s.orderCount,
    'Total Esperado': s.totalExpected,
    'Total Maquininha': s.totalFound,
    'Diferença Total': s.totalDiff,
    'Status': s.status,
    'Conciliados': s.matchedCount,
    'Pendentes': s.pendingCount,
    'Matches Auto': s.autoMatchCount,
    'Matches Manual': s.manualMatchCount,
    ...Object.fromEntries(
      Array.from(s.expectedByMethod.entries()).map(([m, v]) => [`Esperado ${m}`, v])
    ),
    ...Object.fromEntries(
      Array.from(s.foundByMethod.entries()).map(([m, v]) => [`Encontrado ${m}`, v])
    ),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Resumo Entregadores');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([buf]), `resumo_entregadores_${closingDate}.xlsx`);
}
