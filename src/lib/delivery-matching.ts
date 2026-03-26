/**
 * Delivery reconciliation matching algorithm.
 * Global allocation approach: associates sales to transactions first,
 * then flags method/structure divergences instead of blocking.
 */

import {
  getDeliveryAutoMatchContext,
  isTransactionMethodCompatible,
  normalizeDeliveryMethod,
  NormalizedDeliveryMethod,
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

export type MatchType =
  | 'exact'                     // value + method + context match
  | 'exact_method_divergence'   // value + context match, method differs
  | 'combined'                  // multiple txs, methods match
  | 'combined_undeclared'       // multiple txs sum exactly, no split declared in Saipos
  | 'exact_structure_divergence' // Saipos says multiple methods, but single tx matches exactly
  | 'approximate'               // small value difference
  | 'manual';

export interface MatchResult {
  transactionId: string;
  orderId: string;
  matchType: MatchType;
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
      if (count > maxCount) { maxCount = count; bestPerson = person; }
    }
    if (bestPerson) result.set(serial, bestPerson);
  }
  return result;
}

function inferDeliveryPerson(serial: string, serialMap: Map<string, string>): string | null {
  return serial ? (serialMap.get(serial) || null) : null;
}

/**
 * Context score for tiebreaking. Higher = better.
 */
