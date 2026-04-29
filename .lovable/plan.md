# Redeploy + Rebuild

## O que vai acontecer ao aprovar

1. **Redeploy edge function** `run-audit-match` via `supabase--deploy_edge_functions(["run-audit-match"])` — sobe a versão atual em `supabase/functions/run-audit-match/index.ts` (com a lógica de carry-forward e `classify_ifood_deposits`).

2. **Rebuild do frontend** — o build roda automaticamente no fim do loop e publica o último commit, incluindo:
   - `src/pages/audit/AuditDashboard.tsx`
   - `src/pages/audit/AuditIfood.tsx`
   - `src/lib/audit-pdf.ts`

3. **Verificação pós-deploy**:
   - Checar `supabase--edge_function_logs` em `run-audit-match` pra confirmar que subiu sem erro de boot.
   - Confirmar que o Lovable build não falhou.

## O que NÃO vai mudar

- Nenhum código. É só redeploy do que já está commitado.
- Sem migrations, sem mudança de schema, sem mexer em outras functions (`import-maquinona`, `import-cresol` ficam como estão — você pediu só `run-audit-match` desta vez).
- Sem reset de dados de auditoria.

## Observação

Lembrando que mudanças de **frontend** só vão pro domínio público (`cxlove.lovable.app`) depois de você clicar **Publish → Update** no editor. O preview (`id-preview--...lovable.app`) atualiza automaticamente assim que o build terminar.