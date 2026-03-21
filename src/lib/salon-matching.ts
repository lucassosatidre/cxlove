/**
 * Salon reconciliation matching algorithm v4.
 *
 * KEY CHANGES:
 * - Orders paid entirely with "Dinheiro" or online-only (e.g., "Pix Online Brendi") are
 *   classified as EXTERNAL and excluded from machine reconciliation.
 * - For mixed orders (e.g., "Crédito, Dinheiro"), only the card portion is matched.
 * - The payment_method string from Saipos defines expected card line count.
 * - Multiple target amounts are tested: total, total + discount.
 * - Groups are locked (reserved) before individual consumption.
 * - Approximate matches have a small tolerance for pickup/counter orders.
 * - Each unmatched order gets a pending reason.
 */

export interface SalonMatchResult {
  transactionId: string;
  orderId: string;
  matchType: 'exact' | 'approximate' | 'combined' | 'combined_mixed';
  confidence: 'high' | 'medium' | 'low';
  amountDiff: number;
  combinedWithTransactionId?: string;
  matchReason?: string;
}

export type PendingReason =
  | 'external_cash'
  | 'external_online'
  | 'mixed_partial'
  | 'awaiting_group_2'
  | 'awaiting_group_3'
  | 'awaiting_group_4'
  | 'approx_possible'
  | 'divergence'
  | null;

export interface OrderClassification {
  orderId: string;
  isExternal: boolean;
  externalReason: 'cash' | 'online' | null;
  isMixed: boolean;
  expectedCardLines: number;
  cardMethods: string[];
  externalMethods: string[];
  pendingReason: PendingReason;
}

