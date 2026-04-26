## Objetivo

Resolver 3 bugs nos parsers de extrato voucher: (1) datas como string formatada quebrando Alelo/Ticket, (2) parsers importando lotes de meses fora da competência, (3) falta de bridge UX da tela antiga `/admin/auditoria/voucher` para a nova `/admin/auditoria/voucher-settlements`.

## Mudanças

### 1. `src/pages/audit/VoucherSettlementsImportSection.tsx` — frontend XLSX
Trocar `raw: false` → `raw: true` nos 3 parsers que usam XLSX (Alelo, VR, Ticket). Manter `cellDates: true`. Não tocar no Pluxee (CSV).

Resultado: datas chegam ao backend como `Date` instances e valores como `number`, que `parseDateBR` e `parseMoney` em `_shared/voucher-utils.ts` já tratam corretamente.

### 2. Filtro de competência nas 4 Edge Functions
Em cada um de:
- `supabase/functions/import-voucher-pluxee/index.ts`
- `supabase/functions/import-voucher-alelo/index.ts`
- `supabase/functions/import-voucher-vr/index.ts`
- `supabase/functions/import-voucher-ticket/index.ts`

Adicionar logo após o `createClient`:

```ts
const { data: period } = await supabase
  .from('audit_periods')
  .select('month, year')
  .eq('id', audit_period_id)
  .maybeSingle();
if (!period) return jsonResponse({ error: 'Período não encontrado' }, 404);

const periodStart = new Date(Date.UTC(period.year, period.month - 1, 1));
const periodEnd   = new Date(Date.UTC(period.year, period.month, 1));

function isInPeriod(d: string | null): boolean {
  if (!d) return false;
  const dt = new Date(d + 'T00:00:00Z');
  return dt >= periodStart && dt < periodEnd;
}
```

E aplicar `if (!isInPeriod(lot.data_pagamento)) continue;` ao lado das checagens existentes de validação de lote. No Alelo, aplicar também em `voucher_adjustments` via `isInPeriod(adj.data)`.

Lotes fora de competência são descartados silenciosamente (não vão pra outra tabela).

### 3. UX bridge
- `src/pages/audit/AuditVoucher.tsx`: adicionar banner azul logo após o `<Breadcrumb>` com botão "Ir para Conciliação por Extratos →" navegando para `/admin/auditoria/voucher-settlements?period=<periodId>`. Garantir que `Card`, `CardContent`, `Button` e `useNavigate` estejam importados.
- `src/pages/audit/VoucherSettlementsImportSection.tsx`: após resposta bem-sucedida de `runMatch`, exibir `toast.success('✓ Conciliação concluída', { description: ... })`.

## O que NÃO mudar
- `supabase/functions/_shared/voucher-utils.ts` (já robusto)
- Lógica do parser Pluxee (CSV não tem o bug de datas)
- RPC `match_voucher_lots`
- Flag `cellDates: true`
- Coluna `row[13]` para tarifas no Ticket

## Deploy & verificação
1. Deploy das 4 edge functions (`import-voucher-pluxee`, `-alelo`, `-vr`, `-ticket`).
2. Você limpa Mar/2026: `DELETE FROM voucher_lots WHERE audit_period_id = '<id>'` e idem para `voucher_adjustments`.
3. Re-importa os 4 extratos.
4. Roda "Conciliar Extratos".
5. Abre `/admin/auditoria/voucher-settlements?period=<id>` e valida contra a tabela esperada (Pluxee ~10%, VR ~17%, Alelo ~4-5%, Ticket ~12%, com nº de lotes só de Março).

Se ainda houver discrepância em nº de lotes → filtro de período falhou. Se taxa estiver muito errada → parser quebrou em alguma linha específica do extrato.
