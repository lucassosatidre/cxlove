# Checklist de implantação — Lucinéia v9

## Pré-requisito: as tools precisam de backend

As 6 ferramentas (`consultar_combo_1`, `consultar_combo_2`, etc.) **não são auto-resolvidas pela Sofia** — você precisa de um webhook que retorne o resultado quando a IA chama a função. Duas opções:

### Opção A — Webhook único no Supabase (recomendada)

Criar uma edge function `sofia-tools-callback` que recebe `{tool, args}` e devolve o cálculo, usando a tabela já existente como fonte (ou hardcoded — o cardápio muda raramente). Para cadastrar, na criação de cada tool a Sofia pede o `webhook_url`. Use o mesmo URL para as 6 tools (a Sofia já envia `tool_name` no payload, então a edge despacha internamente).

### Opção B — Sem webhook, “server tool” inferido pela LLM

A Sofia tem um modo onde a LLM “responde a tool call” internamente sem chamar webhook. **Não recomendado pra preço** — volta o problema de alucinação. Use só pra `listar_sabores` (texto puro).

---

## Passo a passo no painel

### 1. Criar a nova Knowledge Base

- No painel Sofia → Knowledge Bases → **+ Nova**.
- Nome: `Lucinéia v9 - Estrela da Ilha`
- Subir os 3 .txt de `04_kb/`:
  - `cardapio.txt`
  - `combos_e_tamanhos.txt`
  - `operacao.txt`
- Anotar o ID da nova KB.

### 2. Subir o webhook das tools

- Criar a edge function `sofia-tools-callback` no cxlove (sugestão de implementação no arquivo `06_edge_tools_callback.ts` — anexado depois quando você confirmar).
- Deploy via Lovable.
- URL fica em: `https://<projeto>.functions.supabase.co/sofia-tools-callback`.

### 3. Cadastrar as 6 custom tools na Sofia

Para cada item de `03_tools.json` com `type=function`, faça:

```bash
curl -X POST https://suasofia.online/api/user/tools \
  -H "Authorization: Bearer $SOFIA_TOKEN" \
  -H "Content-Type: application/json" \
  -d @<json-da-tool-individual>.json
```

Ou cadastre direto pela UI (painel → Tools → Criar).

Para cada tool de função, preencher:
- **Name** e **Description**: copiar do JSON.
- **Parameters JSON**: copiar do JSON.
- **Webhook URL**: URL da edge function `sofia-tools-callback`.
- **HTTP method**: POST.

Para `end_call` (a Sofia já tem nativo), basta criar com `type: end_call` e a descrição traduzida.

### 4. Duplicar o assistente atual

- Painel → Assistants → Lucinéia V8 → **Duplicar** → renomeie para `Lucinéia v9`.
- Edite:
  - **Initial Message:** `Oi! Pizzaria Estrela da Ilha, aqui é a Lucinéia. Em que posso te ajudar?`
  - **System Prompt:** cole o conteúdo de `01_system_prompt.md` (do bloco entre `---`).
  - **Reengagement Prompt:** cole `02_reengagement_prompt.md`.
  - **Knowledgebase:** trocar pelo ID da nova KB (passo 1).
  - **Knowledgebase mode:** `function_call` (já está).
  - **Mode:** Dualplex (mantém).
  - **Voice:** se a v8 estiver com voice 338 (multilíngue), testar trocar para uma voz pt-BR pura. Sofia atualmente expõe a lista de vozes só pela UI — selecionar manualmente uma voz com label "pt-BR" ou similar.
  - **Tools:** desanexar as 2 `end_call` duplicadas, anexar as 7 novas (6 funções + 1 end_call traduzido).
  - **Fillers:** mudar de 0 para 1 (ativa fillers naturais; testar).
  - **secondary_language_ids:** deixar vazio.
  - **post_call_schema:** já está bom, mantém.

### 5. Testar antes de promover

Faça 4 ligações cobrindo:

1. **Combo 1 com Camarão + Calabresa**, sem borda, no Campeche. Esperado:
   - subtotal correto (R$ 117 + adicional camarão R$ 9 + adicional calabresa varia).
   - taxa entrega Campeche = 0.
   - sem repetição de saudação.
2. **Combo 2 com Prestígio**, com borda, no Ribeirão da Ilha.
3. **Broto avulso doce** (testa pedido mínimo: subtotal < 67).
4. **Bairro fora da lista** ("Lagoa da Conceição"). Esperado: oferecer retirada ou transferir.

### 6. Promover

Quando passar nos 4 testes, no painel:
- Pegar `phone_number_id=7010` do V8.
- Anexar ao V9.
- Pôr V8 em `inactive` e V9 em `active`.

---

## Pontos de atenção

- **Voz multilíngue:** a voice_id atual (338) provavelmente é multilíngue. Sofia não expõe a lista de vozes via API pública, então a verificação tem que ser feita pela UI. Se a voz tiver bandeira/marcação de "multi", trocar por uma voz pt-BR-only — mesmo que soe um pouco menos premium, vai estabilizar o idioma.
- **multimodal_model_id=14:** se possível, trocar pelo modelo mais recente recomendado pela Sofia pra Dualplex (Gemini Flash 2.5 Realtime ou GPT-5 Realtime). A UI mostra a opção.
- **chat_llm_fallback_id=31:** mantém — é o fallback quando o realtime falha.
- **Não esquecer:** após cada alteração, **gerar e testar** uma ligação real. Mudanças em prompt não pegam até a próxima ligação iniciar.
