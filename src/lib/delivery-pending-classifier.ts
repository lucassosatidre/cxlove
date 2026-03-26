/**
 * Classifies pending (unmatched) delivery orders into specific categories
 * and generates contextual suggestions.
 */

import {
  DeliveryAutoMatchContext,
  DeliveryBreakdownLike,
  DeliveryOrderLike,
  normalizeDeliveryMethod,
} from './delivery-method-utils';
import { formatCurrency } from './payment-utils';

export type PendingType =
  | 'structural'       // Voucher Parceiro Desconto, needs physical amount
  | 'stolen'           // Exact candidate exists but consumed by another order
  | 'method_mismatch'  // Value match exists but wrong method (informational only)
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

  // 2. Check for stolen transactions (exact value match consumed elsewhere)
  const consumedExact = allTransactions.filter(tx => {
    if (!tx.matched_order_id || tx.matched_order_id === order.id) return false;
    return exactTargets.some(target =>
      Math.abs(tx.gross_amount - target.amount) < 0.01
    );
  });

  if (consumedExact.length > 0) {
    const stolen = consumedExact[0];
    suggestions.push(
      `Existe transação exata (${stolen.payment_method} ${formatCurrency(stolen.gross_amount)} às ${stolen.sale_time || '—'}), mas consumida em outro pedido.`
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

  // 3. Check for value match with any method (since method is no longer a hard block,
  //    if there's a value match remaining it means context was too weak)
  const valueMatchAvailable = unmatchedTxs.filter(tx =>
    exactTargets.some(target => Math.abs(tx.gross_amount - target.amount) < 0.01)
  );

  if (valueMatchAvailable.length > 0) {
    const first = valueMatchAvailable[0];
    suggestions.push(
      `Existe transação de ${formatCurrency(first.gross_amount)} (${first.payment_method}), mas o contexto (entregador/horário) é insuficiente para vínculo automático seguro.`
    );
    return {
      type: 'method_mismatch',
      label: 'Pendente por contexto fraco',
      tone: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
      suggestions,
    };
  }

  // 4. Real pending — no candidate found
  const approxCompatible = unmatchedTxs.filter(tx =>
    exactTargets.some(target => {
      const diff = Math.abs(tx.gross_amount - target.amount);
      return diff > 0 && diff <= 1.00;
    })
  );

  if (approxCompatible.length > 0) {
    const first = approxCompatible[0];
    suggestions.push(
      `Existe transação próxima (${first.payment_method} ${formatCurrency(first.gross_amount)}), mas com diferença acima da tolerância de auto-match.`
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
