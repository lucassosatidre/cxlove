// Utilitário monetário BR compartilhado (Controladoria / Bancos).
// Parse robusto para "1.234,56", "1234,56", "1234.56" e "1234".

export function parseMoneyBR(input: string | number | null | undefined): number {
  if (input == null) return 0;
  if (typeof input === 'number') return isFinite(input) ? input : 0;
  const raw = String(input).trim();
  if (!raw) return 0;
  // remove tudo que não é dígito, vírgula, ponto ou sinal
  let s = raw.replace(/[^\d,.\-]/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // formato pt-BR: pontos são separador de milhar, vírgula é decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // só vírgula → decimal pt-BR
    s = s.replace(',', '.');
  }
  // só ponto: assume decimal padrão americano (já ok)
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

export function formatMoneyBR(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