function contextScore(
  tx: TransactionForMatching,
  order: OrderForMatching,
  serialMap: Map<string, string>
): number {
  let score = 0;
  const inferred = inferDeliveryPerson(tx.machine_serial, serialMap);
  if (inferred && order.delivery_person) {
    if (inferred.trim().toLowerCase() === order.delivery_person.trim().toLowerCase()) {
      score += 3;
    } else {
      score -= 1;
    }
  }
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
 * Check if tx method matches the expected method (no divergence).
 */
function isMethodMatch(txMethod: string, expectedMethod: NormalizedDeliveryMethod): boolean {
  return normalizeDeliveryMethod(txMethod) === expectedMethod;
}

/**
 * Main matching algorithm with global allocation approach.
 * Method is NOT a hard block — divergences are flagged, not blocked.
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
  // Phase 1: Exact value matches — method-compatible first (best quality)
  // ═══════════════════════════════════════════════════════════
  interface ExactCandidate {
    tx: TransactionForMatching;
    orderIdx: number;
    targetIdx: number;
    ctxScore: number;
    methodMatches: boolean;
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
        if (Math.abs(tx.gross_amount - target.amount) >= 0.01) continue;

        const methodMatches = isMethodMatch(tx.payment_method, target.method);
        exactCandidates.push({
          tx, orderIdx: oi, targetIdx: ti,
          ctxScore: contextScore(tx, order, serialMap),
          methodMatches,
        });
      }
    }
  }

  // Sort: method-compatible first, then by context score
  exactCandidates.sort((a, b) => {
    if (a.methodMatches !== b.methodMatches) return a.methodMatches ? -1 : 1;
    return b.ctxScore - a.ctxScore;
  });

  for (const candidate of exactCandidates) {
    if (matchedTxIds.has(candidate.tx.id)) continue;
    const { order } = orderContexts[candidate.orderIdx];
    if (isOrderFullyMatched(order.id)) continue;
    const usedTargets = matchedTargetIndexes.get(order.id) || new Set<number>();
    if (usedTargets.has(candidate.targetIdx)) continue;

    // For method-divergent matches, require minimum context score
    if (!candidate.methodMatches && candidate.ctxScore < 0) continue;

    const matchType: MatchType = candidate.methodMatches ? 'exact' : 'exact_method_divergence';
    const confidence: 'high' | 'medium' = candidate.methodMatches ? 'high' : 'medium';

    results.push({
      transactionId: candidate.tx.id,
      orderId: order.id,
      matchType,
      confidence,
      amountDiff: 0,
    });

    matchedTxIds.add(candidate.tx.id);
    usedTargets.add(candidate.targetIdx);
    matchedTargetIndexes.set(order.id, usedTargets);
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 2: Combined matches (declared multi-method in Saipos)
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
        if (!isTransactionAfterOrder(tx1.sale_time, order.sale_time || null)) continue;
        if (!isTransactionAfterOrder(tx2.sale_time, order.sale_time || null)) continue;

        let score = 0;
        if (tx1.machine_serial && tx1.machine_serial === tx2.machine_serial) score += 2;
        const tx1Min = parseTimeToMinutes(tx1.sale_time);
        const tx2Min = parseTimeToMinutes(tx2.sale_time);
        if (tx1Min >= 0 && tx2Min >= 0 && Math.abs(tx1Min - tx2Min) <= 10) score++;
        score += contextScore(tx1, order, serialMap);
        score += contextScore(tx2, order, serialMap);

        if (!bestPair || score > bestPair.score || (score === bestPair.score && diff < bestPair.diff)) {
          bestPair = { tx1, tx2, diff, score };
        }
      }
    }

    if (bestPair) {
      const confidence: 'high' | 'medium' | 'low' = bestPair.score >= 4 ? 'high' : bestPair.score >= 2 ? 'medium' : 'low';
      results.push({
        transactionId: bestPair.tx1.id, orderId: order.id,
        matchType: 'combined', confidence, amountDiff: bestPair.diff,
        combinedWithTransactionId: bestPair.tx2.id,
      });
      results.push({
        transactionId: bestPair.tx2.id, orderId: order.id,
        matchType: 'combined', confidence, amountDiff: bestPair.diff,
        combinedWithTransactionId: bestPair.tx1.id,
      });
      matchedTxIds.add(bestPair.tx1.id);
      matchedTxIds.add(bestPair.tx2.id);
      combinedMatchedOrders.add(order.id);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 3: Undeclared combined — order has single method in Saipos
  //          but 2-3 txs from same serial sum exactly
  // ═══════════════════════════════════════════════════════════
  for (const { order, context } of orderContexts) {
    if (isOrderFullyMatched(order.id) || context.isStructuralPending) continue;
    // Only for orders with single-method that weren't matched yet
    if (context.exactTargets.length !== 1) continue;
    const target = context.exactTargets[0];
    const usedTargets = matchedTargetIndexes.get(order.id) || new Set<number>();
    if (usedTargets.has(0)) continue;

    const remainingTxs = transactions.filter(tx => !matchedTxIds.has(tx.id));

    // Try 2-tx combinations
    let bestCombo: { txs: TransactionForMatching[]; diff: number; score: number } | null = null;

    for (let i = 0; i < remainingTxs.length; i++) {
      for (let j = i + 1; j < remainingTxs.length; j++) {
        const tx1 = remainingTxs[i];
        const tx2 = remainingTxs[j];
        const sum = tx1.gross_amount + tx2.gross_amount;
        const diff = Math.abs(sum - target.amount);
        if (diff > 0.01) continue;
        if (!isTransactionAfterOrder(tx1.sale_time, order.sale_time || null)) continue;
        if (!isTransactionAfterOrder(tx2.sale_time, order.sale_time || null)) continue;

        let score = 0;
        if (tx1.machine_serial && tx1.machine_serial === tx2.machine_serial) score += 3;
        const tx1Min = parseTimeToMinutes(tx1.sale_time);
        const tx2Min = parseTimeToMinutes(tx2.sale_time);
        if (tx1Min >= 0 && tx2Min >= 0 && Math.abs(tx1Min - tx2Min) <= 10) score += 2;
        score += contextScore(tx1, order, serialMap);
        score += contextScore(tx2, order, serialMap);

        // Require strong context for undeclared combined
        if (score < 3) continue;

        if (!bestCombo || score > bestCombo.score) {
          bestCombo = { txs: [tx1, tx2], diff, score };
        }
      }
    }

    // Try 3-tx combinations
    for (let i = 0; i < remainingTxs.length && !bestCombo; i++) {
      for (let j = i + 1; j < remainingTxs.length; j++) {
        for (let k = j + 1; k < remainingTxs.length; k++) {
          const txs = [remainingTxs[i], remainingTxs[j], remainingTxs[k]];
          const sum = txs.reduce((s, t) => s + t.gross_amount, 0);
          const diff = Math.abs(sum - target.amount);
          if (diff > 0.01) continue;
          if (txs.some(t => !isTransactionAfterOrder(t.sale_time, order.sale_time || null))) continue;

          const serials = new Set(txs.map(t => t.machine_serial).filter(Boolean));
          let score = serials.size === 1 ? 4 : 0;
          txs.forEach(t => { score += contextScore(t, order, serialMap); });

          if (score < 4) continue;

          if (!bestCombo || score > bestCombo.score) {
            bestCombo = { txs, diff, score };
          }
        }
      }
    }

    if (bestCombo) {
      const confidence: 'high' | 'medium' = bestCombo.score >= 6 ? 'high' : 'medium';
      for (let i = 0; i < bestCombo.txs.length; i++) {
        const tx = bestCombo.txs[i];
        const otherIds = bestCombo.txs.filter((_, j) => j !== i).map(t => t.id);
        results.push({
          transactionId: tx.id, orderId: order.id,
          matchType: 'combined_undeclared', confidence, amountDiff: bestCombo.diff,
          combinedWithTransactionId: otherIds[0],
        });
        matchedTxIds.add(tx.id);
      }
      combinedMatchedOrders.add(order.id);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 4: Structure divergence — Saipos says multi-method,
  //          but a single tx matches exactly
  // ═══════════════════════════════════════════════════════════
  for (const { order, context } of orderContexts) {
    if (isOrderFullyMatched(order.id) || context.isStructuralPending) continue;
    // Only for orders with multiple physical methods (multi-split declared)
    if (context.profile.physicalMethods.length <= 1) continue;
    if (context.combinedTargetAmount === null) continue;

    const targetAmount = context.combinedTargetAmount;

    let bestTx: TransactionForMatching | null = null;
    let bestScore = -Infinity;

    for (const tx of transactions) {
      if (matchedTxIds.has(tx.id)) continue;
      if (Math.abs(tx.gross_amount - targetAmount) >= 0.01) continue;
      if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) continue;

      const score = contextScore(tx, order, serialMap);
      if (score < 1) continue; // require some context support

      if (score > bestScore) { bestTx = tx; bestScore = score; }
    }

    if (bestTx) {
      results.push({
        transactionId: bestTx.id, orderId: order.id,
        matchType: 'exact_structure_divergence',
        confidence: 'medium', amountDiff: 0,
      });
      matchedTxIds.add(bestTx.id);
      combinedMatchedOrders.add(order.id);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 5: Orphan recovery — re-check unmatched for exact values
  // ═══════════════════════════════════════════════════════════
  for (const { order, context } of orderContexts) {
    if (isOrderFullyMatched(order.id) || context.isStructuralPending || context.exactTargets.length === 0) continue;
    const usedTargets = matchedTargetIndexes.get(order.id) || new Set<number>();

    for (let ti = 0; ti < context.exactTargets.length; ti++) {
      if (usedTargets.has(ti)) continue;
      const target = context.exactTargets[ti];

      let bestTx: TransactionForMatching | null = null;
      let bestScore = -Infinity;
      let bestMethodMatch = false;

      for (const tx of transactions) {
        if (matchedTxIds.has(tx.id)) continue;
        if (Math.abs(tx.gross_amount - target.amount) >= 0.01) continue;
        if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) continue;

        const methodOk = isMethodMatch(tx.payment_method, target.method);
        const score = contextScore(tx, order, serialMap) + (methodOk ? 10 : 0);

        if (!bestTx || score > bestScore) {
          bestTx = tx; bestScore = score; bestMethodMatch = methodOk;
        }
      }

      if (bestTx && (bestMethodMatch || bestScore >= 2)) {
        const matchType: MatchType = bestMethodMatch ? 'exact' : 'exact_method_divergence';
        results.push({
          transactionId: bestTx.id, orderId: order.id,
          matchType, confidence: bestMethodMatch ? 'high' : 'medium', amountDiff: 0,
        });
        matchedTxIds.add(bestTx.id);
        usedTargets.add(ti);
        matchedTargetIndexes.set(order.id, usedTargets);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 6: Strict approximate matching
  // ═══════════════════════════════════════════════════════════
  const APPROX_STRONG = 0.50;
  const APPROX_MAX = 1.00;

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

        const diff = Math.abs(tx.gross_amount - target.amount);
        if (diff < 0.01 || diff > APPROX_MAX) continue;

        const ctxSc = contextScore(tx, order, serialMap);
        if (diff > APPROX_STRONG && ctxSc < 3) continue;

        const methodBonus = isMethodMatch(tx.payment_method, target.method) ? 5 : 0;
        const totalScore = (ctxSc + methodBonus) * 100 - diff * 1000;

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