interface SalonOrderForMatching {
  id: string;
  order_type: string;
  total_amount: number;
  discount_amount: number;
  sale_time: string | null;
  payment_method: string;
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

// ─── Payment classification helpers ───

const EXTERNAL_KEYWORDS = ['dinheiro'];
const ONLINE_KEYWORDS = ['online', 'brendi', 'voucher parceiro', 'anotaai'];

function isExternalMethod(method: string): boolean {
  const lower = method.toLowerCase().trim();
  if (EXTERNAL_KEYWORDS.some(kw => lower.includes(kw))) return true;
  if (ONLINE_KEYWORDS.some(kw => lower.includes(kw))) return true;
  return false;
}

function isCashMethod(method: string): boolean {
  return method.toLowerCase().trim().includes('dinheiro');
}

function isOnlineExternalMethod(method: string): boolean {
  const lower = method.toLowerCase().trim();
  return ONLINE_KEYWORDS.some(kw => lower.includes(kw));
}

function splitMethods(paymentMethod: string): string[] {
  return paymentMethod.split(',').map(s => s.trim()).filter(Boolean);
}

export function classifyOrder(order: SalonOrderForMatching): OrderClassification {
  const methods = splitMethods(order.payment_method);
  const cardMethods = methods.filter(m => !isExternalMethod(m));
  const externalMethods = methods.filter(m => isExternalMethod(m));

  if (cardMethods.length === 0) {
    const allCash = externalMethods.every(m => isCashMethod(m));
    return {
      orderId: order.id,
      isExternal: true,
      externalReason: allCash ? 'cash' : 'online',
      isMixed: false,
      expectedCardLines: 0,
      cardMethods: [],
      externalMethods,
      pendingReason: allCash ? 'external_cash' : 'external_online',
    };
  }

  const isMixed = externalMethods.length > 0;
  return {
    orderId: order.id,
    isExternal: false,
    externalReason: null,
    isMixed,
    expectedCardLines: cardMethods.length,
    cardMethods,
    externalMethods,
    pendingReason: null,
  };
}

// ─── Time helpers ───

function parseTimeToMinutes(time: string): number {
  if (!time) return -1;
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return -1;
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

function timeGapMinutes(txTime: string, orderTime: string | null): number {
  if (!orderTime) return -1;
  const txMin = parseTimeToMinutes(txTime);
  const oMin = parseTimeToMinutes(orderTime);
  if (txMin < 0 || oMin < 0) return -1;
  return txMin - oMin;
}

// ─── Target amount helpers ───

function getTargetAmounts(order: SalonOrderForMatching, classification: OrderClassification): number[] {
  const targets: number[] = [];
  const total = order.total_amount;

  if (classification.isMixed) {
    // For mixed orders, add both total and estimated card-only portion
    targets.push(total);
    if (order.discount_amount > 0.01) {
      targets.push(Math.round((total + order.discount_amount) * 100) / 100);
    }
    // Add estimated card portion: total * (cardLines / totalMethods)
    const totalMethods = classification.cardMethods.length + classification.externalMethods.length;
    if (totalMethods > 0 && classification.expectedCardLines < totalMethods) {
      const cardPortion = Math.round((total * classification.expectedCardLines / totalMethods) * 100) / 100;
      targets.push(cardPortion);
      if (order.discount_amount > 0.01) {
        const totalWithDiscount = total + order.discount_amount;
        targets.push(Math.round((totalWithDiscount * classification.expectedCardLines / totalMethods) * 100) / 100);
      }
    }
  } else {
    targets.push(total);
    if (order.discount_amount > 0.01) {
      targets.push(Math.round((total + order.discount_amount) * 100) / 100);
    }
  }

  return targets;
}

// ─── Main algorithm ───

export function matchSalonTransactionsToOrders(
  transactions: TxForMatching[],
  orders: SalonOrderForMatching[],
  _payments: SalonPaymentForMatching[],
  existingMatches: Set<string>
): { results: SalonMatchResult[]; classifications: Map<string, OrderClassification> } {
  const results: SalonMatchResult[] = [];
  const matchedTxIds = new Set<string>(existingMatches);
  const matchedOrderIds = new Set<string>();
  const classifications = new Map<string, OrderClassification>();

  // Step 0: Classify all orders
  for (const order of orders) {
    const cls = classifyOrder(order);
    classifications.set(order.id, cls);
  }

  // External orders are already "resolved" - they don't need machine matching
  const machineOrders = orders.filter(o => {
    const cls = classifications.get(o.id)!;
    return !cls.isExternal;
  });

  // ═══════════════════════════════════════════
  // PHASE 1: Exact 1:1 matches (single transaction = single target amount)
  // Try all target amounts (total, total+discount)
  // ═══════════════════════════════════════════

  interface ExactCandidate {
    tx: TxForMatching;
    order: SalonOrderForMatching;
    targetAmount: number;
    gap: number;
    isDiscountMatch: boolean;
  }

  const exactCandidates: ExactCandidate[] = [];

  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;
    for (const order of machineOrders) {
      if (matchedOrderIds.has(order.id)) continue;
      const cls = classifications.get(order.id)!;

      // For mixed orders with expected 1 card line, allow partial match
      // For non-mixed, match against target amounts
      const targets = getTargetAmounts(order, cls);
      const expectedLines = cls.expectedCardLines;

      if (expectedLines === 1 || expectedLines === 0) {
        for (const target of targets) {
          if (Math.abs(tx.gross_amount - target) < 0.01) {
            const gap = timeGapMinutes(tx.sale_time, order.sale_time);
            exactCandidates.push({
              tx, order, targetAmount: target,
              gap: gap >= 0 ? gap : 999,
              isDiscountMatch: Math.abs(target - order.total_amount) > 0.01,
            });
          }
        }

        // For mixed orders, also accept any single card transaction (partial match)
        if (cls.isMixed && expectedLines === 1) {
          // Don't add again if already matched above
          const alreadyAdded = targets.some(t => Math.abs(tx.gross_amount - t) < 0.01);
          if (!alreadyAdded && tx.gross_amount < order.total_amount) {
            // This could be a partial card payment; we don't add it as exact but as approx later
          }
        }
      }
    }
  }

  // Count uniqueness
  const txExactCount = new Map<string, number>();
  const orderExactCount = new Map<string, number>();
  for (const c of exactCandidates) {
    txExactCount.set(c.tx.id, (txExactCount.get(c.tx.id) || 0) + 1);
    orderExactCount.set(c.order.id, (orderExactCount.get(c.order.id) || 0) + 1);
  }

  // Sort: unique first, then by time
  exactCandidates.sort((a, b) => {
    const aUnique = Math.min(txExactCount.get(a.tx.id) || 99, orderExactCount.get(a.order.id) || 99);
    const bUnique = Math.min(txExactCount.get(b.tx.id) || 99, orderExactCount.get(b.order.id) || 99);
    if (aUnique !== bUnique) return aUnique - bUnique;
    // Prefer non-discount match first
    if (a.isDiscountMatch !== b.isDiscountMatch) return a.isDiscountMatch ? 1 : -1;
    return a.gap - b.gap;
  });

  for (const c of exactCandidates) {
    if (matchedTxIds.has(c.tx.id) || matchedOrderIds.has(c.order.id)) continue;

    const cls = classifications.get(c.order.id)!;
    // Only consume if expectedCardLines <= 1
    if (cls.expectedCardLines > 1) continue;

    const isUnique = (txExactCount.get(c.tx.id) || 0) === 1 || (orderExactCount.get(c.order.id) || 0) === 1;
    const confidence: 'high' | 'medium' = isUnique || c.gap < 120 ? 'high' : 'medium';

    const reasonParts: string[] = ['valor idêntico'];
    if (c.isDiscountMatch) reasonParts.push('total + desconto');
    if (c.gap < 999) reasonParts.push(`${c.gap}min após pedido`);
    if (isUnique) reasonParts.push('único candidato');
    if (cls.isMixed) reasonParts.push('pgto misto (parte cartão)');

    results.push({
      transactionId: c.tx.id,
      orderId: c.order.id,
      matchType: 'exact',
      confidence,
      amountDiff: 0,
      matchReason: `Match exato: ${reasonParts.join(', ')}`,
    });
    matchedTxIds.add(c.tx.id);
    matchedOrderIds.add(c.order.id);
  }

  // ═══════════════════════════════════════════
  // PHASE 2: Locked group matches
  // Use expectedCardLines from payment_method to find exact groups
  // e.g., "Crédito, Débito, Débito" → find 3 txs summing to target
  // ═══════════════════════════════════════════

  const COMBINED_TOLERANCE = 0.50;

  // Sort by expectedCardLines ascending (2 first, then 3, then 4)
  const groupOrders = machineOrders
    .filter(o => !matchedOrderIds.has(o.id))
    .filter(o => {
      const cls = classifications.get(o.id)!;
      return cls.expectedCardLines >= 2;
    })
    .sort((a, b) => {
      const ca = classifications.get(a.id)!.expectedCardLines;
      const cb = classifications.get(b.id)!.expectedCardLines;
      return ca - cb;
    });

  for (const order of groupOrders) {
    if (matchedOrderIds.has(order.id)) continue;
    const cls = classifications.get(order.id)!;
    const expectedLines = cls.expectedCardLines;
    const targets = getTargetAmounts(order, cls);

    const remainingTxs = transactions.filter(tx => !matchedTxIds.has(tx.id));
    if (remainingTxs.length < expectedLines) continue;

    let bestMatch: { txs: TxForMatching[]; diff: number; target: number; sameWaiter: boolean; reason: string } | null = null;

    for (const target of targets) {
      // Group by waiter first
      const txsByWaiter = new Map<string, TxForMatching[]>();
      for (const tx of remainingTxs) {
        const key = tx.machine_serial || '__none__';
        const arr = txsByWaiter.get(key) || [];
        arr.push(tx);
        txsByWaiter.set(key, arr);
      }

      // Try same-waiter groups first
      for (const [serial, waiterTxs] of txsByWaiter) {
        if (serial === '__none__' || waiterTxs.length < expectedLines) continue;
        const combo = findExactGroup(waiterTxs, expectedLines, target, COMBINED_TOLERANCE);
        if (combo && (!bestMatch || combo.diff < bestMatch.diff)) {
          const isDiscountMatch = Math.abs(target - order.total_amount) > 0.01;
          const isMixedPartial = cls.isMixed && target < order.total_amount;
          bestMatch = {
            txs: combo.txs, diff: combo.diff, target, sameWaiter: true,
            reason: isMixedPartial
              ? `Match combinado misto: ${expectedLines} transações cartão, mesmo garçom, parte dinheiro separada, diff ${combo.diff < 0.01 ? 'zero' : `R$${combo.diff.toFixed(2)}`}`
              : `Match combinado: ${expectedLines} transações, mesmo garçom, soma ${combo.diff < 0.01 ? 'exata' : `≈ R$${combo.diff.toFixed(2)}`}${isDiscountMatch ? ', total + desconto' : ''}`,
          };
        }
      }

      // Try all remaining if no same-waiter match
      if (!bestMatch) {
        const combo = findExactGroup(remainingTxs, expectedLines, target, COMBINED_TOLERANCE);
        if (combo) {
          const isDiscountMatch = Math.abs(target - order.total_amount) > 0.01;
          const isMixedPartial = cls.isMixed && target < order.total_amount;
          bestMatch = {
            txs: combo.txs, diff: combo.diff, target, sameWaiter: false,
            reason: isMixedPartial
              ? `Match combinado misto: ${expectedLines} transações cartão, garçons diferentes, parte dinheiro separada, diff ${combo.diff < 0.01 ? 'zero' : `R$${combo.diff.toFixed(2)}`}`
              : `Match combinado: ${expectedLines} transações, garçons diferentes, soma ${combo.diff < 0.01 ? 'exata' : `≈ R$${combo.diff.toFixed(2)}`}${isDiscountMatch ? ', total + desconto' : ''}`,
          };
        }
      }
    }

    if (bestMatch) {
      const confidence: 'high' | 'medium' = bestMatch.sameWaiter && bestMatch.diff < 0.01 ? 'high' : 'medium';
      for (let t = 0; t < bestMatch.txs.length; t++) {
        const tx = bestMatch.txs[t];
        const combinedWith = bestMatch.txs.filter((_, idx) => idx !== t).map(x => x.id).join(',');
        results.push({
          transactionId: tx.id,
          orderId: order.id,
          matchType: 'combined',
          confidence,
          amountDiff: bestMatch.diff,
          combinedWithTransactionId: combinedWith,
          matchReason: bestMatch.reason,
        });
        matchedTxIds.add(tx.id);
      }
      matchedOrderIds.add(order.id);
    }
  }

  // ═══════════════════════════════════════════
  // PHASE 3: Remaining single-line orders that weren't matched in Phase 1
  // (orders with expectedCardLines=1 or 0 that didn't match exactly)
  // Try combined matches (rateio without Saipos hint)
  // ═══════════════════════════════════════════

  for (const order of machineOrders) {
    if (matchedOrderIds.has(order.id)) continue;
    const cls = classifications.get(order.id)!;
    const targets = getTargetAmounts(order, cls);

    const remainingTxs = transactions.filter(tx => !matchedTxIds.has(tx.id));
    if (remainingTxs.length < 2) continue;

    let bestMatch: { txs: TxForMatching[]; diff: number; target: number; sameWaiter: boolean; reason: string } | null = null;

    for (const target of targets) {
      // Try same-waiter groups first, sizes 2-5
      const txsByWaiter = new Map<string, TxForMatching[]>();
      for (const tx of remainingTxs) {
        const key = tx.machine_serial || '__none__';
        const arr = txsByWaiter.get(key) || [];
        arr.push(tx);
        txsByWaiter.set(key, arr);
      }

      for (const [serial, waiterTxs] of txsByWaiter) {
        if (serial === '__none__') continue;
        for (let size = 2; size <= Math.min(5, waiterTxs.length); size++) {
          const combo = findExactGroup(waiterTxs, size, target, COMBINED_TOLERANCE);
          if (combo && (!bestMatch || combo.diff < bestMatch.diff || (combo.diff === bestMatch.diff && !bestMatch.sameWaiter))) {
            const isDiscount = Math.abs(target - order.total_amount) > 0.01;
            bestMatch = {
              txs: combo.txs, diff: combo.diff, target, sameWaiter: true,
              reason: `Match combinado: soma de ${size} transações, mesmo garçom${isDiscount ? ', total + desconto' : ''}`,
            };
            if (combo.diff < 0.01) break; // exact sum found, don't try larger groups
          }
        }
        if (bestMatch && bestMatch.diff < 0.01 && bestMatch.sameWaiter) break;
      }

      // Try mixed-waiter if no same-waiter match
      if (!bestMatch || bestMatch.diff > 0.01) {
        for (let size = 2; size <= Math.min(5, remainingTxs.length); size++) {
          const combo = findExactGroup(remainingTxs, size, target, COMBINED_TOLERANCE);
          if (combo && (!bestMatch || combo.diff < bestMatch.diff)) {
            const isDiscount = Math.abs(target - order.total_amount) > 0.01;
            bestMatch = {
              txs: combo.txs, diff: combo.diff, target, sameWaiter: false,
              reason: `Match combinado: soma de ${size} transações, garçons diferentes${isDiscount ? ', total + desconto' : ''}`,
            };
            if (combo.diff < 0.01) break;
          }
        }
      }
    }

    if (bestMatch && bestMatch.diff < 0.01) {
      const confidence: 'high' | 'medium' = bestMatch.sameWaiter ? 'high' : 'medium';
      for (let t = 0; t < bestMatch.txs.length; t++) {
        const tx = bestMatch.txs[t];
        const combinedWith = bestMatch.txs.filter((_, idx) => idx !== t).map(x => x.id).join(',');
        results.push({
          transactionId: tx.id,
          orderId: order.id,
          matchType: 'combined',
          confidence,
          amountDiff: bestMatch.diff,
          combinedWithTransactionId: combinedWith,
          matchReason: bestMatch.reason,
        });
        matchedTxIds.add(tx.id);
      }
      matchedOrderIds.add(order.id);
    }
  }

  // ═══════════════════════════════════════════
  // PHASE 4: Approximate 1:1 matches (small tolerance)
  // For pickup/counter, use small tolerance when time is very close
  // ═══════════════════════════════════════════

  const APPROX_TOLERANCE = 1.00;

  for (const order of machineOrders) {
    if (matchedOrderIds.has(order.id)) continue;
    const cls = classifications.get(order.id)!;
    if (cls.expectedCardLines > 1) continue; // groups should have been handled above

    const targets = getTargetAmounts(order, cls);

    const candidates = transactions
      .filter(tx => !matchedTxIds.has(tx.id))
      .flatMap(tx => targets.map(target => ({
        tx,
        target,
        diff: Math.abs(tx.gross_amount - target),
        gap: timeGapMinutes(tx.sale_time, order.sale_time),
      })))
      .filter(c => c.diff > 0.009 && c.diff <= APPROX_TOLERANCE)
      .sort((a, b) => a.diff - b.diff);

    if (candidates.length >= 1) {
      const best = candidates[0];
      const isCloseTime = best.gap >= 0 && best.gap <= 5;
      const confidence: 'high' | 'medium' = isCloseTime && best.diff <= 0.10 ? 'high' : 'medium';

      results.push({
        transactionId: best.tx.id,
        orderId: order.id,
        matchType: 'approximate',
        confidence,
        amountDiff: best.diff,
        matchReason: `Match aproximado: diff R$${best.diff.toFixed(2)}${isCloseTime ? ', mesmo minuto' : ''}, ${candidates.length === 1 ? 'único candidato' : `melhor de ${candidates.length}`}`,
      });
      matchedTxIds.add(best.tx.id);
      matchedOrderIds.add(order.id);
    }
  }

  // ═══════════════════════════════════════════
  // PHASE 5: Forced resolution for remaining 1:1
  // ═══════════════════════════════════════════

  for (const order of machineOrders) {
    if (matchedOrderIds.has(order.id)) continue;
    const cls = classifications.get(order.id)!;
    if (cls.expectedCardLines > 1) continue;

    const targets = getTargetAmounts(order, cls);

    for (const target of targets) {
      const exactRemaining = transactions.filter(tx => {
        if (matchedTxIds.has(tx.id)) return false;
        return Math.abs(tx.gross_amount - target) < 0.01;
      });

      if (exactRemaining.length === 1) {
        const tx = exactRemaining[0];
        const isDiscount = Math.abs(target - order.total_amount) > 0.01;
        results.push({
          transactionId: tx.id,
          orderId: order.id,
          matchType: 'exact',
          confidence: 'high',
          amountDiff: 0,
          matchReason: `Match exato: único candidato disponível${isDiscount ? ', total + desconto' : ''}`,
        });
        matchedTxIds.add(tx.id);
        matchedOrderIds.add(order.id);
        break;
      }
    }
  }

  // Reverse: for each unmatched tx, check if only one order matches
  for (const tx of transactions) {
    if (matchedTxIds.has(tx.id)) continue;

    const candidateOrders = machineOrders.filter(order => {
      if (matchedOrderIds.has(order.id)) return false;
      const cls = classifications.get(order.id)!;
      if (cls.expectedCardLines > 1) return false;
      const targets = getTargetAmounts(order, cls);
      return targets.some(t => Math.abs(tx.gross_amount - t) < 0.01);
    });

    if (candidateOrders.length === 1) {
      const order = candidateOrders[0];
      const targets = getTargetAmounts(order, classifications.get(order.id)!);
      const isDiscount = !targets.some(t => Math.abs(t - order.total_amount) < 0.01 && Math.abs(tx.gross_amount - t) < 0.01);

      results.push({
        transactionId: tx.id,
        orderId: order.id,
        matchType: 'exact',
        confidence: 'high',
        amountDiff: 0,
        matchReason: `Match exato: única comanda compatível${isDiscount ? ', total + desconto' : ''}`,
      });
      matchedTxIds.add(tx.id);
      matchedOrderIds.add(order.id);
    }
  }

  // ═══════════════════════════════════════════
  // PHASE 6: Mixed orders — accept partial card match
  // For orders like "Crédito, Dinheiro" or "Crédito, Débito, Débito, Dinheiro"
  // The card sum will be LESS than total. The remainder is cash/external.
  // ═══════════════════════════════════════════

  const MIXED_TOLERANCE = 0.10; // tolerance for mixed orders with cash

  for (const order of machineOrders) {
    if (matchedOrderIds.has(order.id)) continue;
    const cls = classifications.get(order.id)!;
    if (!cls.isMixed) continue;

    const expectedCardLines = cls.expectedCardLines;
    const totalMethods = cls.cardMethods.length + cls.externalMethods.length;
    const remaining = transactions.filter(tx => !matchedTxIds.has(tx.id));

    if (expectedCardLines >= 2) {
      // Multi-card + cash: find N card transactions whose sum < total
      // Estimate card portion: total * (cardLines / totalMethods)
      const estimatedCardPortion = Math.round((order.total_amount * expectedCardLines / totalMethods) * 100) / 100;
      // Also try total + discount card portion
      const estimatedTargets = [estimatedCardPortion];
      if (order.discount_amount > 0.01) {
        const totalWithDiscount = order.total_amount + order.discount_amount;
        estimatedTargets.push(Math.round((totalWithDiscount * expectedCardLines / totalMethods) * 100) / 100);
      }

      let bestMatch: { txs: TxForMatching[]; diff: number; target: number; sameWaiter: boolean } | null = null;

      for (const cardTarget of estimatedTargets) {
        // Same-waiter first
        const txsByWaiter = new Map<string, TxForMatching[]>();
        for (const tx of remaining) {
          const key = tx.machine_serial || '__none__';
          const arr = txsByWaiter.get(key) || [];
          arr.push(tx);
          txsByWaiter.set(key, arr);
        }

        for (const [serial, waiterTxs] of txsByWaiter) {
          if (serial === '__none__' || waiterTxs.length < expectedCardLines) continue;
          const combo = findExactGroup(waiterTxs, expectedCardLines, cardTarget, MIXED_TOLERANCE);
          if (combo && (!bestMatch || combo.diff < bestMatch.diff)) {
            bestMatch = { txs: combo.txs, diff: combo.diff, target: cardTarget, sameWaiter: true };
          }
        }

        if (!bestMatch) {
          const combo = findExactGroup(remaining, expectedCardLines, cardTarget, MIXED_TOLERANCE);
          if (combo) {
            bestMatch = { txs: combo.txs, diff: combo.diff, target: cardTarget, sameWaiter: false };
          }
        }
      }

      if (bestMatch) {
        const cardSum = bestMatch.txs.reduce((s, t) => s + t.gross_amount, 0);
        const cashPortion = order.total_amount - cardSum;
        const confidence: 'high' | 'medium' = bestMatch.sameWaiter ? 'high' : 'medium';
        const reason = `Match combinado misto: ${expectedCardLines} transações cartão (${formatBRL(cardSum)}) + dinheiro (${formatBRL(cashPortion)}), diff ${formatBRL(bestMatch.diff)}`;

        for (let t = 0; t < bestMatch.txs.length; t++) {
          const tx = bestMatch.txs[t];
          const combinedWith = bestMatch.txs.filter((_, idx) => idx !== t).map(x => x.id).join(',');
          results.push({
            transactionId: tx.id,
            orderId: order.id,
            matchType: 'combined',
            confidence,
            amountDiff: bestMatch.diff,
            combinedWithTransactionId: combinedWith,
            matchReason: reason,
          });
          matchedTxIds.add(tx.id);
        }
        matchedOrderIds.add(order.id);
        continue;
      }
    }

    // Single card line + cash: accept a card tx < total
    if (expectedCardLines === 1) {
      const cardOnly = remaining.filter(tx => tx.gross_amount < order.total_amount);
      if (cardOnly.length === 0) continue;

      const scored = cardOnly.map(tx => ({
        tx,
        gap: timeGapMinutes(tx.sale_time, order.sale_time),
      })).filter(c => c.gap >= 0 && c.gap <= 120)
        .sort((a, b) => a.gap - b.gap);

      if (scored.length === 1) {
        const { tx, gap } = scored[0];
        results.push({
          transactionId: tx.id,
          orderId: order.id,
          matchType: 'approximate',
          confidence: 'medium',
          amountDiff: order.total_amount - tx.gross_amount,
          matchReason: `Match parcial misto: cartão ${formatBRL(tx.gross_amount)} + dinheiro/externo, ${gap}min após pedido`,
        });
        matchedTxIds.add(tx.id);
        matchedOrderIds.add(order.id);
      }
    }
  }

  // ═══════════════════════════════════════════
  // Set pending reasons for unmatched machine orders
  // ═══════════════════════════════════════════

  for (const order of machineOrders) {
    if (matchedOrderIds.has(order.id)) {
      continue;
    }
    const cls = classifications.get(order.id)!;
    const targets = getTargetAmounts(order, cls);
    const remaining = transactions.filter(tx => !matchedTxIds.has(tx.id));

    if (cls.isMixed) {
      cls.pendingReason = 'mixed_partial';
    } else if (cls.expectedCardLines >= 4) {
      cls.pendingReason = 'awaiting_group_4';
    } else if (cls.expectedCardLines === 3) {
      cls.pendingReason = 'awaiting_group_3';
    } else if (cls.expectedCardLines === 2) {
      cls.pendingReason = 'awaiting_group_2';
    } else {
      // Check if there's an approximate candidate
      const hasApprox = remaining.some(tx =>
        targets.some(t => Math.abs(tx.gross_amount - t) <= 2.00)
      );
      cls.pendingReason = hasApprox ? 'approx_possible' : 'divergence';
    }
  }

  return { results, classifications };
}

// ─── Helper: find exact group of N transactions summing to target ───

function findExactGroup(
  pool: TxForMatching[],
  size: number,
  target: number,
  tolerance: number
): { txs: TxForMatching[]; diff: number } | null {
  let best: { txs: TxForMatching[]; diff: number } | null = null;
  const limit = Math.min(pool.length, size <= 2 ? 30 : size <= 3 ? 20 : 15);

  if (size === 2) {
    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < limit; j++) {
        const sum = pool[i].gross_amount + pool[j].gross_amount;
        const diff = Math.abs(sum - target);
        if (diff <= tolerance && (!best || diff < best.diff)) {
          best = { txs: [pool[i], pool[j]], diff };
        }
      }
    }
  } else if (size === 3) {
    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < limit; j++) {
        for (let k = j + 1; k < limit; k++) {
          const sum = pool[i].gross_amount + pool[j].gross_amount + pool[k].gross_amount;
          const diff = Math.abs(sum - target);
          if (diff <= tolerance && (!best || diff < best.diff)) {
            best = { txs: [pool[i], pool[j], pool[k]], diff };
          }
        }
      }
    }
  } else if (size === 4) {
    const limit4 = Math.min(pool.length, 12);
    for (let i = 0; i < limit4; i++) {
      for (let j = i + 1; j < limit4; j++) {
        for (let k = j + 1; k < limit4; k++) {
          for (let l = k + 1; l < limit4; l++) {
            const sum = pool[i].gross_amount + pool[j].gross_amount + pool[k].gross_amount + pool[l].gross_amount;
            const diff = Math.abs(sum - target);
            if (diff <= tolerance && (!best || diff < best.diff)) {
              best = { txs: [pool[i], pool[j], pool[k], pool[l]], diff };
            }
          }
        }
      }
    }
  } else if (size === 5) {
    const limit5 = Math.min(pool.length, 10);
    for (let i = 0; i < limit5; i++) {
      for (let j = i + 1; j < limit5; j++) {
        for (let k = j + 1; k < limit5; k++) {
          for (let l = k + 1; l < limit5; l++) {
            for (let m = l + 1; m < limit5; m++) {
              const sum = pool[i].gross_amount + pool[j].gross_amount + pool[k].gross_amount + pool[l].gross_amount + pool[m].gross_amount;
              const diff = Math.abs(sum - target);
              if (diff <= tolerance && (!best || diff < best.diff)) {
                best = { txs: [pool[i], pool[j], pool[k], pool[l], pool[m]], diff };
              }
            }
          }
        }
      }
    }
  }

  return best;
}

function formatBRL(val: number): string {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
