// Calendário bancário Brasil + SC (replica do edge function _shared/calendar.ts).
// Mantido client-side pra previews que precisam saber o próximo dia útil.

const ALL_HOLIDAYS = new Set<string>([
  // 2024
  // (qua de cinzas banco opera meio-período, NÃO está aqui)
  '2024-01-01', '2024-02-12', '2024-02-13',
  '2024-03-29', '2024-04-21', '2024-05-01', '2024-05-30',
  '2024-09-07', '2024-10-12', '2024-11-02', '2024-11-15', '2024-11-20',
  '2024-12-24', '2024-12-25', '2024-12-31',
  // 2025
  '2025-01-01', '2025-03-03', '2025-03-04',
  '2025-04-18', '2025-04-21', '2025-05-01', '2025-06-19',
  '2025-09-07', '2025-10-12', '2025-11-02', '2025-11-15', '2025-11-20',
  '2025-12-24', '2025-12-25', '2025-12-31',
  // 2026
  '2026-01-01', '2026-02-16', '2026-02-17',
  '2026-04-03', '2026-04-21', '2026-05-01', '2026-06-04',
  '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20',
  '2026-12-24', '2026-12-25', '2026-12-31',
]);

export function isBusinessDay(iso: string): boolean {
  if (ALL_HOLIDAYS.has(iso)) return false;
  const d = new Date(iso + 'T00:00:00Z');
  const dow = d.getUTCDay();
  return dow !== 0 && dow !== 6;
}

export function nextBusinessDay(saleDateIso: string): string {
  const d = new Date(saleDateIso + 'T00:00:00Z');
  for (let i = 0; i < 30; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    if (isBusinessDay(iso)) return iso;
  }
  return saleDateIso;
}
