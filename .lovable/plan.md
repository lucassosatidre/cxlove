

## Plan: Ajustes no Histórico de Presenças e Fila de Espera

### 1. DriverHistorySection.tsx — Adicionar campo `waitlistEnteredAt` e ajustar formato de hora

**Interface `HistoryRow`**: Adicionar `waitlistEnteredAt: string | null`

**Query**: Adicionar `waitlist_entered_at` no select da query de `delivery_checkins`

**Mapeamento**: Incluir `waitlistEnteredAt: c.waitlist_entered_at` no map

**Coluna "Confirmado às"**: Mudar formato de `'dd/MM HH:mm'` para `'dd/MM HH:mm:ss'` (linha 251)

**Nova coluna "Entrou na fila às"**: Adicionar `<TableHead>` após "Confirmado às" e `<TableCell>` correspondente mostrando `waitlistEnteredAt` formatado como `'dd/MM HH:mm:ss'` ou "—"

**Ajustar colSpan**: Incrementar os colSpan de 9/11 para 10/12

**Exportação Excel**: Adicionar coluna `'Entrou na fila às'` no `exportData` com formato `'dd/MM/yyyy HH:mm:ss'`

### 2. DriverShiftsContent.tsx — Segundos na fila de espera (linha 149)

Mudar `format(new Date(c.waitlist_entered_at), 'HH:mm')` para `'HH:mm:ss'`

### 3. DriverShifts.tsx — Segundos na fila de espera (linha 152)

Mudar `format(new Date(c.waitlist_entered_at), 'HH:mm')` para `'HH:mm:ss'`

### Arquivos modificados
| Arquivo | Alteração |
|---------|-----------|
| `src/components/delivery/DriverHistorySection.tsx` | Nova coluna, formato HH:mm:ss, exportação |
| `src/components/delivery/DriverShiftsContent.tsx` | HH:mm → HH:mm:ss na fila |
| `src/pages/DriverShifts.tsx` | HH:mm → HH:mm:ss na fila |

Nenhuma lógica de negócio alterada. Apenas formatação visual e adição de coluna.

