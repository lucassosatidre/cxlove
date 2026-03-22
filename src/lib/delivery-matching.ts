/**
 * Delivery reconciliation matching algorithm.
 * Matches card machine transactions to imported orders.
 */

import {
  canCoverExpectedMethods,
  getDeliveryAutoMatchContext,
  isTransactionMethodCompatible,
  normalizeDeliveryMethod,
} from './delivery-method-utils';

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
  if (!txTime || !orderTime) return true;
  const txMin = parseTimeToMinutes(txTime);
  const orderMin = parseTimeToMinutes(orderTime);
  if (txMin < 0 || orderMin < 0) return true;
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
 * Infer delivery person from serial using a pre-built map.
 */
function inferDeliveryPerson(
  serial: string,
  serialMap: Map<string, string>
): string | null {
  return serial ? (serialMap.get(serial) || null) : null;
}

/**
 * Score how well a transaction matches an order contextually (delivery person, time).
 * Higher is better. Used for tiebreaking.
 */
function contextScore(
  tx: TransactionForMatching,
  order: OrderForMatching,
  serialMap: Map<string, string>
): number {
  let score = 0;

  // Delivery person match via serial
  const inferred = inferDeliveryPerson(tx.machine_serial, serialMap);
  if (inferred && order.delivery_person) {
    if (inferred.trim().toLowerCase() === order.delivery_person.trim().toLowerCase()) {
      score += 3; // strong signal
    } else {
      score -= 1; // mismatch penalty
    }
  }

  // Time proximity
  const txMin = parseTimeToMinutes(tx.sale_time);
  const orderMin = parseTimeToMinutes(order.sale_time || '');
  if (txMin >= 0 && orderMin >= 0) {
    const diff = Math.abs(txMin - orderMin);
    if (diff <= 15) score += 2;
    else if (diff <= 30) score += 1;
    else if (diff > 120) score -= 1;
  }

  return score;
}

/**
 * Main matching algorithm with orphan recovery and strict approximate rules.
 */
