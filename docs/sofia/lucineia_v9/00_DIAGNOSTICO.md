# Diagnóstico Lucinéia V8 (id 13520) — causas-raiz dos bugs

**Assistente ativo no telefone:** Lucinéia V8 (id 13520, mode=dualplex, voice=338, language_id=9, kb=function_call, knowledgebase_id=4040, multimodal_model_id=14, chat_llm_fallback_id=31).

---

## Bug 1 — Repete a saudação 2x

**Causa:** existe Saudação no **Initial Message** *E* saudação dentro do **system_prompt** (`## 1. Saudação`). Em modo dualplex, o Initial Message é falado literalmente. Aí a primeira fala do LLM cumpre `## 1. Saudação` do prompt → 2ª saudação.

Evidência (call 6473838):
- bot: "Oi! Tudo bem? Pizzaria Estrela da Ilha, com quem eu falo?" ← Initial Message
- human: "Ana Júlia"
- bot: "Pizzaria Estrela da Ilha, aqui é a Lucinéia. Como posso te ajudar?" ← LLM saudação do prompt

**Fix:** remover bloco `## 1. Saudação` do system_prompt; deixar apenas o Initial Message como ponto de entrada.

---

## Bug 2 — Inventa preços / mistura blocos (Camarão R$15 no Combo 1 etc.)

**Causa raiz:** o system_prompt tem **64.602 caracteres**, dos quais **43.137 são um JSON gigante** com 5 blocos (combo_1, combo_2, monte_do_seu_jeito.broto/grande/gigante, bebidas_avulsas, taxas_entrega). O LLM tem que:
1. ler o JSON inteiro a cada turno;
2. localizar o bloco certo;
3. somar adicionais corretamente;
4. lembrar que `adicional_combo_1`, `adicional_grande`, `adicional_gigante` existem para o **mesmo sabor** com **valores diferentes**.

LLMs em chamada de voz **não fazem isso de forma confiável**. Vão alucinar valores de um bloco quando deveriam pegar de outro. É exatamente o que está acontecendo (Camarão R$15 = veio do bloco gigante quando deveria ter sido adicional_combo_1 = R$9).

**Fix:** tirar o JSON inteiro do prompt e expor preços via **Custom Mid-Call Tools** (function calls determinísticos). LLM passa a fazer: `consultar_combo_1(sabores=["Camarão","Calabresa"], borda=false, bebida_extra=null)` → recebe `{subtotal: 132.00}`. Sem alucinação possível.

---

## Bug 3 — Fala em outros idiomas (espanhol, francês, italiano)

**Causa provável (já bloqueada):** `secondary_language_ids: None` → não é detecção automática. Sobrou:
1. **voice_id=338** + `multimodal_model_id=14` (Gemini / GPT-Realtime multilíngue): o STT/TTS multimodal **decide** o idioma frase a frase quando o áudio do cliente fica ambíguo. Modelos multimodais ignoram parcialmente o `language_id`.
2. **descrições de tools em inglês** no payload (ex.: "Hang up the call when the conversation is finished") — vazam para o contexto do LLM e influenciam idioma.

**Fix:**
- trocar para modo **dualplex** com STT pt-BR fixo + TTS pt-BR fixo (Sofia recomenda Dualplex pra estabilidade de idioma);
- traduzir TODAS as descrições de tool para pt-BR;
- adicionar regra explícita no prompt: "responder em pt-BR mesmo se o cliente falar outro idioma" (já existe, mas com prompt curto fica mais forte).

---

## Bug 4 — Não entende sabores (nega Guaraná Zero quando existe)

**Causa:** KB 4040 tem 2 docx (`Cardápio Delivery`, `Taxas de Entrega`). DOCX é parseado pra texto mas o chunking RAG não tem garantia de pegar a tabela toda. Com `knowledgebase_mode=function_call`, o LLM **decide quando** consultar — e às vezes responde direto sem consultar.

**Fix:**
- KB passa a ser **somente fonte de texto livre** (cardápio com ingredientes, horários, FAQ);
- preços/sabores disponíveis vêm via **Custom Tools** (lista determinística);
- substituir DOCX por TXT bem estruturado (parser mais previsível);
- Tool `listar_sabores_salgados()` força o LLM a consultar antes de afirmar "não temos X".

---

## Bug 5 — Tools em inglês

**Estado atual:**
- 2 tools `end_call` duplicados (bug — só precisa de 1)
- descrição: "Hang up the call when the conversation is finished or the customer wants to end it"

**Fix:** deletar duplicata, traduzir descrição.

---

## Bug 6 — Prompt prolixo

7.224 palavras de prompt + reengagement_prompt de mais 600 palavras. LLM perde foco. O prompt fala "sempre entre aspas, sempre começar regras com `>`, etc." — micromanagement que polui o contexto.

**Fix:** novo prompt < 150 linhas, focado em comportamento, sem reproduzir cardápio.

---

## Resumo: o que muda no painel da Sofia

| Campo | Atual | Novo |
|---|---|---|
| **Mode** | dualplex | mantém dualplex |
| **multimodal_model_id** | 14 | trocar para Gemini Flash 2.5 Realtime ou GPT-5 Realtime (estável pt-BR) — confirmar no painel qual id |
| **voice_id** | 338 | testar 360 (já validado em outros assistentes) ou outra voz pt-BR-only (não multilingual) |
| **language_id** | 9 | mantém (pt-BR) |
| **secondary_language_ids** | null | manter null (não usar) |
| **knowledgebase_mode** | function_call | mantém |
| **knowledgebase_id** | 4040 (DOCX) | criar nova KB com 3 docs TXT (anexos abaixo) |
| **initial_message** | "Oi! Tudo bem? Pizzaria Estrela da Ilha, com quem eu falo?" | "Oi! Pizzaria Estrela da Ilha, aqui é a Lucinéia. Em que posso te ajudar?" |
| **system_prompt** | 64k chars com JSON | novo, 4–5k chars, sem JSON (anexo 01) |
| **reengagement_prompt** | 3k chars | enxuto, 400 chars (anexo 02) |
| **tools** | 2× end_call (inglês) | 1× end_call (pt) + 6 custom tools (anexo 03) |
| **fillers** | 0 | 1 (ativa fillers naturais) |
| **post_call_schema** | ok, mantém | mantém |

---

## Ordem de execução recomendada

1. **Criar nova KB** "Lucinéia v9 - Estrela da Ilha" e subir os 3 TXTs do anexo 04.
2. **Criar as 6 custom tools** via `POST /api/user/tools` (anexo 03 traz JSON pronto).
3. **Duplicar** o assistente atual no painel → "Lucinéia v9".
4. **Substituir** system_prompt, initial_message, reengagement_prompt na cópia.
5. **Trocar** knowledgebase_id pelo da nova KB.
6. **Anexar** as 6 tools + deletar end_call duplicado, traduzir descrição.
7. **Testar** com 3-4 ligações reais cobrindo: Combo 1 com Camarão, Combo 2 com Prestígio, broto avulso, bebida sozinha (recusar pedido), bairro não listado.
8. Se passar nos testes, **trocar phone_number_id=7010** do V8 para o V9.

Os artefatos prontos pra colar estão em:
- [01_system_prompt.md](01_system_prompt.md)
- [02_reengagement_prompt.md](02_reengagement_prompt.md)
- [03_tools.json](03_tools.json)
- [04_kb/](04_kb/) (3 arquivos .txt)
