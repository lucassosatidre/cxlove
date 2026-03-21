/**
 * Salon reconciliation matching algorithm v3.
 *
 * PRIORITY ORDER (strict):
 *   1. Exact value 1:1 match (single transaction = single order)
 *   2. Combined exact (sum of 2-5 transactions = order total)
 *   3. Approximate 1:1 (small diff, best candidate)
 *   4. Forced resolution for remaining
 *
 * CONFIDENCE RULES:
 *   - Exact value match = NEVER low confidence
 *   - Low confidence only when real ambiguity exists
 *   - Time distance alone cannot downgrade exact match
 *   - Waiter is tiebreaker, not blocker
 *
 * CONTEXT:
 *   - Saipos reports ORDER START time, not payment time
 *   - Ficha: short window (0-15 min)
 *   - Balcão: medium window (15-60 min)
 *   - Salão: long window (up to 120+ min)
 *   - Each machine serial = one waiter for the whole night
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

// ─── Helpers ───

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

function timeGapMinutes(txTime: string, orderTime: string | null): number {
  if (!orderTime) return -1;
  const txMin = parseTimeToMinutes(txTime);
  const oMin = parseTimeToMinutes(orderTime);
  if (txMin < 0 || oMin < 0) return -1;
  return txMin - oMin;
}

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
  // PHASE 1: Exact 1:1 matches
  // Value exact = priority. Time/waiter only for tiebreaking.
  // Exact value = minimum 'medium', never 'low'.
  // ═══════════════════════════════════════════

  interface ExactCandidate {
    tx: TxForMatching;
    order: SalonOrderForMatching;
    amountIdx: number;
    gap: number;
    sameWaiter: boolean;
    reason: string;
  }

  const exactCandidates: ExactCandidate[] = [];

  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;
    for (const order of eligibleOrders) {
      if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) continue;
      const amounts = getMatchableAmounts(order.id, order.total_amount, payments);

      for (let i = 0; i < amounts.length; i++) {
        if (Math.abs(tx.gross_amount - amounts[i]) < 0.01) {
          const gap = timeGapMinutes(tx.sale_time, order.sale_time);
          const sameWaiter = !!tx.machine_serial;

          const reasonParts: string[] = ['valor idêntico'];
          if (gap >= 0) reasonParts.push(`${gap}min após pedido`);

          exactCandidates.push({
            tx, order, amountIdx: i,
            gap: gap >= 0 ? gap : 999,
            sameWaiter,
            reason: reasonParts.join(', '),
          });
        }
      }
    }
  }

  // For each tx, count how many orders it could match (uniqueness)
  const txCandidateCount = new Map<string, number>();
  const orderCandidateCount = new Map<string, number>();
  for (const c of exactCandidates) {
    txCandidateCount.set(c.tx.id, (txCandidateCount.get(c.tx.id) || 0) + 1);
    const key = `${c.order.id}_${c.amountIdx}`;
    orderCandidateCount.set(key, (orderCandidateCount.get(key) || 0) + 1);
  }

  // Sort: unique candidates first, then by time proximity
  exactCandidates.sort((a, b) => {
    const aUniqueTx = txCandidateCount.get(a.tx.id) || 0;
    const bUniqueTx = txCandidateCount.get(b.tx.id) || 0;
    const aUniqueOrd = orderCandidateCount.get(`${a.order.id}_${a.amountIdx}`) || 0;
    const bUniqueOrd = orderCandidateCount.get(`${b.order.id}_${b.amountIdx}`) || 0;

    // Unique matches first (only 1 candidate for either tx or order)
    const aUnique = Math.min(aUniqueTx, aUniqueOrd);
    const bUnique = Math.min(bUniqueTx, bUniqueOrd);
    if (aUnique !== bUnique) return aUnique - bUnique;

    // Then by time gap
    return a.gap - b.gap;
  });

  for (const c of exactCandidates) {
    if (matchedTxIds.has(c.tx.id)) continue;
    const used = matchedOrderAmountIndices.get(c.order.id) || new Set();
    if (used.has(c.amountIdx)) continue;

    // Check if this is a unique candidate (only option for this order-amount)
    const orderKey = `${c.order.id}_${c.amountIdx}`;
    const numCandidatesForOrder = orderCandidateCount.get(orderKey) || 0;
    const numCandidatesForTx = txCandidateCount.get(c.tx.id) || 0;
    const isUnique = numCandidatesForOrder === 1 || numCandidatesForTx === 1;

    // Exact value = minimum 'medium'. Unique or good time = 'high'.
    const confidence: 'high' | 'medium' = isUnique || c.gap < 120 ? 'high' : 'medium';

    results.push({
      transactionId: c.tx.id,
      orderId: c.order.id,
      matchType: 'exact',
      confidence,
      amountDiff: 0,
      matchReason: `Match exato: ${c.reason}${isUnique ? ', único candidato' : ''}`,
    });
    matchedTxIds.add(c.tx.id);
    markAmountMatched(c.order.id, c.amountIdx);
  }

  // ═══════════════════════════════════════════
  // PHASE 2: Combined matches (rateio) — up to 5 transactions
  // Priority: same waiter > mixed waiters
  // ═══════════════════════════════════════════

  const COMBINED_TOLERANCE = 0.50;

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
      maxSize: number = 5
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
        if (isSameWaiter) score += 4;
        if (timeSpan <= 15) score += 2;
        else if (timeSpan <= 30) score += 1;
        if (targetAmount >= 200) score += 1;
        if (diff < 0.01) score += 2; // exact sum bonus

        const confidence: 'high' | 'medium' | 'low' =
          score >= 6 ? 'high' : score >= 4 ? 'medium' : 'low';

        const reasonParts: string[] = [];
        reasonParts.push(`soma de ${txGroup.length} transações`);
        if (diff < 0.01) reasonParts.push('soma exata');
        if (isSameWaiter) reasonParts.push('mesmo garçom');
        if (timeSpan >= 0) reasonParts.push(`${timeSpan}min entre elas`);
        if (!isSameWaiter) reasonParts.push('garçons diferentes');

        if (!best || diff < best.diff || (diff === best.diff && score > (best.sameWaiter ? 6 : 0))) {
          best = {
            txs: txGroup,
            diff,
            confidence,
            reason: `Match combinado: ${reasonParts.join(', ')}`,
            sameWaiter: isSameWaiter,
          };
        }
      };

      // Try pairs
      const limit2 = Math.min(pool.length, 20);
      for (let i = 0; i < limit2; i++) {
        for (let j = i + 1; j < limit2; j++) {
          tryGroup([pool[i], pool[j]]);
        }
      }

      // Try triples
      if (maxSize >= 3) {
        const limit3 = Math.min(pool.length, 15);
        for (let i = 0; i < limit3; i++) {
          for (let j = i + 1; j < limit3; j++) {
            for (let k = j + 1; k < limit3; k++) {
              tryGroup([pool[i], pool[j], pool[k]]);
            }
          }
        }
      }

      // Try quads
      if (maxSize >= 4 && targetAmount >= 150) {
        const limit4 = Math.min(pool.length, 12);
        for (let i = 0; i < limit4; i++) {
          for (let j = i + 1; j < limit4; j++) {
            for (let k = j + 1; k < limit4; k++) {
              for (let l = k + 1; l < limit4; l++) {
                tryGroup([pool[i], pool[j], pool[k], pool[l]]);
              }
            }
          }
        }
      }

      // Try quintets
      if (maxSize >= 5 && targetAmount >= 200) {
        const limit5 = Math.min(pool.length, 10);
        for (let i = 0; i < limit5; i++) {
          for (let j = i + 1; j < limit5; j++) {
            for (let k = j + 1; k < limit5; k++) {
              for (let l = k + 1; l < limit5; l++) {
                for (let m = l + 1; m < limit5; m++) {
                  tryGroup([pool[i], pool[j], pool[k], pool[l], pool[m]]);
                }
              }
            }
          }
        }
      }

      return best;
    };

    // Group remaining txs by waiter
    const txsByWaiter = new Map<string, TxForMatching[]>();
    for (const tx of remainingTxs) {
      if (tx.machine_serial) {
        const arr = txsByWaiter.get(tx.machine_serial) || [];
        arr.push(tx);
        txsByWaiter.set(tx.machine_serial, arr);
      }
    }

    // STEP 1: Try same-waiter combos first
    let bestCombo: ComboResult | null = null;
    for (const [, waiterTxs] of txsByWaiter) {
      if (waiterTxs.length < 2) continue;
      const result = findBestCombo(waiterTxs, true);
      if (result && (!bestCombo || result.diff < bestCombo.diff)) {
        bestCombo = result;
      }
    }

    // STEP 2: If no same-waiter combo, try mixed (lower confidence)
    if (!bestCombo) {
      const mixedResult = findBestCombo(remainingTxs, false);
      if (mixedResult) {
        // Downgrade confidence for mixed-waiter combos
        if (mixedResult.confidence === 'high') mixedResult.confidence = 'medium';
        else if (mixedResult.confidence === 'medium') mixedResult.confidence = 'low';
        bestCombo = mixedResult;
      }
    }

    // Don't accept mixed-waiter low-confidence combos
    if (bestCombo) {
      if (!bestCombo.sameWaiter && bestCombo.confidence === 'low') {
        continue;
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

  // ═══════════════════════════════════════════
  // PHASE 3: Approximate 1:1 matches
  // For remaining unmatched, find closest single transaction
  // ═══════════════════════════════════════════

  const APPROX_TOLERANCE = 1.00; // R$1.00 tolerance for approximate

  for (const order of eligibleOrders) {
    if (isOrderFullyMatched(order.id)) continue;
    const amounts = getMatchableAmounts(order.id, order.total_amount, payments);
    const nextIdx = getNextUnmatchedAmountIndex(order.id, amounts);
    if (nextIdx < 0) continue;
    const targetAmount = amounts[nextIdx];

    const candidates = transactions
      .filter(tx => !matchedTxIds.has(tx.id) && isTransactionAfterOrder(tx.sale_time, order.sale_time))
      .map(tx => ({
        tx,
        diff: Math.abs(tx.gross_amount - targetAmount),
        gap: timeGapMinutes(tx.sale_time, order.sale_time),
      }))
      .filter(c => c.diff > 0.009 && c.diff <= APPROX_TOLERANCE)
      .sort((a, b) => a.diff - b.diff);

    if (candidates.length === 1) {
      const c = candidates[0];
      results.push({
        transactionId: c.tx.id,
        orderId: order.id,
        matchType: 'approximate',
        confidence: 'medium',
        amountDiff: c.diff,
        matchReason: `Match aproximado: diff R$${c.diff.toFixed(2)}, único candidato próximo`,
      });
      matchedTxIds.add(c.tx.id);
      markAmountMatched(order.id, nextIdx);
    } else if (candidates.length > 1) {
      // Multiple close candidates — pick best but mark as medium
      const best = candidates[0];
      results.push({
        transactionId: best.tx.id,
        orderId: order.id,
        matchType: 'approximate',
        confidence: candidates.length <= 2 ? 'medium' : 'low',
        amountDiff: best.diff,
        matchReason: `Match aproximado: diff R$${best.diff.toFixed(2)}, melhor entre ${candidates.length} candidatos`,
      });
      matchedTxIds.add(best.tx.id);
      markAmountMatched(order.id, nextIdx);
    }
  }

  // ═══════════════════════════════════════════
  // PHASE 4: Forced resolution for remaining
  // If exactly one exact-value tx remains for an order, link it.
  // Also check reverse: if a tx has exactly one matching order.
  // ═══════════════════════════════════════════

  // Forward: for each unmatched order, find unique exact tx
  for (const order of eligibleOrders) {
    if (isOrderFullyMatched(order.id)) continue;
    const amounts = getMatchableAmounts(order.id, order.total_amount, payments);
    const nextIdx = getNextUnmatchedAmountIndex(order.id, amounts);
    if (nextIdx < 0) continue;
    const targetAmount = amounts[nextIdx];

    const exactForOrder = transactions.filter(tx => {
      if (matchedTxIds.has(tx.id)) return false;
      if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) return false;
      return Math.abs(tx.gross_amount - targetAmount) < 0.01;
    });

    if (exactForOrder.length === 1) {
      const tx = exactForOrder[0];
      const gap = timeGapMinutes(tx.sale_time, order.sale_time);
      const reasonParts = ['valor idêntico', 'único candidato disponível'];
      if (gap >= 0) reasonParts.push(`${gap}min após pedido`);

      results.push({
        transactionId: tx.id,
        orderId: order.id,
        matchType: 'exact',
        confidence: 'high',
        amountDiff: 0,
        matchReason: `Match exato: ${reasonParts.join(', ')}`,
      });
      matchedTxIds.add(tx.id);
      markAmountMatched(order.id, nextIdx);
    } else if (exactForOrder.length > 1) {
      // Multiple exact candidates — pick by time, mark medium
      const scored = exactForOrder.map(tx => ({
        tx,
        gap: timeGapMinutes(tx.sale_time, order.sale_time),
      }));
      scored.sort((a, b) => {
        const aGap = a.gap >= 0 ? a.gap : 999;
        const bGap = b.gap >= 0 ? b.gap : 999;
        return aGap - bGap;
      });
      const best = scored[0];

      results.push({
        transactionId: best.tx.id,
        orderId: order.id,
        matchType: 'exact',
        confidence: 'medium',
        amountDiff: 0,
        matchReason: `Match exato: valor idêntico, melhor entre ${scored.length} candidatos`,
      });
      matchedTxIds.add(best.tx.id);
      markAmountMatched(order.id, nextIdx);
    }
  }

  // Reverse: for each unmatched tx, find unique order match
  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;

    const candidateOrders = eligibleOrders.filter(order => {
      if (isOrderFullyMatched(order.id)) return false;
      if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) return false;
      const amounts = getMatchableAmounts(order.id, order.total_amount, payments);
      const nextIdx = getNextUnmatchedAmountIndex(order.id, amounts);
      if (nextIdx < 0) return false;
      return Math.abs(tx.gross_amount - amounts[nextIdx]) < 0.01;
    });

    if (candidateOrders.length === 1) {
      const order = candidateOrders[0];
      const amounts = getMatchableAmounts(order.id, order.total_amount, payments);
      const nextIdx = getNextUnmatchedAmountIndex(order.id, amounts);
      if (nextIdx < 0) continue;

      const gap = timeGapMinutes(tx.sale_time, order.sale_time);
      const reasonParts = ['valor idêntico', 'única comanda compatível'];
      if (gap >= 0) reasonParts.push(`${gap}min após pedido`);

      results.push({
        transactionId: tx.id,
        orderId: order.id,
        matchType: 'exact',
        confidence: 'high',
        amountDiff: 0,
        matchReason: `Match exato: ${reasonParts.join(', ')}`,
      });
      matchedTxIds.add(tx.id);
      markAmountMatched(order.id, nextIdx);
    }
  }

  return results;
}
