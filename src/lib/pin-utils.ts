/**
 * Pads a 4-digit PIN to meet Supabase's 6-char minimum.
 * The suffix is fixed so login and password-change use the same transform.
 */
export const PIN_SUFFIX = '@@';

export function padPin(pin: string): string {
  return pin + PIN_SUFFIX;
}
