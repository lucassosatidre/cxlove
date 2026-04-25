// Helper para calcular e exibir o estado de capacidade de um turno.
// Regra: vagas_abertas = vagas_configuradas - confirmados
// 3 estados: abaixo (verde), lotado (laranja), acima (vermelho com extras admin).

export type ShiftCapacityState = 'below' | 'full' | 'over';

export interface ShiftCapacity {
  state: ShiftCapacityState;
  vagas: number;
  confirmados: number;
  extras: number;
  vagasAbertas: number;
  filaCount: number;
  /** Tailwind text color class for the "X/Y" display */
  colorClass: string;
  /** Texto auxiliar para mostrar abaixo (extras + fila) */
  auxiliaryText: string | null;
}

export function computeShiftCapacity(
  vagas: number,
  confirmados: number,
  filaCount: number = 0,
): ShiftCapacity {
  const extras = Math.max(0, confirmados - vagas);
  const vagasAbertas = Math.max(0, vagas - confirmados);

  let state: ShiftCapacityState;
  let colorClass: string;
  if (confirmados < vagas) {
    state = 'below';
    colorClass = 'text-green-600 dark:text-green-400';
  } else if (confirmados === vagas) {
    state = 'full';
    colorClass = 'text-orange-500 dark:text-orange-400';
  } else {
    state = 'over';
    colorClass = 'text-destructive';
  }

  const parts: string[] = [];
  if (state === 'over' && extras > 0) {
    parts.push(`+${extras} ${extras === 1 ? 'extra' : 'extras'} do admin`);
  }
  if (filaCount > 0) {
    parts.push(`Fila: ${filaCount}`);
  }
  const auxiliaryText = parts.length > 0 ? parts.join(' • ') : null;

  return { state, vagas, confirmados, extras, vagasAbertas, filaCount, colorClass, auxiliaryText };
}
