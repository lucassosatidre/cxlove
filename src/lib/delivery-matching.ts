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

interface BreakdownForMatching {
  imported_order_id: string;
  payment_method_name: string;
  payment_type: string;
  amount: number;
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
  matchType: 'exact' | 'approximate' | 'combined';
  confidence: 'high' | 'medium' | 'low';
  amountDiff: number;
  /** For combined matches, the ID of the other transaction in the pair */
  combinedWithTransactionId?: string;
}

// Payment methods that are offline and should be reconciled (excluding cash)
const OFFLINE_CARD_METHODS = ['crédito', 'credito', 'débito', 'debito', 'pix', 'voucher'];

function isOfflineCardPayment(method: string): boolean {
  const lower = method.toLowerCase();
  if (lower.includes('online') || lower.includes('(pago)') || lower.includes('anotaai')) return false;
  if (lower === 'dinheiro') return false;
  if (lower.includes('voucher parceiro desconto')) return false;
  return OFFLINE_CARD_METHODS.some(m => lower.includes(m));
}

function parseTimeToMinutes(time: string): number {
  if (!time) return -1;
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return -1;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

/**
 * Returns true if the transaction time is >= order time.
 * A payment can only happen after the order is placed.
 * Returns true if either time is missing (can't validate).
 */
function isTransactionAfterOrder(txTime: string | null, orderTime: string | null): boolean {
  if (!txTime || !orderTime) return true; // can't validate, allow
  const txMin = parseTimeToMinutes(txTime);
  const orderMin = parseTimeToMinutes(orderTime);
  if (txMin < 0 || orderMin < 0) return true; // can't parse, allow
  return txMin >= orderMin;
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
 * Get the amounts to match for an order.
 * If breakdowns exist with physical methods, use those individual amounts.
 * Otherwise, use the order total.
 */
function getMatchableAmounts(
  order: OrderForMatching,
  breakdowns: BreakdownForMatching[]
): number[] {
  const orderBreakdowns = breakdowns.filter(b => b.imported_order_id === order.id);
  
  if (orderBreakdowns.length > 0) {
    // Use physical breakdown amounts for matching
    const physicalAmounts = orderBreakdowns
      .filter(b => b.payment_type === 'fisico' && b.amount > 0)
      .map(b => b.amount);
    
    if (physicalAmounts.length > 0) {
      return physicalAmounts;
    }
  }
  
  // Fallback: use total amount
  return [order.total_amount];
}

/**
 * Main matching algorithm
 */
export function matchTransactionsToOrders(
  transactions: TransactionForMatching[],
  orders: OrderForMatching[],
  existingMatches: Set<string>,
  breakdowns: BreakdownForMatching[] = []
): MatchResult[] {
  const results: MatchResult[] = [];
  const matchedTxIds = new Set<string>(existingMatches);
  // Track how many matches each order has gotten vs how many it needs
  const orderMatchCounts = new Map<string, number>();
  const orderMatchTargets = new Map<string, number>();

  // Only consider offline card payment orders (exclude cash and online)
  const eligibleOrders = orders.filter(o => {
    const methods = o.payment_method.split(',').map(m => m.trim());
    return methods.some(m => isOfflineCardPayment(m));
  });

  // Pre-compute matchable amounts for each order
  const orderAmounts = new Map<string, number[]>();
  for (const order of eligibleOrders) {
    const amounts = getMatchableAmounts(order, breakdowns);
    orderAmounts.set(order.id, amounts);
    orderMatchTargets.set(order.id, amounts.length);
    orderMatchCounts.set(order.id, 0);
  }

  const isOrderFullyMatched = (orderId: string) => {
    return (orderMatchCounts.get(orderId) || 0) >= (orderMatchTargets.get(orderId) || 1);
  };

  // Phase 1: Exact amount matches (using breakdown amounts)
  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;

    for (const order of eligibleOrders) {
      if (isOrderFullyMatched(order.id)) continue;
      // Transaction must be after order time
      if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) continue;
      
      const amounts = orderAmounts.get(order.id) || [order.total_amount];
      const matchedCount = orderMatchCounts.get(order.id) || 0;
      
      // Try to match against each unmatched amount
      for (let i = matchedCount; i < amounts.length; i++) {
        const targetAmount = amounts[i];
        const diff = Math.abs(tx.gross_amount - targetAmount);
        if (diff < 0.01) {
          results.push({
            transactionId: tx.id,
            orderId: order.id,
            matchType: 'exact',
            confidence: 'high',
            amountDiff: 0,
          });
          matchedTxIds.add(tx.id);
          orderMatchCounts.set(order.id, matchedCount + 1);
          break;
        }
      }
      if (matchedTxIds.has(tx.id)) break;
    }
  }

  // Phase 2: Approximate matches for rateio cases
  const TOLERANCE = 0.5;

  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;

    let bestMatch: { order: OrderForMatching; diff: number; confidence: 'medium' | 'low' } | null = null;

    for (const order of eligibleOrders) {
      if (isOrderFullyMatched(order.id)) continue;
      // Transaction must be after order time
      if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) continue;

      const methods = order.payment_method.split(',').map(m => m.trim().toLowerCase());
      const hasVoucherDesconto = methods.some(m => m.includes('voucher parceiro desconto'));
      const hasMultipleMethods = methods.length > 1;

      if (!hasMultipleMethods) continue;

      const diff = order.total_amount - tx.gross_amount;
      if (diff < -TOLERANCE || diff > order.total_amount * 0.5) continue;

      const txMinutes = parseTimeToMinutes(tx.sale_time);
      const orderMinutes = parseTimeToMinutes(order.sale_time || '');
      const timeDiff = txMinutes >= 0 && orderMinutes >= 0 ? Math.abs(txMinutes - orderMinutes) : 999;
      
      let confidence: 'medium' | 'low' = hasVoucherDesconto ? 'medium' : 'low';
      
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
      const count = orderMatchCounts.get(bestMatch.order.id) || 0;
      orderMatchCounts.set(bestMatch.order.id, count + 1);
    }
  }

  // Phase 3: Combined matches — two unmatched transactions that sum to an unmatched order amount
  const COMBINED_TOLERANCE = 0.50;

  for (const order of eligibleOrders) {
    if (isOrderFullyMatched(order.id)) continue;

    const amounts = orderAmounts.get(order.id) || [order.total_amount];
    const matchedCount = orderMatchCounts.get(order.id) || 0;
    
    // For combined, try against unmatched target amounts or the total
    const targetAmount = matchedCount < amounts.length ? amounts[matchedCount] : order.total_amount;

    const remainingTxs = transactions.filter(tx => !matchedTxIds.has(tx.id));
    if (remainingTxs.length < 2) break;

    let bestPair: {
      tx1: TransactionForMatching;
      tx2: TransactionForMatching;
      confidence: 'high' | 'medium' | 'low';
      diff: number;
    } | null = null;

    for (let i = 0; i < remainingTxs.length; i++) {
      for (let j = i + 1; j < remainingTxs.length; j++) {
        const tx1 = remainingTxs[i];
        const tx2 = remainingTxs[j];
        const sum = tx1.gross_amount + tx2.gross_amount;
        const diff = Math.abs(sum - targetAmount);

        if (diff > COMBINED_TOLERANCE) continue;

        let score = 0;
        if (tx1.machine_serial && tx1.machine_serial === tx2.machine_serial) score++;

        const tx1Min = parseTimeToMinutes(tx1.sale_time);
        const tx2Min = parseTimeToMinutes(tx2.sale_time);
        if (tx1Min >= 0 && tx2Min >= 0 && Math.abs(tx1Min - tx2Min) <= 10) score++;

        const orderMin = parseTimeToMinutes(order.sale_time || '');
        if (orderMin >= 0) {
          const avgTxMin = (tx1Min + tx2Min) / 2;
          if (Math.abs(avgTxMin - orderMin) <= 30) score++;
        }

        const confidence: 'high' | 'medium' | 'low' = score >= 2 ? 'high' : score === 1 ? 'medium' : 'low';

        if (!bestPair || score > (bestPair.confidence === 'high' ? 2 : bestPair.confidence === 'medium' ? 1 : 0) || (diff < bestPair.diff)) {
          bestPair = { tx1, tx2, confidence, diff };
        }
      }
    }

    if (bestPair) {
      results.push({
        transactionId: bestPair.tx1.id,
        orderId: order.id,
        matchType: 'combined',
        confidence: bestPair.confidence,
        amountDiff: bestPair.diff,
        combinedWithTransactionId: bestPair.tx2.id,
      });
      results.push({
        transactionId: bestPair.tx2.id,
        orderId: order.id,
        matchType: 'combined',
        confidence: bestPair.confidence,
        amountDiff: bestPair.diff,
        combinedWithTransactionId: bestPair.tx1.id,
      });
      matchedTxIds.add(bestPair.tx1.id);
      matchedTxIds.add(bestPair.tx2.id);
      const count = orderMatchCounts.get(order.id) || 0;
      orderMatchCounts.set(order.id, count + 2);
    }
  }

  return results;
}
