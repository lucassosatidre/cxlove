# Fix TS errors em Edge Functions + Deploy

## Mudanças exatas

### 1. `supabase/functions/auto-open-closings/index.ts`
- Linhas 127-136: extrair `const msg = err instanceof Error ? err.message : String(err)` e usar nos 3 sites (`console.error`, `logOpen`, `JSON.stringify`).
- Linhas 156-158: trocar `e.message` por `e instanceof Error ? e.message : String(e)`.

### 2. `supabase/functions/auto-sync-saipos/index.ts`
- Linhas 111-114: catch tele — extrair `msg` e usar.
- Linhas 179-182: catch salon — idem.
- Linhas 199-213: catch fatal — idem (3 usos: console, logSync, JSON).
- Linhas 229-231: `e.message` → guard.

### 3. `supabase/functions/create-user/index.ts`
- Linha 109: `caller.id` → `callerId`.

### 4. `supabase/functions/fetch-saipos-labels/index.ts`
- Linhas 273-279: catch — extrair `msg` e usar.

### 5. `supabase/functions/saipos-data-proxy/index.ts`
- Linhas 54-60: catch — extrair `msg` e usar.

### 6. `supabase/functions/sync-saipos-sales/index.ts`
- Linhas 484-492: catch — extrair `msg` e usar.

### 7. `supabase/functions/sync-saipos-salon/index.ts`
- Linhas 346-353: catch — extrair `msg` e usar.

## Deploy
Após editar, deployar as 8 funções afetadas:
- auto-open-closings
- auto-sync-saipos
- create-user
- fetch-saipos-labels
- saipos-data-proxy
- sync-saipos-sales
- sync-saipos-salon
- (a 8ª listada nos build errors era genérica — só essas 7 têm mudança de código; outras citadas na lista de "Check" não tinham erros)

## Risco
Zero — apenas type guards. Comportamento de runtime idêntico.
