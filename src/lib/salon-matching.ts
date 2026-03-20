/**
 * Salon reconciliation matching algorithm.
 * Matches card machine transactions to salon orders using salon_order_payments amounts.
 */

export interface SalonMatchResult {
  transactionId: string;
  orderId: string;
  matchType: 'exact' | 'approximate' | 'combined';
  confidence: 'high' | 'medium' | 'low';
  amountDiff: number;
  combinedWithTransactionId?: string;
}

interface SalonOrderForMatching {
  id: string;
  order_type: string;
  total_amount: number;
  sale_time: string | null;
}

interface SalonPaymentForMatching {
  salon_order_id: string;
  payment_method: string;
  amount: number;
}

interface TxForMatching {
  id: string;
  gross_amount: number;
  payment_method: string;
  machine_serial: string;
  sale_time: string;
}

function parseTimeToMinutes(time: string): number {
  if (!time) return -1;
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return -1;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

/**
 * Get matchable amounts for a salon order from its manual payments.
 */
function getMatchableAmounts(
  orderId: string,
  payments: SalonPaymentForMatching[]
): number[] {
  const orderPayments = payments.filter(p => p.salon_order_id === orderId && p.amount > 0);
  if (orderPayments.length > 0) {
    return orderPayments.map(p => p.amount);
  }
  return [];
}

export function matchSalonTransactionsToOrders(
  transactions: TxForMatching[],
  orders: SalonOrderForMatching[],
  payments: SalonPaymentForMatching[],
  existingMatches: Set<string>
): SalonMatchResult[] {
  const results: SalonMatchResult[] = [];
  const matchedTxIds = new Set<string>(existingMatches);
  const orderMatchCounts = new Map<string, number>();
  const orderMatchTargets = new Map<string, number>();

  // Only match orders that have payments filled in
  const eligibleOrders = orders.filter(o => {
    const orderPayments = payments.filter(p => p.salon_order_id === o.id && p.amount > 0);
    return orderPayments.length > 0;
  });

  for (const order of eligibleOrders) {
    const amounts = getMatchableAmounts(order.id, payments);
    orderMatchTargets.set(order.id, amounts.length);
    orderMatchCounts.set(order.id, 0);
  }

  const isOrderFullyMatched = (orderId: string) =>
    (orderMatchCounts.get(orderId) || 0) >= (orderMatchTargets.get(orderId) || 1);

  // Phase 1: Exact matches
  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;
    for (const order of eligibleOrders) {
      if (isOrderFullyMatched(order.id)) continue;
      const amounts = getMatchableAmounts(order.id, payments);
      const matchedCount = orderMatchCounts.get(order.id) || 0;
      for (let i = matchedCount; i < amounts.length; i++) {
        if (Math.abs(tx.gross_amount - amounts[i]) < 0.01) {
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

  // Phase 2: Combined matches (two txs summing to a payment amount)
  const COMBINED_TOLERANCE = 0.50;
  for (const order of eligibleOrders) {
    if (isOrderFullyMatched(order.id)) continue;
    const amounts = getMatchableAmounts(order.id, payments);
    const matchedCount = orderMatchCounts.get(order.id) || 0;
    if (matchedCount >= amounts.length) continue;
    const targetAmount = amounts[matchedCount];

    const remainingTxs = transactions.filter(tx => !matchedTxIds.has(tx.id));
    if (remainingTxs.length < 2) break;

    let bestPair: { tx1: TxForMatching; tx2: TxForMatching; diff: number; confidence: 'high' | 'medium' | 'low' } | null = null;

    for (let i = 0; i < remainingTxs.length; i++) {
      for (let j = i + 1; j < remainingTxs.length; j++) {
        const sum = remainingTxs[i].gross_amount + remainingTxs[j].gross_amount;
        const diff = Math.abs(sum - targetAmount);
        if (diff > COMBINED_TOLERANCE) continue;

        let score = 0;
        if (remainingTxs[i].machine_serial && remainingTxs[i].machine_serial === remainingTxs[j].machine_serial) score++;
        const t1 = parseTimeToMinutes(remainingTxs[i].sale_time);
        const t2 = parseTimeToMinutes(remainingTxs[j].sale_time);
        if (t1 >= 0 && t2 >= 0 && Math.abs(t1 - t2) <= 10) score++;
        const oMin = parseTimeToMinutes(order.sale_time || '');
        if (oMin >= 0 && t1 >= 0 && t2 >= 0 && Math.abs((t1 + t2) / 2 - oMin) <= 30) score++;

        const confidence: 'high' | 'medium' | 'low' = score >= 2 ? 'high' : score === 1 ? 'medium' : 'low';
        if (!bestPair || diff < bestPair.diff) {
          bestPair = { tx1: remainingTxs[i], tx2: remainingTxs[j], diff, confidence };
        }
      }
    }

    if (bestPair) {
      results.push(
        { transactionId: bestPair.tx1.id, orderId: order.id, matchType: 'combined', confidence: bestPair.confidence, amountDiff: bestPair.diff, combinedWithTransactionId: bestPair.tx2.id },
        { transactionId: bestPair.tx2.id, orderId: order.id, matchType: 'combined', confidence: bestPair.confidence, amountDiff: bestPair.diff, combinedWithTransactionId: bestPair.tx1.id },
      );
      matchedTxIds.add(bestPair.tx1.id);
      matchedTxIds.add(bestPair.tx2.id);
      orderMatchCounts.set(order.id, (orderMatchCounts.get(order.id) || 0) + 2);
    }
  }

  return results;
}
