/**
 * Utility functions for payment method classification and breakdown logic.
 */

const ONLINE_KEYWORDS = ['online', '(pago)', 'voucher parceiro'];

export function isOnlinePayment(method: string): boolean {
  const lower = method.toLowerCase().trim();
  return ONLINE_KEYWORDS.some(kw => lower.includes(kw));
}

export function classifyPaymentType(method: string): 'online' | 'fisico' {
  return isOnlinePayment(method) ? 'online' : 'fisico';
}

/**
 * Splits a comma-separated payment method string into individual methods.
 */
export function splitPaymentMethods(raw: string): string[] {
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Determines the breakdown scenario for a set of payment methods.
 */
export type BreakdownScenario =
  | 'single'           // Only 1 method, no breakdown needed
  | 'one_physical_one_online' // Auto-calc: physical entered, online = total - physical
  | 'manual';          // All fields manual, sum must equal total

export function getBreakdownScenario(methods: string[]): BreakdownScenario {
  if (methods.length <= 1) return 'single';

  const physicals = methods.filter(m => !isOnlinePayment(m));
  const onlines = methods.filter(m => isOnlinePayment(m));

  if (physicals.length === 1 && onlines.length === 1) {
    return 'one_physical_one_online';
  }

  return 'manual';
}

/**
 * Checks if the order needs a payment breakdown (has multiple payment methods).
 */
export function needsBreakdown(paymentMethod: string): boolean {
  return splitPaymentMethods(paymentMethod).length > 1;
}

/**
 * Format a number as BRL currency.
 */
export function formatCurrency(val: number): string {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Parse a currency input string to a number with 2 decimal places.
 */
export function parseCurrencyInput(val: string): number {
  const cleaned = val.replace(/[^\d.,]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num * 100) / 100;
}
