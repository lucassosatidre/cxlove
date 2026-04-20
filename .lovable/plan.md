

## Bug: Vínculo SN → Entregador não funciona (prefixo `S1F2-000`)

### Diagnóstico confirmado via DB

Para o fechamento atual `39af9d02-...`:

| Fonte | Formato do serial |
|-------|-------------------|
| `card_transactions.machine_serial` | `S1F2-000158242606488` (com prefixo) |
| `machine_readings.machine_serial` | `158242606488` (sem prefixo) |
| `machine_registry.serial_number` | `158242606488` (sem prefixo) |

O map `serialToDeliveryPerson` é montado com chaves **sem prefixo** (vindas de `machine_readings` e `registry`), mas todas as buscas usam `serialToDeliveryPerson.get(tx.machine_serial)` passando o serial **com prefixo** direto da `card_transactions`. Resultado: lookup sempre `undefined` → exibe "Pickngo".

### Correção

Normalizar o serial em **toda** leitura/escrita do map, removendo o prefixo `S1F2-000`.

**Arquivo:** `src/pages/DeliveryReconciliation.tsx`

1. Criar helper local no topo do componente:
   ```ts
   const normalizeSerial = (s: string | null | undefined) => 
     s ? s.replace(/^S1F2-000/, '') : '';
   ```

2. No `useMemo` do `serialToDeliveryPerson` (~L234-280):
   - Normalizar `tx.machine_serial` antes de checar `result.has(...)` e antes de inserir/buscar no `registry`.
   - Normalizar a chave do `serialCounts` no fallback.

3. Nos 3 lugares que fazem lookup no map:
   - **L1228** (header da comanda — entregador inferido):  
     `serialToDeliveryPerson.get(normalizeSerial(t.machine_serial))`
   - **L1263** (tag inline ao lado da transação matchada): idem
   - **L1407 e L1410** (transações sem vínculo — badge do entregador): idem

Sem mudanças de banco. Sem mudanças no algoritmo de matching. Apenas normalização do serial nos lookups visuais e na construção do map.

### Validação

Após o fix, no fechamento atual:
- Comanda `#6` → "Tele 2 — Elisson" (em vez de "Pickngo") quando vinculada ao SN `158242606488`
- Frota sem entregador → exibe "Frota 2"
- Coluna **TRANSAÇÕES SEM VÍNCULO** mostra o nome do motoboy abaixo do valor quando o SN tem leitura cadastrada
- Pedidos online (sem `card_transaction` vinculada) continuam exibindo "Pickngo" (regra mantida)