export function matchTransactionsToOrders(
  transactions: TransactionForMatching[],
  orders: OrderForMatching[],
  existingMatches: Set<string>,
  breakdowns: BreakdownForMatching[] = [],
  serialDeliveryMap?: Map<string, string>
): MatchResult[] {
  const results: MatchResult[] = [];
  const matchedTxIds = new Set<string>(existingMatches);
  const orderContexts = orders
    .map(order => ({ order, context: getDeliveryAutoMatchContext(order, breakdowns) }))
    .filter(({ context }) => context.profile.physicalMethods.length > 0);

  const matchedTargetIndexes = new Map<string, Set<number>>();
  const combinedMatchedOrders = new Set<string>();
  const serialMap = serialDeliveryMap || new Map<string, string>();

  const isOrderFullyMatched = (orderId: string) => {
    const orderContext = orderContexts.find(({ order }) => order.id === orderId)?.context;
    if (!orderContext) return true;
    if (combinedMatchedOrders.has(orderId)) return true;
    if (orderContext.exactTargets.length === 0) return false;
    return (matchedTargetIndexes.get(orderId)?.size || 0) >= orderContext.exactTargets.length;
  };

  // ═══════════════════════════════════════════════════════════
  // Phase 1: Exact 1:1 matches with hard method block + context tiebreaker
  // ═══════════════════════════════════════════════════════════
  // Build candidate map: for each (orderIndex, targetIndex), find all exact-compatible txs
  interface ExactCandidate {
    tx: TransactionForMatching;
    orderIdx: number;
    targetIdx: number;
    ctxScore: number;
  }

  const exactCandidates: ExactCandidate[] = [];

  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;
    for (let oi = 0; oi < orderContexts.length; oi++) {
      const { order, context } = orderContexts[oi];
      if (context.isStructuralPending || context.exactTargets.length === 0 || isOrderFullyMatched(order.id)) continue;
      if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) continue;

      for (let ti = 0; ti < context.exactTargets.length; ti++) {
        const target = context.exactTargets[ti];
        if (!isTransactionMethodCompatible(tx.payment_method, target.method)) continue;
        if (Math.abs(tx.gross_amount - target.amount) >= 0.01) continue;
        exactCandidates.push({ tx, orderIdx: oi, targetIdx: ti, ctxScore: contextScore(tx, order, serialMap) });
      }
    }
  }

  // Sort by context score descending so best matches go first
  exactCandidates.sort((a, b) => b.ctxScore - a.ctxScore);

  for (const candidate of exactCandidates) {
    if (matchedTxIds.has(candidate.tx.id)) continue;
    const { order } = orderContexts[candidate.orderIdx];
    if (isOrderFullyMatched(order.id)) continue;
    const usedTargets = matchedTargetIndexes.get(order.id) || new Set<number>();
    if (usedTargets.has(candidate.targetIdx)) continue;

    results.push({
      transactionId: candidate.tx.id,
      orderId: order.id,
      matchType: 'exact',
      confidence: 'high',
      amountDiff: 0,
    });

    matchedTxIds.add(candidate.tx.id);
    usedTargets.add(candidate.targetIdx);
    matchedTargetIndexes.set(order.id, usedTargets);
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 2: Combined exact matches (method-compatible)
  // ═══════════════════════════════════════════════════════════
  const COMBINED_TOLERANCE = 0.50;

  for (const { order, context } of orderContexts) {
    if (isOrderFullyMatched(order.id) || context.isStructuralPending || context.combinedTargetAmount === null) continue;

    const targetAmount = context.combinedTargetAmount;
    const remainingTxs = transactions.filter(tx => !matchedTxIds.has(tx.id));
    if (remainingTxs.length < 2) break;

    let bestPair: {
      tx1: TransactionForMatching;
      tx2: TransactionForMatching;
      confidence: 'high' | 'medium' | 'low';
      diff: number;
      score: number;
    } | null = null;

    for (let i = 0; i < remainingTxs.length; i++) {
      for (let j = i + 1; j < remainingTxs.length; j++) {
        const tx1 = remainingTxs[i];
        const tx2 = remainingTxs[j];
        const sum = tx1.gross_amount + tx2.gross_amount;
        const diff = Math.abs(sum - targetAmount);

        if (diff > COMBINED_TOLERANCE) continue;
        if (!canCoverExpectedMethods([tx1.payment_method, tx2.payment_method], context.expectedCombinedMethods)) continue;
        if (!isTransactionAfterOrder(tx1.sale_time, order.sale_time || null)) continue;
        if (!isTransactionAfterOrder(tx2.sale_time, order.sale_time || null)) continue;

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

        // Delivery person context
        score += contextScore(tx1, order, serialMap);
        score += contextScore(tx2, order, serialMap);

        const confidence: 'high' | 'medium' | 'low' = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';

        if (!bestPair || score > bestPair.score || (score === bestPair.score && diff < bestPair.diff)) {
          bestPair = { tx1, tx2, confidence, diff, score };
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
      combinedMatchedOrders.add(order.id);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 3: Orphan recovery — re-check unmatched orders for exact txs
  // that may have been freed by earlier phases or missed due to ordering
  // ═══════════════════════════════════════════════════════════
  for (const { order, context } of orderContexts) {
    if (isOrderFullyMatched(order.id) || context.isStructuralPending || context.exactTargets.length === 0) continue;

    const usedTargets = matchedTargetIndexes.get(order.id) || new Set<number>();

    for (let ti = 0; ti < context.exactTargets.length; ti++) {
      if (usedTargets.has(ti)) continue;
      const target = context.exactTargets[ti];

      // Find best available exact tx with context tiebreaker
      let bestTx: TransactionForMatching | null = null;
      let bestScore = -Infinity;

      for (const tx of transactions) {
        if (matchedTxIds.has(tx.id)) continue;
        if (!isTransactionMethodCompatible(tx.payment_method, target.method)) continue;
        if (Math.abs(tx.gross_amount - target.amount) >= 0.01) continue;
        if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) continue;

        const score = contextScore(tx, order, serialMap);
        if (!bestTx || score > bestScore) {
          bestTx = tx;
          bestScore = score;
        }
      }

      if (bestTx) {
        results.push({
          transactionId: bestTx.id,
          orderId: order.id,
          matchType: 'exact',
          confidence: 'high',
          amountDiff: 0,
        });
        matchedTxIds.add(bestTx.id);
        usedTargets.add(ti);
        matchedTargetIndexes.set(order.id, usedTargets);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 4: Strict approximate matching — only when all criteria align
  // ═══════════════════════════════════════════════════════════
  const APPROX_STRONG = 0.20;
  const APPROX_MAX = 0.50;

  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;

    let bestMatch: {
      order: OrderForMatching;
      targetIndex: number;
      diff: number;
      confidence: 'medium' | 'low';
      totalScore: number;
    } | null = null;

    for (const { order, context } of orderContexts) {
      if (context.isStructuralPending || !context.allowsApproximate || isOrderFullyMatched(order.id)) continue;
      if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) continue;

      const usedTargets = matchedTargetIndexes.get(order.id) || new Set<number>();

      for (let ti = 0; ti < context.exactTargets.length; ti++) {
        if (usedTargets.has(ti)) continue;
        const target = context.exactTargets[ti];
        if (!isTransactionMethodCompatible(tx.payment_method, target.method)) continue;

        const diff = Math.abs(tx.gross_amount - target.amount);
        if (diff < 0.01 || diff > APPROX_MAX) continue;

        const ctxSc = contextScore(tx, order, serialMap);

        // For diffs > APPROX_STRONG, require strong context (delivery person + time)
        if (diff > APPROX_STRONG && ctxSc < 3) continue;

        const totalScore = ctxSc * 100 - diff * 1000; // context dominates, then diff

        const confidence: 'medium' | 'low' = diff <= APPROX_STRONG ? 'medium' : 'low';

        if (!bestMatch || totalScore > bestMatch.totalScore) {
          bestMatch = { order, targetIndex: ti, diff, confidence, totalScore };
        }
      }
    }

    if (bestMatch) {
      results.push({
        transactionId: tx.id,
        orderId: bestMatch.order.id,
        matchType: 'approximate',
        confidence: bestMatch.confidence,
        amountDiff: bestMatch.diff,
      });
      matchedTxIds.add(tx.id);
      const usedTargets = matchedTargetIndexes.get(bestMatch.order.id) || new Set<number>();
      usedTargets.add(bestMatch.targetIndex);
      matchedTargetIndexes.set(bestMatch.order.id, usedTargets);
    }
  }

  return results;
}
