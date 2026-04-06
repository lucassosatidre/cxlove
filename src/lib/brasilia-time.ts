/**
 * Get the current hour in Brasília timezone (America/Sao_Paulo).
 */
export function getBrasiliaHour(): number {
  const now = new Date();
  const brasilia = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return brasilia.getHours();
}

/**
 * Get today's date string (yyyy-MM-dd) in Brasília timezone,
 * respecting the operational day boundary (03:00).
 */
export function getBrasiliaToday(): string {
  const now = new Date();
  const brasilia = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const hour = brasilia.getHours();
  if (hour < 3) {
    brasilia.setDate(brasilia.getDate() - 1);
  }
  const yyyy = brasilia.getFullYear();
  const mm = String(brasilia.getMonth() + 1).padStart(2, '0');
  const dd = String(brasilia.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Get the current Brasília date (calendar, not operational) formatted as dd/mm/yyyy.
 */
export function getBrasiliaDateFormatted(): string {
  const now = new Date();
  const brasilia = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dd = String(brasilia.getDate()).padStart(2, '0');
  const mm = String(brasilia.getMonth() + 1).padStart(2, '0');
  const yyyy = brasilia.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
