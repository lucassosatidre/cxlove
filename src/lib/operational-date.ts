/**
 * Operational Date Utility
 * 
 * The business day runs from 03:00 to 02:59 the next day.
 * Between 00:00 and 02:59, the operational date is YESTERDAY.
 * From 03:00 onwards, the operational date is TODAY.
 * 
 * All calculations use America/Sao_Paulo timezone.
 */

export function getOperationalDate(): string {
  const now = new Date();
  // Get current time in Brasília
  const brasilia = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const hour = brasilia.getHours();

  if (hour < 3) {
    // Before 03:00 — operational date is yesterday
    brasilia.setDate(brasilia.getDate() - 1);
  }

  const yyyy = brasilia.getFullYear();
  const mm = String(brasilia.getMonth() + 1).padStart(2, '0');
  const dd = String(brasilia.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Check if a given closing_date string matches the current operational date.
 * Used to determine if an operator should have access to this closing.
 */
export function isOperationalToday(closingDate: string): boolean {
  return closingDate === getOperationalDate();
}
