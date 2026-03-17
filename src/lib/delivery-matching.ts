/**
 * Delivery reconciliation matching algorithm.
 * Matches card machine transactions to imported orders.
 */

interface OrderForMatching {
  id: string;
  order_number: string;
  payment_method: string;
  total_amount: number;
  delivery_person: string | null;
  sale_time: string | null;
  is_confirmed: boolean;
}

interface TransactionForMatching {
  id: string;
  gross_amount: number;
  payment_method: string;
  machine_serial: string;
  sale_time: string;
}

export interface MatchResult {
  transactionId: string;
  orderId: string;
  matchType: 'exact' | 'approximate';
  confidence: 'high' | 'medium' | 'low';
  amountDiff: number;
}

// Payment methods that are offline and should be reconciled (excluding cash)
const OFFLINE_CARD_METHODS = ['crédito', 'credito', 'débito', 'debito', 'pix', 'voucher'];

function isOfflineCardPayment(method: string): boolean {
  const lower = method.toLowerCase();
  // Exclude online payments and cash
  if (lower.includes('online') || lower.includes('(pago)') || lower.includes('anotaai')) return false;
  if (lower === 'dinheiro') return false;
  return OFFLINE_CARD_METHODS.some(m => lower.includes(m));
}

function getOrderOfflineAmount(order: OrderForMatching): number {
  // For simple single-method orders, return the total
  const methods = order.payment_method.split(',').map(m => m.trim());
  
  // If all methods are offline card, return total
  if (methods.every(m => isOfflineCardPayment(m))) {
    return order.total_amount;
  }
  
  // For mixed (e.g., "Crédito, Voucher Parceiro Desconto"), 
  // the card amount will be less than total
  return order.total_amount;
}

function parseTimeToMinutes(time: string): number {
  if (!time) return -1;
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return -1;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

/**
 * Build a serial-to-delivery-person map based on which serial
 * appears most with which delivery person (from already matched data)
 */
export function buildSerialDeliveryMap(
  matchedPairs: { serial: string; deliveryPerson: string }[]
): Map<string, string> {
  const serialCounts = new Map<string, Map<string, number>>();
  
  for (const { serial, deliveryPerson } of matchedPairs) {
    if (!serial || !deliveryPerson) continue;
    if (!serialCounts.has(serial)) serialCounts.set(serial, new Map());
    const counts = serialCounts.get(serial)!;
    counts.set(deliveryPerson, (counts.get(deliveryPerson) || 0) + 1);
  }
  
  const result = new Map<string, string>();
  for (const [serial, counts] of serialCounts) {
    let maxCount = 0;
    let bestPerson = '';
    for (const [person, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        bestPerson = person;
      }
    }
    if (bestPerson) result.set(serial, bestPerson);
  }
  return result;
}

/**
 * Main matching algorithm
 */
export function matchTransactionsToOrders(
  transactions: TransactionForMatching[],
  orders: OrderForMatching[],
  existingMatches: Set<string> // already matched transaction IDs
): MatchResult[] {
  const results: MatchResult[] = [];
  const matchedOrderIds = new Set<string>();
  const matchedTxIds = new Set<string>(existingMatches);

  // Only consider offline card payment orders (exclude cash and online)
  const eligibleOrders = orders.filter(o => {
    const methods = o.payment_method.split(',').map(m => m.trim());
    return methods.some(m => isOfflineCardPayment(m));
  });

  // Phase 1: Exact amount matches
  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;

    for (const order of eligibleOrders) {
      if (matchedOrderIds.has(order.id)) continue;
      
      const diff = Math.abs(tx.gross_amount - order.total_amount);
      if (diff < 0.01) {
        results.push({
          transactionId: tx.id,
          orderId: order.id,
          matchType: 'exact',
          confidence: 'high',
          amountDiff: 0,
        });
        matchedTxIds.add(tx.id);
        matchedOrderIds.add(order.id);
        break;
      }
    }
  }

  // Phase 2: Approximate matches for rateio cases
  // When an order has rateio (e.g., "Crédito, Voucher Parceiro Desconto"),
  // the card transaction amount will be LESS than the order total.
  // The difference should be the voucher/discount portion.
  const TOLERANCE = 0.5; // cents tolerance for rounding

  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;

    let bestMatch: { order: OrderForMatching; diff: number; confidence: 'medium' | 'low' } | null = null;

    for (const order of eligibleOrders) {
      if (matchedOrderIds.has(order.id)) continue;

      const methods = order.payment_method.split(',').map(m => m.trim().toLowerCase());
      const hasVoucherDesconto = methods.some(m => m.includes('voucher parceiro desconto'));
      const hasMultipleMethods = methods.length > 1;

      if (!hasMultipleMethods) continue;

      // For rateio: transaction amount should be less than order total
      const diff = order.total_amount - tx.gross_amount;
      if (diff < -TOLERANCE || diff > order.total_amount * 0.5) continue; // too far off

      // Check time proximity (within 30 min)
      const txMinutes = parseTimeToMinutes(tx.sale_time);
      const orderMinutes = parseTimeToMinutes(order.sale_time || '');
      const timeDiff = txMinutes >= 0 && orderMinutes >= 0 ? Math.abs(txMinutes - orderMinutes) : 999;
      
      let confidence: 'medium' | 'low' = hasVoucherDesconto ? 'medium' : 'low';
      
      // Boost confidence if time is close
      if (timeDiff <= 30) {
        confidence = 'medium';
      }

      if (!bestMatch || diff < bestMatch.diff) {
        bestMatch = { order, diff, confidence };
      }
    }

    if (bestMatch && bestMatch.diff <= bestMatch.order.total_amount * 0.3) {
      results.push({
        transactionId: tx.id,
        orderId: bestMatch.order.id,
        matchType: 'approximate',
        confidence: bestMatch.confidence,
        amountDiff: bestMatch.diff,
      });
      matchedTxIds.add(tx.id);
      matchedOrderIds.add(bestMatch.order.id);
    }
  }

  return results;
}
