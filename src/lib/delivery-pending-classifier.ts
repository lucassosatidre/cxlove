/**
 * Classifies pending (unmatched) delivery orders into specific categories
 * and generates contextual suggestions.
 */

import {
  DeliveryAutoMatchContext,
  DeliveryBreakdownLike,
  DeliveryOrderLike,
  getDeliveryDisplayMethods,
  isTransactionMethodCompatible,
  normalizeDeliveryMethod,
} from './delivery-method-utils';
import { formatCurrency } from './payment-utils';

export type PendingType =
  | 'structural'       // Voucher Parceiro Desconto, needs physical amount
  | 'stolen'           // Exact candidate exists but consumed by another order
  | 'method_mismatch'  // Value match exists but wrong method
  | 'real';            // No compatible candidate found

export interface PendingClassification {
  type: PendingType;
  label: string;
  tone: string;
  suggestions: string[];
}

interface TransactionLike {
  id: string;
  gross_amount: number;
  payment_method: string;
  sale_time: string | null;
  matched_order_id: string | null;
  machine_serial: string | null;
}

export function classifyPendingOrder(
  order: DeliveryOrderLike,
  context: DeliveryAutoMatchContext,
  allTransactions: TransactionLike[],
  breakdowns: DeliveryBreakdownLike[],
): PendingClassification {
  const suggestions: string[] = [];

  // 1. Structural: Voucher Parceiro Desconto
  if (context.isStructuralPending) {
    suggestions.push(
      'Pedido com Voucher Parceiro Desconto: o valor total inclui complemento automático do parceiro. Conciliar apenas a parte física.'
    );
    suggestions.push(
      'Aguardando valor físico conciliável para vínculo automático.'
    );
    return {
      type: 'structural',
      label: 'Pendente estrutural',
      tone: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
      suggestions,
    };
  }

  const exactTargets = context.exactTargets;
  const unmatchedTxs = allTransactions.filter(tx => !tx.matched_order_id);

  // 2. Check for stolen transactions (exact value + method match but consumed elsewhere)
  const consumedCompatible = allTransactions.filter(tx => {
    if (!tx.matched_order_id || tx.matched_order_id === order.id) return false;
    return exactTargets.some(target =>
      target.method &&
      Math.abs(tx.gross_amount - target.amount) < 0.01 &&
      isTransactionMethodCompatible(tx.payment_method, target.method)
    );
  });

  if (consumedCompatible.length > 0) {
    const stolen = consumedCompatible[0];
    suggestions.push(
      `Existe transação exata compatível (${stolen.payment_method} ${formatCurrency(stolen.gross_amount)} às ${stolen.sale_time || '—'}), mas atualmente consumida em outro pedido.`
    );
    suggestions.push(
      'Verifique se o vínculo atual do candidato está correto ou desfaça-o para liberar esta transação.'
    );
    return {
      type: 'stolen',
      label: 'Pendente por transação roubada',
      tone: 'bg-primary/10 text-primary border-primary/20',
      suggestions,
    };
  }

  // 3. Check for method mismatch (value exists but wrong method)
  const incompatibleExact = unmatchedTxs.filter(tx =>
    exactTargets.some(target => {
      if (!target.method) return false;
      return Math.abs(tx.gross_amount - target.amount) < 0.01 &&
        !isTransactionMethodCompatible(tx.payment_method, target.method);
    })
  );

  if (incompatibleExact.length > 0) {
    const first = incompatibleExact[0];
    const expectedMethod = exactTargets.find(t =>
      Math.abs(first.gross_amount - t.amount) < 0.01
    )?.method || 'desconhecido';

    suggestions.push(
      `Existe transação de ${formatCurrency(first.gross_amount)}, mas o método é incompatível: transação é ${first.payment_method}, pedido espera ${expectedMethod}.`
    );

    // Also check for approximate compatible
    const approxCompatible = unmatchedTxs.filter(tx =>
      exactTargets.some(target => {
        const diff = Math.abs(tx.gross_amount - target.amount);
        return diff > 0 && diff <= 0.50 && isTransactionMethodCompatible(tx.payment_method, target.method);
      })
    );

    if (approxCompatible.length > 0) {
      const approx = approxCompatible[0];
      suggestions.push(
        `Existe transação próxima e compatível (${approx.payment_method} ${formatCurrency(approx.gross_amount)}), mas sem segurança suficiente para auto-match.`
      );
    }

    return {
      type: 'method_mismatch',
      label: 'Pendente por método incompatível',
      tone: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
      suggestions,
    };
  }

  // 4. Real pending — no compatible candidate
  const approxCompatible = unmatchedTxs.filter(tx =>
    exactTargets.some(target => {
      const diff = Math.abs(tx.gross_amount - target.amount);
      return diff > 0 && diff <= 0.50 && isTransactionMethodCompatible(tx.payment_method, target.method);
    })
  );

  if (approxCompatible.length > 0) {
    const first = approxCompatible[0];
    suggestions.push(
      `Existe transação próxima e compatível (${first.payment_method} ${formatCurrency(first.gross_amount)}), mas com diferença acima da tolerância de auto-match.`
    );
  } else {
    suggestions.push(
      'Nenhuma transação compatível encontrada para fechamento automático seguro.'
    );
  }

  return {
    type: 'real',
    label: 'Pendente real',
    tone: 'bg-destructive/10 text-destructive border-destructive/20',
    suggestions,
  };
}
