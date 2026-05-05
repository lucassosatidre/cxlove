## Redeploy `match-ifood-marketplace` e verificar versão

1. Disparar deploy da edge function `match-ifood-marketplace` via `supabase--deploy_edge_functions(["match-ifood-marketplace"])`. O deploy usa o código atualmente sincronizado no projeto Lovable (que está em sync bidirecional com o GitHub, então reflete o commit `c4e8d80` se já foi mergeado).
2. Após deploy bem-sucedido, chamar a função via `supabase--curl_edge_functions` (POST com `audit_period_id` do período Feb/2026 atual da rota) para capturar o JSON de resposta.
3. Validar que `edge_version` no payload retornado é exatamente `v2.2-2026-05-05-pass3-fix` e reportar o resultado.

Se o deploy falhar, checar logs com `supabase--edge_function_logs` e, se for problema de lockfile, remover `deno.lock` e re-tentar (ver edge-function-deploy-errors).

Observação: Lovable não tem comando explícito de "puxar commit X do GitHub" — o sync é automático. Se o commit `c4e8d80` ainda não apareceu no workspace, é necessário aguardar a sincronização antes do deploy. Posso confirmar lendo o header `// match-ifood-marketplace v2.2 (2026-05-05)` no `index.ts` antes de deployar.