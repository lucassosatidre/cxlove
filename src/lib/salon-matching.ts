/**
 * Salon reconciliation matching algorithm.
 * Matches card machine transactions to salon orders using salon_order_payments amounts
 * or total_amount when no payments are filled in.
 *
 * Rules:
 * - Saipos reports ORDER START time, not payment time.
 * - Ficha: payment happens shortly after order (0-15 min).
 * - Balcão/Salão: 15-60+ min gap is normal.
 * - Customers stay ~1h+; only first-order time is known.
 * - Orders > R$200 often have split payments (rateio) from same machine in short bursts.
 * - Each machine serial = one waiter for the whole night.
 * - Transaction must occur at or after the order time.
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
 * Time rule: transaction sale_time must be >= order sale_time.
 * Salon has large gaps (up to 90+ min) so we only enforce "not before".
 */
function isTransactionAfterOrder(txTime: string | null, orderTime: string | null): boolean {
  if (!txTime || !orderTime) return true;
  const txMin = parseTimeToMinutes(txTime);
  const oMin = parseTimeToMinutes(orderTime);
  if (txMin < 0 || oMin < 0) return true;
  return txMin >= oMin;
}

/**
 * Proximity score: how close in time is the tx to expected payment window.
 * Ficha: expect 0-15 min after order.
 * Balcão/Salão: expect 15-60 min after order.
 * Returns 0-1 (1 = best).
 */
function timeProximityScore(
  txTime: string,
  orderTime: string | null,
  orderType: string
): number {
  if (!orderTime) return 0.5;
  const txMin = parseTimeToMinutes(txTime);
  const oMin = parseTimeToMinutes(orderTime);
  if (txMin < 0 || oMin < 0) return 0.5;

  const gap = txMin - oMin;
  if (gap < 0) return 0;

  const isFicha = orderType.toLowerCase() === 'ficha';

  if (isFicha) {
    // Ficha: ideal 0-15 min
    if (gap <= 15) return 1;
    if (gap <= 30) return 0.7;
    if (gap <= 60) return 0.4;
    return 0.2;
  } else {
    // Balcão/Salão/Retirada: ideal 15-60 min, but up to 90 is common
    if (gap <= 5) return 0.6; // too fast for table service
    if (gap <= 30) return 0.9;
    if (gap <= 60) return 1;
    if (gap <= 90) return 0.7;
    if (gap <= 120) return 0.4;
    return 0.2;
  }
}

/**
 * Get matchable amounts for a salon order.
 */
function getMatchableAmounts(
  orderId: string,
  totalAmount: number,
  payments: SalonPaymentForMatching[]
): number[] {
  const orderPayments = payments.filter(p => p.salon_order_id === orderId && p.amount > 0);
  if (orderPayments.length > 0) {
    return orderPayments.map(p => p.amount);
  }
  return totalAmount > 0 ? [totalAmount] : [];
}

