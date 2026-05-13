## Fix: `openclaw_run_sql_select` falha com "cannot set parameter role within security-definer function"

### Causa
A função foi criada com `SECURITY DEFINER`, e o Postgres proíbe `SET LOCAL ROLE` dentro de funções DEFINER (seria escalada de privilégio trivial).

### Solução: opção 1 — trocar para `SECURITY INVOKER`

Migration única que:

1. **Recria `public.openclaw_run_sql_select(text)` com `SECURITY INVOKER`**
   - Mantém todas as guardas de regex (SELECT/WITH only, dangerous keywords, pg_*, multi-statement).
   - Mantém `SET LOCAL statement_timeout`, `SET LOCAL idle_in_transaction_session_timeout`, `SET LOCAL ROLE openclaw_readonly`.
   - Mantém o `RESET ROLE` no exception handler.
   - `search_path` continua `public`.

2. **Permissões de execução**
   - `REVOKE ALL ON FUNCTION public.openclaw_run_sql_select(text) FROM PUBLIC, anon, authenticated;`
   - `GRANT EXECUTE ON FUNCTION public.openclaw_run_sql_select(text) TO service_role;`
   - Como a edge function `mcp` chama via service_role (após validar o `OPENCLAW_MCP_TOKEN`), o invoker terá permissão de fazer `SET LOCAL ROLE openclaw_readonly`. service_role pode trocar para qualquer role.

3. **Garantia adicional sobre `openclaw_readonly`**
   - O role já existe (criado na migration anterior). A migration vai apenas garantir, idempotente:
     - `GRANT openclaw_readonly TO service_role;` (necessário para service_role poder `SET ROLE` para ele em alguns setups Supabase — idempotente).

### Validação após deploy

Vou rodar via `supabase--read_query` (simula o caminho da função) e/ou via `supabase--curl_edge_functions` no endpoint MCP usando o token. Casos:

- ✅ `SELECT COUNT(*) FROM daily_closings`
- ✅ `SELECT closing_date, total_dinheiro FROM daily_closings ORDER BY closing_date DESC LIMIT 3`
- ✅ `WITH x AS (SELECT 1 as n) SELECT * FROM x`
- ✅ `SELECT 1` (vazio mas válido)
- 🚫 `INSERT INTO daily_closings ...` → "operação proibida"
- 🚫 `SELECT * FROM pg_user` → "Acesso a catálogo pg_*"
- 🚫 `SELECT 1; DROP TABLE x` → "Apenas 1 statement"
- 🚫 Tentativa de escrita via SELECT em função (ex: `SELECT pg_sleep(20)`) → barrada por timeout 10s

Confirmo aqui assim que a migration aplicar e os testes passarem; aí você re-roda do seu lado.

### Observação sobre segurança
Trocar para `INVOKER` não enfraquece nada neste caminho: o único caller é a edge function MCP autenticada por token, rodando como service_role. Os usuários `anon`/`authenticated` ficam sem `EXECUTE`. A defesa em profundidade (regex + role read-only + timeout) continua intacta.
