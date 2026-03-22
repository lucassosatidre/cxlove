import { splitPaymentMethods } from './payment-utils';

export type NormalizedDeliveryMethod = 'credito' | 'debito' | 'pix' | 'voucher' | 'dinheiro' | 'online' | 'unknown';

export interface DeliveryOrderLike {
  id: string;
  payment_method: string;
  total_amount: number;
}

export interface DeliveryBreakdownLike {
  imported_order_id: string;
  payment_method_name: string;
  payment_type: string;
  amount: number;
}

export interface DeliveryPhysicalMethod {
  label: string;
  normalized: NormalizedDeliveryMethod;
  amount?: number;
}

export interface DeliveryOrderPaymentProfile {
  rawMethods: string[];
  physicalMethods: DeliveryPhysicalMethod[];
  hasCash: boolean;
  hasOnlineComponent: boolean;
  hasStructuralVoucher: boolean;
}

export interface DeliveryMatchTarget {
  amount: number;
  method: NormalizedDeliveryMethod;
  label: string;
}

export interface DeliveryAutoMatchContext {
  profile: DeliveryOrderPaymentProfile;
  exactTargets: DeliveryMatchTarget[];
  combinedTargetAmount: number | null;
  expectedCombinedMethods: NormalizedDeliveryMethod[];
  isStructuralPending: boolean;
  allowsApproximate: boolean;
}

export function normalizeDeliveryText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function normalizeDeliveryMethod(method: string): NormalizedDeliveryMethod {
  const lower = normalizeDeliveryText(method);
  if (!lower) return 'unknown';
  if (lower.includes('voucher parceiro desconto')) return 'online';
  if (lower.includes('online') || lower.includes('(pago)') || lower.includes('anotaai')) return 'online';
  if (lower.includes('dinheiro')) return 'dinheiro';
  if (lower.includes('pix')) return 'pix';
  if (lower.includes('debito') || lower.includes('debit')) return 'debito';
  if (lower.includes('credito') || lower.includes('credit')) return 'credito';
  if (lower.includes('voucher')) return 'voucher';
  return 'unknown';
}

export function isPhysicalDeliveryMethod(method: string | NormalizedDeliveryMethod): boolean {
  const normalized = typeof method === 'string' ? normalizeDeliveryMethod(method) : method;
  return normalized === 'credito' || normalized === 'debito' || normalized === 'pix' || normalized === 'voucher';
}

export function isTransactionMethodCompatible(txMethod: string, expectedMethod: NormalizedDeliveryMethod): boolean {
  return normalizeDeliveryMethod(txMethod) === expectedMethod;
}

export function getDeliveryOrderPaymentProfile(
  order: DeliveryOrderLike,
  breakdowns: DeliveryBreakdownLike[] = []
): DeliveryOrderPaymentProfile {
  const rawMethods = splitPaymentMethods(order.payment_method);
  const orderBreakdowns = breakdowns.filter(b => b.imported_order_id === order.id);
  const physicalBreakdowns = orderBreakdowns.filter(
    b => b.payment_type === 'fisico' && b.amount > 0 && isPhysicalDeliveryMethod(b.payment_method_name)
  );

  if (physicalBreakdowns.length > 0) {
    return {
      rawMethods,
      physicalMethods: physicalBreakdowns.map(b => ({
        label: b.payment_method_name,
        normalized: normalizeDeliveryMethod(b.payment_method_name),
        amount: b.amount,
      })),
      hasCash: rawMethods.some(method => normalizeDeliveryMethod(method) === 'dinheiro'),
      hasOnlineComponent: rawMethods.some(method => normalizeDeliveryMethod(method) === 'online'),
      hasStructuralVoucher: rawMethods.some(method => normalizeDeliveryText(method).includes('voucher parceiro desconto')),
    };
  }

  return {
    rawMethods,
    physicalMethods: rawMethods
      .filter(method => isPhysicalDeliveryMethod(method))
      .map(method => ({ label: method, normalized: normalizeDeliveryMethod(method) })),
    hasCash: rawMethods.some(method => normalizeDeliveryMethod(method) === 'dinheiro'),
    hasOnlineComponent: rawMethods.some(method => normalizeDeliveryMethod(method) === 'online'),
    hasStructuralVoucher: rawMethods.some(method => normalizeDeliveryText(method).includes('voucher parceiro desconto')),
  };
}

export function getDeliveryAutoMatchContext(
  order: DeliveryOrderLike,
  breakdowns: DeliveryBreakdownLike[] = []
): DeliveryAutoMatchContext {
  const profile = getDeliveryOrderPaymentProfile(order, breakdowns);
  const explicitTargets = profile.physicalMethods
    .filter(method => typeof method.amount === 'number' && method.amount > 0)
    .map(method => ({
      amount: method.amount!,
      method: method.normalized,
      label: method.label,
    }));

  const protectedMix = profile.hasCash || profile.hasOnlineComponent || profile.hasStructuralVoucher;
  const fallbackSingleTarget =
    explicitTargets.length === 0 && profile.physicalMethods.length === 1 && !protectedMix
      ? [{
          amount: order.total_amount,
          method: profile.physicalMethods[0].normalized,
          label: profile.physicalMethods[0].label,
        }]
      : [];

  const exactTargets = explicitTargets.length > 0 ? explicitTargets : fallbackSingleTarget;
  const expectedCombinedMethods = profile.physicalMethods.map(method => method.normalized);
  const combinedTargetAmount =
    explicitTargets.length === 0 && profile.physicalMethods.length > 1 && !protectedMix
      ? order.total_amount
      : null;

  return {
    profile,
    exactTargets,
    combinedTargetAmount,
    expectedCombinedMethods,
    isStructuralPending: profile.hasStructuralVoucher && explicitTargets.length === 0,
    allowsApproximate: exactTargets.length > 0,
  };
}

export function getDeliveryDisplayMethods(order: DeliveryOrderLike, breakdowns: DeliveryBreakdownLike[] = []): string {
  const profile = getDeliveryOrderPaymentProfile(order, breakdowns);
  return profile.physicalMethods.length > 0
    ? profile.physicalMethods.map(method => method.label).join(', ')
    : order.payment_method;
}

export function getDeliveryDisplayAmount(order: DeliveryOrderLike, breakdowns: DeliveryBreakdownLike[] = []): number {
  const context = getDeliveryAutoMatchContext(order, breakdowns);
  if (context.exactTargets.length > 0) {
    return context.exactTargets.reduce((sum, target) => sum + target.amount, 0);
  }
  return order.total_amount;
}

export function canCoverExpectedMethods(
  transactionMethods: string[],
  expectedMethods: NormalizedDeliveryMethod[]
): boolean {
  const counts = new Map<NormalizedDeliveryMethod, number>();

  expectedMethods.forEach(method => {
    if (!isPhysicalDeliveryMethod(method)) return;
    counts.set(method, (counts.get(method) || 0) + 1);
  });

  for (const txMethod of transactionMethods) {
    const normalized = normalizeDeliveryMethod(txMethod);
    const available = counts.get(normalized) || 0;
    if (available <= 0) return false;
    counts.set(normalized, available - 1);
  }

  return true;
}