export function matchSalonTransactionsToOrders(
  transactions: TxForMatching[],
  orders: SalonOrderForMatching[],
  payments: SalonPaymentForMatching[],
  existingMatches: Set<string>
): SalonMatchResult[] {
  const results: SalonMatchResult[] = [];
  const matchedTxIds = new Set<string>(existingMatches);
  const matchedOrderAmountIndices = new Map<string, Set<number>>();

  const eligibleOrders = orders.filter(o => {
    const amounts = getMatchableAmounts(o.id, o.total_amount, payments);
    return amounts.length > 0;
  });

  for (const order of eligibleOrders) {
    matchedOrderAmountIndices.set(order.id, new Set());
  }

  const getNextUnmatchedAmountIndex = (orderId: string, amounts: number[]): number => {
    const used = matchedOrderAmountIndices.get(orderId) || new Set();
    for (let i = 0; i < amounts.length; i++) {
      if (!used.has(i)) return i;
    }
    return -1;
  };

  const markAmountMatched = (orderId: string, index: number) => {
    const used = matchedOrderAmountIndices.get(orderId) || new Set();
    used.add(index);
    matchedOrderAmountIndices.set(orderId, used);
  };

  const isOrderFullyMatched = (orderId: string): boolean => {
    const amounts = getMatchableAmounts(orderId,
      orders.find(o => o.id === orderId)?.total_amount || 0, payments);
    const used = matchedOrderAmountIndices.get(orderId) || new Set();
    return used.size >= amounts.length;
  };

  // ─── Phase 1: Exact matches with proximity scoring ───
  interface ExactCandidate {
    tx: TxForMatching;
    order: SalonOrderForMatching;
    amountIdx: number;
    score: number;
  }

  const exactCandidates: ExactCandidate[] = [];

  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;
    for (const order of eligibleOrders) {
      if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) continue;
      const amounts = getMatchableAmounts(order.id, order.total_amount, payments);
      for (let i = 0; i < amounts.length; i++) {
        if (Math.abs(tx.gross_amount - amounts[i]) < 0.01) {
          const score = timeProximityScore(tx.sale_time, order.sale_time, order.order_type);
          exactCandidates.push({ tx, order, amountIdx: i, score });
        }
      }
    }
  }

  // Sort by score descending to prioritize best time proximity
  exactCandidates.sort((a, b) => b.score - a.score);

  for (const c of exactCandidates) {
    if (matchedTxIds.has(c.tx.id)) continue;
    const used = matchedOrderAmountIndices.get(c.order.id) || new Set();
    if (used.has(c.amountIdx)) continue;

    results.push({
      transactionId: c.tx.id,
      orderId: c.order.id,
      matchType: 'exact',
      confidence: c.score >= 0.7 ? 'high' : c.score >= 0.4 ? 'medium' : 'low',
      amountDiff: 0,
    });
    matchedTxIds.add(c.tx.id);
    markAmountMatched(c.order.id, c.amountIdx);
  }

  // ─── Phase 2: Combined matches (rateio detection) ───
  // For orders > R$200 or with multiple payment amounts, look for tx groups
  // from the same machine serial in short time windows.
  const COMBINED_TOLERANCE = 0.50;
  const RATEIO_TIME_WINDOW = 15; // minutes

  for (const order of eligibleOrders) {
    if (isOrderFullyMatched(order.id)) continue;
    const amounts = getMatchableAmounts(order.id, order.total_amount, payments);
    const nextIdx = getNextUnmatchedAmountIndex(order.id, amounts);
    if (nextIdx < 0) continue;
    const targetAmount = amounts[nextIdx];

    const remainingTxs = transactions.filter(tx =>
      !matchedTxIds.has(tx.id) && isTransactionAfterOrder(tx.sale_time, order.sale_time)
    );
    if (remainingTxs.length < 2) continue;

    // Try combinations of 2, 3, and 4 transactions
    let bestCombo: {
      txs: TxForMatching[];
      diff: number;
      confidence: 'high' | 'medium' | 'low';
    } | null = null;

    // Helper to score a combination
    const scoreCombo = (txGroup: TxForMatching[]): {
      diff: number;
      confidence: 'high' | 'medium' | 'low';
    } | null => {
      const sum = txGroup.reduce((s, t) => s + t.gross_amount, 0);
      const diff = Math.abs(sum - targetAmount);
      if (diff > COMBINED_TOLERANCE) return null;

      let score = 0;

      // Same machine serial (same waiter) = strong rateio signal
      const serials = new Set(txGroup.map(t => t.machine_serial).filter(Boolean));
      if (serials.size === 1 && serials.values().next().value) score += 3;

      // Time proximity between transactions
      const times = txGroup.map(t => parseTimeToMinutes(t.sale_time)).filter(t => t >= 0);
      if (times.length === txGroup.length && times.length > 0) {
        const minT = Math.min(...times);
        const maxT = Math.max(...times);
        if (maxT - minT <= RATEIO_TIME_WINDOW) score += 2;
        else if (maxT - minT <= 30) score += 1;
      }

      // High-value order (>200) makes rateio more likely
      if (targetAmount >= 200) score += 1;

      // Time proximity to order
      const orderMin = parseTimeToMinutes(order.sale_time || '');
      if (orderMin >= 0 && times.length > 0) {
        const avgTxTime = times.reduce((a, b) => a + b, 0) / times.length;
        const gap = avgTxTime - orderMin;
        if (gap >= 0 && gap <= 90) score += 1;
      }

      const confidence: 'high' | 'medium' | 'low' =
        score >= 5 ? 'high' : score >= 3 ? 'medium' : 'low';

      return { diff, confidence };
    };

    // Try pairs
    for (let i = 0; i < remainingTxs.length && !bestCombo; i++) {
      for (let j = i + 1; j < remainingTxs.length; j++) {
        const result = scoreCombo([remainingTxs[i], remainingTxs[j]]);
        if (!result) continue;
        if (!bestCombo || result.diff < bestCombo.diff ||
          (result.diff === bestCombo.diff && result.confidence > (bestCombo.confidence))) {
          bestCombo = { txs: [remainingTxs[i], remainingTxs[j]], ...result };
        }
      }
    }

    // Try triples (for larger rateios, limit search for perf)
    if (!bestCombo && remainingTxs.length >= 3 && targetAmount >= 150) {
      const limit = Math.min(remainingTxs.length, 20);
      for (let i = 0; i < limit && !bestCombo; i++) {
        for (let j = i + 1; j < limit; j++) {
          for (let k = j + 1; k < limit; k++) {
            const result = scoreCombo([remainingTxs[i], remainingTxs[j], remainingTxs[k]]);
            if (!result) continue;
            if (!bestCombo || result.diff < bestCombo.diff) {
              bestCombo = { txs: [remainingTxs[i], remainingTxs[j], remainingTxs[k]], ...result };
            }
          }
        }
      }
    }

    // Try quads (for big tables, very limited search)
    if (!bestCombo && remainingTxs.length >= 4 && targetAmount >= 300) {
      const limit = Math.min(remainingTxs.length, 12);
      for (let i = 0; i < limit; i++) {
        for (let j = i + 1; j < limit; j++) {
          for (let k = j + 1; k < limit; k++) {
            for (let l = k + 1; l < limit; l++) {
              const result = scoreCombo([remainingTxs[i], remainingTxs[j], remainingTxs[k], remainingTxs[l]]);
              if (result && (!bestCombo || result.diff < bestCombo.diff)) {
                bestCombo = { txs: [remainingTxs[i], remainingTxs[j], remainingTxs[k], remainingTxs[l]], ...result };
              }
            }
          }
        }
      }
    }

    if (bestCombo) {
      for (let t = 0; t < bestCombo.txs.length; t++) {
        const tx = bestCombo.txs[t];
        const combinedWith = bestCombo.txs.filter((_, idx) => idx !== t).map(x => x.id).join(',');
        results.push({
          transactionId: tx.id,
          orderId: order.id,
          matchType: 'combined',
          confidence: bestCombo.confidence,
          amountDiff: bestCombo.diff,
          combinedWithTransactionId: combinedWith,
        });
        matchedTxIds.add(tx.id);
      }
      markAmountMatched(order.id, nextIdx);
    }
  }

  return results;
}
