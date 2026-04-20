

## Bug do Total Teórico via Saipos (importação Excel) — diferença R$ 3k+

### Diagnóstico

Conferi o fechamento `2026-04-19`:

- **183 pedidos**, R$ 23.363,62 total, **0 breakdowns** (Excel não cria `order_payment_breakdowns`)
- **77 pedidos contêm "Voucher Parceiro Desconto"**, somando **R$ 10.718,76**
- Desses, a maioria é `(PAGO) Online Ifood, Voucher Parceiro Desconto` — 100% online, não deveria entrar mesmo
- Mas há pedidos como `Crédito, Voucher Parceiro Desconto` (R$ 196,59 etc.) cuja **parte física desaparece totalmente** do Total Teórico

### Causa raiz

No fallback do `offlineMethodTotals` (sem breakdowns) em `Reconciliation.tsx:764` e `DeliveryReconciliation.tsx:366`:

```ts
const hasVoucherParceiro = methods.some(m => m.toLowerCase().includes('voucher parceiro'));
if (hasVoucherParceiro) continue;   // ← pula o pedido inteiro
```

Qualquer pedido que mencione "Voucher Parceiro Desconto" é descartado por inteiro, mesmo quando vem combinado com Crédito/Débito/Pix físico. Isso vai contra a regra de memória `voucher-partner-decomposition`, que diz para **decompor** (mostrar a parte física separada do voucher), não ignorar.

Adicional: pedidos `Online + Voucher Parceiro` corretamente não entram, mas pelo motivo errado (cai no `hasVoucherParceiro`); deveriam cair no filtro online normal.

### Correção

Em ambos `src/pages/Reconciliation.tsx` (linhas ~760-780) e `src/pages/DeliveryReconciliation.tsx` (linhas ~363-380), trocar o `continue` por uma decomposição que segue a mesma lógica de divisão usada em outros lugares:

```ts
// Remover: const hasVoucherParceiro = ...; if (...) continue;

const matchingCats = methods
  .map(m => matchCategory(m))
  .filter((c): c is string => c !== null);

if (matchingCats.length === 0) continue;       // tudo online/voucher parceiro

if (matchingCats.length === 1) {
  // Há 1 método físico + N online (incluindo Voucher Parceiro):
  // a parte física vale total_amount - (soma estimada das partes online)
  // Como sem breakdown não dá pra saber a divisão, atribui o total inteiro
  // ao único método físico (estimativa coerente com a regra atual de 1 físico + 1 online)
  totals[matchingCats[0]] += order.total_amount;
} else {
  // múltiplos físicos — divide igual entre eles (mantém comportamento atual)
  const share = order.total_amount / matchingCats.length;
  matchingCats.forEach(cat => { totals[cat] += share; });
}
```

Resumindo o efeito:
- `(PAGO) Online Ifood, Voucher Parceiro Desconto` → `matchingCats = []` → continue (ok, fica fora)
- `Crédito, Voucher Parceiro Desconto` → `matchingCats = ['Crédito']` → conta o total no Crédito (estimativa máxima; quando o operador preencher o rateio manual, o breakdown sobrescreve)
- `Crédito, Pix, Voucher Parceiro Desconto` → divide entre Crédito e Pix

### Arquivos alterados

1. `src/pages/Reconciliation.tsx` — bloco `offlineMethodTotals` (~L760-780)
2. `src/pages/DeliveryReconciliation.tsx` — bloco `offlineMethodTotals` (~L363-380)

Sem mudança de banco, sem mudança de parser de Excel, sem mudança no fluxo de matching. Apenas o cálculo do **Total Teórico via Saipos** passa a refletir corretamente a parte física dos pedidos com Voucher Parceiro Desconto.

### Validação após fix (fechamento 2026-04-19)

- Soma do "Total Geral" do Total Teórico deve subir em ~R$ 3-4k (parte física dos 77 pedidos com Voucher Parceiro)
- Pedidos `(PAGO) Online + Voucher Parceiro` continuam fora (corretamente)
- Memória `voucher-partner-decomposition` continua respeitada (matching automático segue bloqueado pelo `classifyPendingOrder`)

