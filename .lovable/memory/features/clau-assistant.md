---
name: Clau Assistant
description: Assistente IA "Clau" — chat flutuante laranja, memória persistente, admin only, Anthropic Claude Sonnet 4
type: feature
---

# Clau (Camada A)

Assistente IA integrada ao CX Love. Acessível como botão flutuante laranja (#F97316) no canto inferior direito de qualquer rota autenticada.

## Stack
- **Modelo**: `claude-sonnet-4-20250514` via API Anthropic (secret `ANTHROPIC_API_KEY`)
- **Edge Function**: `supabase/functions/clau-chat/index.ts` — valida admin, monta prompt com memória + histórico + contexto da tela, chama Anthropic, persiste mensagens
- **Frontend**: `src/components/clau/ClauChat.tsx` montado no `App.tsx` (não no AppLayout, para aparecer em qualquer rota autenticada)

## Tabelas
- `clau_project_memory` — singleton por `app_origin`, lido em toda conversa
- `clau_conversations` — title (auto-gerado da 1ª mensagem), is_pinned, total_tokens_used
- `clau_messages` — role (user/assistant), context_snapshot (JSONB com tela/path)

## Acesso
- **Apenas admin** (verificado via `useUserRole` no frontend e `has_role` na edge function)
- RLS: cada user vê só suas conversas/mensagens; só admin lê/edita memória

## Comandos especiais
- `lembra disso: ...` / `anota: ...` / `salva na memória: ...` → regex no edge function adiciona à `clau_project_memory.content`

## Tela de gerenciamento
- Rota `/admin/clau/memoria` (`src/pages/ClauMemory.tsx`) com textarea grande para editar memória
- Link na sidebar: ícone `Brain`, label "Memória da Clau"

## Hook de contexto
- `src/hooks/useScreenContext.ts` mapeia `pathname` para nome amigável (ex: "Auditoria iFood (Cresol)") e envia ao prompt
