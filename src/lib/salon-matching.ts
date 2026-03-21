/**
 * Salon reconciliation matching algorithm v2.
 *
 * Priority order for matching:
 *   1. Exact or sum-exact value match
 *   2. Same waiter (machine serial)
 *   3. Time proximity (window depends on order type)
 *   4. Mixed waiters only as last resort (lower confidence)
 *
 * Rules:
 * - Saipos reports ORDER START time, not payment time.
 * - Ficha: short window (0-15 min).
 * - Balcão: medium window (15-60 min).
 * - Salão: long window (up to 90+ min).
 * - Each machine serial = one waiter for the whole night.
 * - Rateio: same waiter, short burst, especially for orders > R$200.
 */

export interface SalonMatchResult {
  transactionId: string;
  orderId: string;
  matchType: 'exact' | 'approximate' | 'combined';
  confidence: 'high' | 'medium' | 'low';
  amountDiff: number;
  combinedWithTransactionId?: string;
  matchReason?: string;
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

// ─── Time helpers ───

function parseTimeToMinutes(time: string): number {
  if (!time) return -1;
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return -1;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

function isTransactionAfterOrder(txTime: string | null, orderTime: string | null): boolean {
  if (!txTime || !orderTime) return true;
  const txMin = parseTimeToMinutes(txTime);
  const oMin = parseTimeToMinutes(orderTime);
  if (txMin < 0 || oMin < 0) return true;
  return txMin >= oMin;
}

function getTimeWindow(orderType: string): { ideal: number; max: number } {
  const t = orderType.toLowerCase();
  if (t === 'ficha') return { ideal: 15, max: 30 };
  if (t === 'balcão' || t === 'balcao') return { ideal: 30, max: 60 };
  // Salão, Retirada, numeric types → long window
  return { ideal: 60, max: 120 };
}

function timeGapMinutes(txTime: string, orderTime: string | null): number {
  if (!orderTime) return -1;
  const txMin = parseTimeToMinutes(txTime);
  const oMin = parseTimeToMinutes(orderTime);
  if (txMin < 0 || oMin < 0) return -1;
  return txMin - oMin;
}

// ─── Matchable amounts ───

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

// ─── Main algorithm ───

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

  const markAmountMatched = (orderId: string, index: number) => {
    const used = matchedOrderAmountIndices.get(orderId) || new Set();
    used.add(index);
    matchedOrderAmountIndices.set(orderId, used);
  };

  const getNextUnmatchedAmountIndex = (orderId: string, amounts: number[]): number => {
    const used = matchedOrderAmountIndices.get(orderId) || new Set();
    for (let i = 0; i < amounts.length; i++) {
      if (!used.has(i)) return i;
    }
    return -1;
  };

  const isOrderFullyMatched = (orderId: string): boolean => {
    const amounts = getMatchableAmounts(
      orderId,
      orders.find(o => o.id === orderId)?.total_amount || 0,
      payments
    );
    const used = matchedOrderAmountIndices.get(orderId) || new Set();
    return used.size >= amounts.length;
  };

  // ═══════════════════════════════════════════
  // PHASE 1: Exact single-transaction matches
  // Priority: value exact → same waiter → time proximity
  // Exact value = NEVER low confidence
  // ═══════════════════════════════════════════

  interface ExactCandidate {
    tx: TxForMatching;
    order: SalonOrderForMatching;
    amountIdx: number;
    sameWaiter: boolean;
    timeScore: number;
    gap: number;
    reason: string;
  }

  const exactCandidates: ExactCandidate[] = [];

  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;
    for (const order of eligibleOrders) {
      if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) continue;
      const amounts = getMatchableAmounts(order.id, order.total_amount, payments);
      const gap = timeGapMinutes(tx.sale_time, order.sale_time);
      const window = getTimeWindow(order.order_type);

      for (let i = 0; i < amounts.length; i++) {
        if (Math.abs(tx.gross_amount - amounts[i]) < 0.01) {
          const sameWaiter = !!tx.machine_serial && !!order.sale_time;

          let timeScore = 0.5;
          if (gap >= 0) {
            if (gap <= window.ideal) timeScore = 1;
            else if (gap <= window.max) timeScore = 0.7;
            else timeScore = 0.4;
          }

          const reasonParts: string[] = ['valor idêntico'];
          if (sameWaiter) reasonParts.push('garçom identificado');
          if (gap >= 0) reasonParts.push(`${gap}min após pedido`);

          exactCandidates.push({
            tx, order, amountIdx: i,
            sameWaiter,
            timeScore,
            gap: gap >= 0 ? gap : 999,
            reason: reasonParts.join(', '),
          });
        }
      }
    }
  }

  // Sort: best matches first
  // 1. Time within window scores higher
  // 2. Same waiter preferred
  // 3. Closer gap is better
  exactCandidates.sort((a, b) => {
    if (b.timeScore !== a.timeScore) return b.timeScore - a.timeScore;
    if (a.sameWaiter !== b.sameWaiter) return a.sameWaiter ? -1 : 1;
    return a.gap - b.gap;
  });

  for (const c of exactCandidates) {
    if (matchedTxIds.has(c.tx.id)) continue;
    const used = matchedOrderAmountIndices.get(c.order.id) || new Set();
    if (used.has(c.amountIdx)) continue;

    // RULE: Exact value match = minimum 'medium', never 'low'
    // If time is within window OR no competing candidate → 'high'
    const confidence: 'high' | 'medium' =
      c.timeScore >= 0.5 ? 'high' : 'medium';

    results.push({
      transactionId: c.tx.id,
      orderId: c.order.id,
      matchType: 'exact',
      confidence,
      amountDiff: 0,
      matchReason: `Match exato: ${c.reason}`,
    });
    matchedTxIds.add(c.tx.id);
    markAmountMatched(c.order.id, c.amountIdx);
  }

  // ═══════════════════════════════════════════
  // PHASE 2: Combined matches (rateio)
  // Priority: same waiter first, then mixed waiters
  // ═══════════════════════════════════════════

  const COMBINED_TOLERANCE = 0.50;
  const RATEIO_TIME_WINDOW = 15; // minutes between transactions

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

    // Group remaining txs by waiter
    const txsByWaiter = new Map<string, TxForMatching[]>();
    const noSerialTxs: TxForMatching[] = [];
    for (const tx of remainingTxs) {
      if (tx.machine_serial) {
        const arr = txsByWaiter.get(tx.machine_serial) || [];
        arr.push(tx);
        txsByWaiter.set(tx.machine_serial, arr);
      } else {
        noSerialTxs.push(tx);
      }
    }

    interface ComboResult {
      txs: TxForMatching[];
      diff: number;
      confidence: 'high' | 'medium' | 'low';
      reason: string;
      sameWaiter: boolean;
    }

    const findBestCombo = (
      pool: TxForMatching[],
      isSameWaiter: boolean,
      waiterLabel?: string
    ): ComboResult | null => {
      if (pool.length < 2) return null;
      let best: ComboResult | null = null;

      const tryGroup = (txGroup: TxForMatching[]) => {
        const sum = txGroup.reduce((s, t) => s + t.gross_amount, 0);
        const diff = Math.abs(sum - targetAmount);
        if (diff > COMBINED_TOLERANCE) return;

        const times = txGroup.map(t => parseTimeToMinutes(t.sale_time)).filter(t => t >= 0);
        let timeSpan = 0;
        if (times.length > 1) {
          timeSpan = Math.max(...times) - Math.min(...times);
        }

        let score = 0;
        if (isSameWaiter) score += 4; // Strong waiter signal
        if (timeSpan <= RATEIO_TIME_WINDOW) score += 2;
        else if (timeSpan <= 30) score += 1;
        if (targetAmount >= 200) score += 1;

        // Time from order
        const orderMin = parseTimeToMinutes(order.sale_time || '');
        if (orderMin >= 0 && times.length > 0) {
          const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
          const gap = avgTime - orderMin;
          const window = getTimeWindow(order.order_type);
          if (gap >= 0 && gap <= window.max) score += 1;
        }

        const confidence: 'high' | 'medium' | 'low' =
          score >= 6 ? 'high' : score >= 4 ? 'medium' : 'low';

        const reasonParts: string[] = [];
        reasonParts.push(`soma de ${txGroup.length} transações`);
        if (isSameWaiter && waiterLabel) reasonParts.push(`mesmo garçom`);
        if (timeSpan >= 0) reasonParts.push(`${timeSpan}min entre elas`);
        if (!isSameWaiter) reasonParts.push('garçons diferentes');

        if (!best || diff < best.diff || (diff === best.diff && score > 0)) {
          best = {
            txs: txGroup,
            diff,
            confidence,
            reason: `Match combinado: ${reasonParts.join(', ')}`,
            sameWaiter: isSameWaiter,
          };
        }
      };

      const limit = Math.min(pool.length, 20);

      // Try pairs
      for (let i = 0; i < limit; i++) {
        for (let j = i + 1; j < limit; j++) {
          tryGroup([pool[i], pool[j]]);
        }
      }

      // Try triples
      if (targetAmount >= 150) {
        const triLimit = Math.min(pool.length, 15);
        for (let i = 0; i < triLimit; i++) {
          for (let j = i + 1; j < triLimit; j++) {
            for (let k = j + 1; k < triLimit; k++) {
              tryGroup([pool[i], pool[j], pool[k]]);
            }
          }
        }
      }

      // Try quads
      if (targetAmount >= 300) {
        const quadLimit = Math.min(pool.length, 10);
        for (let i = 0; i < quadLimit; i++) {
          for (let j = i + 1; j < quadLimit; j++) {
            for (let k = j + 1; k < quadLimit; k++) {
              for (let l = k + 1; l < quadLimit; l++) {
                tryGroup([pool[i], pool[j], pool[k], pool[l]]);
              }
            }
          }
        }
      }

      return best;
    };

    // STEP 1: Try same-waiter combos first
    let bestCombo: ComboResult | null = null;

    for (const [serial, waiterTxs] of txsByWaiter) {
      if (waiterTxs.length < 2) continue;
      const waiterLabel = serial;
      const result = findBestCombo(waiterTxs, true, waiterLabel);
      if (result && (!bestCombo || result.diff < bestCombo.diff)) {
        bestCombo = result;
      }
    }

    // STEP 2: Only if no same-waiter combo found, try mixed (lower confidence)
    if (!bestCombo) {
      const mixedResult = findBestCombo(remainingTxs, false);
      if (mixedResult) {
        // Downgrade confidence for mixed-waiter combos
        if (mixedResult.confidence === 'high') mixedResult.confidence = 'medium';
        else if (mixedResult.confidence === 'medium') mixedResult.confidence = 'low';
        bestCombo = mixedResult;
      }
    }

    // Only accept combo if confidence is not too low for mixed waiters
    if (bestCombo) {
      // Safety: don't accept mixed-waiter low-confidence combos
      if (!bestCombo.sameWaiter && bestCombo.confidence === 'low') {
        continue; // Skip: better to leave unmatched than link incorrectly
      }

      for (let t = 0; t < bestCombo.txs.length; t++) {
        const tx = bestCombo.txs[t];
        const combinedWith = bestCombo.txs
          .filter((_, idx) => idx !== t)
          .map(x => x.id)
          .join(',');
        results.push({
          transactionId: tx.id,
          orderId: order.id,
          matchType: 'combined',
          confidence: bestCombo.confidence,
          amountDiff: bestCombo.diff,
          combinedWithTransactionId: combinedWith,
          matchReason: bestCombo.reason,
        });
        matchedTxIds.add(tx.id);
      }
      markAmountMatched(order.id, nextIdx);
    }
  }

  return results;
}
