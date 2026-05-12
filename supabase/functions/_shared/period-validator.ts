// Validador de competência: garante que arquivos de import estão sendo
// gravados no audit_period certo. Causa-raiz histórica: import-pluxee-csv
// e import-bb confiavam cego no audit_period_id do body — user uploadar
// arquivo de mar/26 enquanto na página fev/26 plantava dados em fev/26
// silenciosamente, deixando o auto-match orfanado.
//
// Regra: se NENHUMA data principal do arquivo cai no ano-mês do período,
// rejeita 400 com breakdown claro. Caso parcial (lote misto, ex: vendas
// fev+mar com data_pagamento mar) NÃO bloqueia — usuário pode importar
// lote misto legítimo em qualquer um dos 2 meses.

export type PeriodRef = { month: number; year: number };

export type PeriodValidation =
  | { ok: true; breakdown: Record<string, number>; primaryYM: string }
  | { ok: false; error: string; breakdown: Record<string, number>; primaryYM: string };

function ymOf(iso: string): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function periodYM(p: PeriodRef): string {
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/**
 * Valida se as datas principais do arquivo cobrem o período do import.
 * @param dates Lista de datas ISO (YYYY-MM-DD) extraídas do arquivo.
 * @param period { month, year } do audit_period alvo.
 * @param label Nome amigável da fonte (ex: "Pluxee", "BB", "Ticket").
 *              Usado na mensagem de erro retornada ao usuário.
 */
export function validatePeriodMatch(
  dates: (string | null | undefined)[],
  period: PeriodRef,
  label: string,
  allowedOffsets: number[] = [0],
): PeriodValidation {
  const breakdown: Record<string, number> = {};
  for (const d of dates) {
    const ym = d ? ymOf(d) : null;
    if (!ym) continue;
    breakdown[ym] = (breakdown[ym] ?? 0) + 1;
  }
  const total = Object.values(breakdown).reduce((s, n) => s + n, 0);
  const targetYM = periodYM(period);
  const primaryYM = Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? targetYM;

  if (total === 0) {
    return { ok: true, breakdown, primaryYM };
  }

  const allowedYMs = new Set(
    allowedOffsets.map(off => {
      const d = new Date(period.year, period.month - 1 + off, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })
  );

  const inAllowed = Object.entries(breakdown)
    .filter(([ym]) => allowedYMs.has(ym))
    .reduce((s, [, n]) => s + n, 0);

  if (inAllowed === 0) {
    const found = Object.entries(breakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([ym, n]) => `${ym} (${n})`)
      .join(', ');
    const allowedList = Array.from(allowedYMs).sort().join(', ');
    return {
      ok: false,
      error: `Arquivo ${label} não tem nenhuma linha nos meses esperados (${allowedList}). Datas encontradas: ${found}. Faça upload na auditoria do mês correto.`,
      breakdown,
      primaryYM,
    };
  }
  return { ok: true, breakdown, primaryYM };
}

/**
 * Filtra itens pelo mês alvo (e offsets opcionais). Use depois do
 * validatePeriodMatch passar, pra descartar linhas de meses adjacentes que
 * o user importou misturadas (causa-raiz da duplicação cross-período de VR/
 * Ticket/Pluxee: arquivos cobriam jan-mar e o importer aceitava tudo).
 */
export function filterToPeriod<T>(
  items: T[],
  getDate: (item: T) => string | null | undefined,
  period: PeriodRef,
  allowedOffsets: number[] = [0],
): { kept: T[]; skipped: number; skippedByMonth: Record<string, number> } {
  const allowedYMs = new Set(
    allowedOffsets.map(off => {
      const d = new Date(period.year, period.month - 1 + off, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }),
  );
  const kept: T[] = [];
  const skippedByMonth: Record<string, number> = {};
  let skipped = 0;
  for (const item of items) {
    const ds = getDate(item);
    const ym = ds ? ymOf(ds) : null;
    if (!ym) {
      kept.push(item);
      continue;
    }
    if (allowedYMs.has(ym)) {
      kept.push(item);
    } else {
      skipped += 1;
      skippedByMonth[ym] = (skippedByMonth[ym] ?? 0) + 1;
    }
  }
  return { kept, skipped, skippedByMonth };
}
