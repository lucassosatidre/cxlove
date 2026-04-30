// Calendário bancário Brasil + Santa Catarina
// Usado pra calcular nextBusinessDay no algoritmo de match Cresol (D+1).
// Inclui feriados nacionais + estaduais SC + ponto facultativo carnaval (que
// na prática banco não opera).

const HOLIDAYS_2024: string[] = [
  '2024-01-01', // Confraternização
  '2024-02-12', '2024-02-13', // Carnaval seg+ter (qua de cinzas banco opera)
  '2024-03-29', // Sexta-feira santa
  '2024-04-21', // Tiradentes
  '2024-05-01', // Trabalho
  '2024-05-30', // Corpus Christi
  '2024-09-07', // Independência
  '2024-10-12', // N. Sra. Aparecida
  '2024-11-02', // Finados
  '2024-11-15', // Proclamação
  '2024-11-20', // Consciência negra (feriado nacional desde 2024)
  '2024-12-24', '2024-12-25', '2024-12-31',
];

const HOLIDAYS_2025: string[] = [
  '2025-01-01',
  '2025-03-03', '2025-03-04', // Carnaval (qua de cinzas banco opera)
  '2025-04-18', // Sex santa
  '2025-04-21',
  '2025-05-01',
  '2025-06-19', // Corpus Christi
  '2025-09-07',
  '2025-10-12',
  '2025-11-02',
  '2025-11-15',
  '2025-11-20',
  '2025-12-24', '2025-12-25', '2025-12-31',
];

const HOLIDAYS_2026: string[] = [
  '2026-01-01',
  '2026-02-16', '2026-02-17', // Carnaval seg+ter (qua de cinzas banco opera meio-período)
  '2026-04-03', // Sex santa
  '2026-04-21', // Tiradentes
  '2026-05-01',
  '2026-06-04', // Corpus Christi
  '2026-09-07',
  '2026-10-12',
  '2026-11-02',
  '2026-11-15',
  '2026-11-20',
  '2026-12-24', '2026-12-25', '2026-12-31',
];

const ALL_HOLIDAYS = new Set<string>([
  ...HOLIDAYS_2024,
  ...HOLIDAYS_2025,
  ...HOLIDAYS_2026,
]);

export function isBusinessDay(iso: string): boolean {
  if (ALL_HOLIDAYS.has(iso)) return false;
  const d = new Date(iso + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=dom, 6=sáb
  return dow !== 0 && dow !== 6;
}

/**
 * Próximo dia útil bancário a partir de uma data (D+1 considerando feriados/fim de semana).
 * Se sale_date for sábado, retorna segunda (próx útil). Se for sex, retorna seg.
 */
export function nextBusinessDay(saleDateIso: string): string {
  const d = new Date(saleDateIso + 'T00:00:00Z');
  let attempt = 0;
  while (attempt < 30) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    if (isBusinessDay(iso)) return iso;
    attempt++;
  }
  return saleDateIso; // fallback (não deveria chegar aqui)
}
