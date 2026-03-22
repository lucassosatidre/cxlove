/**
 * Delivery reconciliation matching algorithm.
 * Matches card machine transactions to imported orders.
 */

import {
  canCoverExpectedMethods,
  getDeliveryAutoMatchContext,
  isTransactionMethodCompatible,
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
  const orderContexts = orders
    .map(order => ({ order, context: getDeliveryAutoMatchContext(order, breakdowns) }))
    .filter(({ context }) => context.profile.physicalMethods.length > 0);

  const matchedTargetIndexes = new Map<string, Set<number>>();
  const combinedMatchedOrders = new Set<string>();

  const isOrderFullyMatched = (orderId: string) => {
    const orderContext = orderContexts.find(({ order }) => order.id === orderId)?.context;
    if (!orderContext) return true;
    if (combinedMatchedOrders.has(orderId)) return true;
    if (orderContext.exactTargets.length === 0) return false;
    return (matchedTargetIndexes.get(orderId)?.size || 0) >= orderContext.exactTargets.length;
  };

  // Phase 1: exact 1:1 matches with hard method compatibility block
  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;

    for (const { order, context } of orderContexts) {
      if (context.isStructuralPending || context.exactTargets.length === 0 || isOrderFullyMatched(order.id)) continue;
      if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) continue;

      const usedTargets = matchedTargetIndexes.get(order.id) || new Set<number>();

      for (let i = 0; i < context.exactTargets.length; i++) {
        if (usedTargets.has(i)) continue;
        const target = context.exactTargets[i];
        if (!isTransactionMethodCompatible(tx.payment_method, target.method)) continue;
        if (Math.abs(tx.gross_amount - target.amount) >= 0.01) continue;

        results.push({
          transactionId: tx.id,
          orderId: order.id,
          matchType: 'exact',
          confidence: 'high',
          amountDiff: 0,
        });

        matchedTxIds.add(tx.id);
        usedTargets.add(i);
        matchedTargetIndexes.set(order.id, usedTargets);
        break;
      }

      if (matchedTxIds.has(tx.id)) break;
    }
  }

  // Phase 2: approximate only when the method is compatible and there is no structural ambiguity
  const TOLERANCE = 0.5;

  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;

    let bestMatch: { order: OrderForMatching; targetIndex: number; diff: number; confidence: 'medium' | 'low'; candidateCount: number } | null = null;

    for (const { order, context } of orderContexts) {
      if (context.isStructuralPending || !context.allowsApproximate || isOrderFullyMatched(order.id)) continue;
      if (!isTransactionAfterOrder(tx.sale_time, order.sale_time)) continue;

      const usedTargets = matchedTargetIndexes.get(order.id) || new Set<number>();
      const candidates = context.exactTargets
        .map((target, targetIndex) => ({ target, targetIndex }))
        .filter(({ target, targetIndex }) => {
          if (usedTargets.has(targetIndex)) return false;
          if (!isTransactionMethodCompatible(tx.payment_method, target.method)) return false;
          const diff = Math.abs(tx.gross_amount - target.amount);
          return diff > 0 && diff <= TOLERANCE;
        });

      if (candidates.length === 0) continue;

      for (const { target, targetIndex } of candidates) {
        const diff = Math.abs(tx.gross_amount - target.amount);
        const confidence: 'medium' | 'low' = candidates.length > 1 ? 'low' : 'medium';

        if (!bestMatch || diff < bestMatch.diff) {
          bestMatch = { order, targetIndex, diff, confidence, candidateCount: candidates.length };
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

  // Phase 3: combined exact matches only when the expected method structure is also respected
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
    } | null = null;

    for (let i = 0; i < remainingTxs.length; i++) {
      for (let j = i + 1; j < remainingTxs.length; j++) {
        const tx1 = remainingTxs[i];
        const tx2 = remainingTxs[j];
        const sum = tx1.gross_amount + tx2.gross_amount;
        const diff = Math.abs(sum - targetAmount);

        if (diff > COMBINED_TOLERANCE) continue;
        if (!canCoverExpectedMethods([tx1.payment_method, tx2.payment_method], context.expectedCombinedMethods)) continue;

        // Both transactions must be after order time
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
      combinedMatchedOrders.add(order.id);
    }
  }

  return results;
}
