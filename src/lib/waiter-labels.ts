/**
 * Maps machine serial numbers to human-readable waiter labels.
 * Each unique serial found in transactions for a given day becomes "Garçom 1", "Garçom 2", etc.
 */

export function buildWaiterMap(serials: (string | null | undefined)[]): Map<string, string> {
  const map = new Map<string, string>();
  let counter = 1;
  for (const serial of serials) {
    if (!serial) continue;
    if (!map.has(serial)) {
      map.set(serial, `Garçom ${counter}`);
      counter++;
    }
  }
  return map;
}
