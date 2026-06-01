/**
 * Helpers para casar nomes de entregadores entre fontes diferentes:
 * - PickNGo (relatório de logística)
 * - machine_readings (digitado pelo operador na leitura das maquininhas)
 * - delivery_drivers (cadastro oficial — alimenta a aba Escala)
 *
 * A regra de comparação é por PRIMEIRO NOME normalizado (sem acento, minúsculo),
 * e qualquer rótulo "Frota …" é colapsado num único grupo "frota" (Frota Garantida).
 */

/** Rótulo usado para pedidos/máquinas da Frota Garantida (iFood). */
export const FROTA_GARANTIDA_LABEL = 'Frota Garantida';

/** Normaliza um nome para comparação: minúsculo, sem acento, espaços colapsados. */
export function normalizeName(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/** Primeiro token do nome, normalizado. */
export function normalizedFirstName(value: string | null | undefined): string {
  const n = normalizeName(value);
  return n.split(' ')[0] || '';
}

/** Primeiro nome preservando a grafia original (capitalização do cadastro). */
export function firstNameOriginal(value: string | null | undefined): string {
  return String(value ?? '').trim().split(/\s+/)[0] || '';
}

/**
 * Chave de GRUPO para o match financeiro.
 * Qualquer "Frota …" / "Frota Garantida" vira "frota"; senão, primeiro nome normalizado.
 */
export function driverGroupKey(value: string | null | undefined): string {
  const n = normalizeName(value);
  if (!n) return '';
  if (n.startsWith('frota')) return 'frota';
  return n.split(' ')[0];
}

/**
 * Tenta casar um nome cru (PickNGo) com o cadastro oficial pelo primeiro nome.
 * Retorna o primeiro nome canônico do cadastro quando acha; senão null.
 */
export function resolveCanonicalName(rawName: string, driverNames: string[]): string | null {
  const target = normalizedFirstName(rawName);
  if (!target) return null;
  for (const dn of driverNames) {
    if (normalizedFirstName(dn) === target) return firstNameOriginal(dn);
  }
  return null;
}
