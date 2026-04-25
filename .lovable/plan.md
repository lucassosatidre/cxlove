# Correção da conciliação de Março — taxa efetiva 96,52%

## Diagnóstico

Os parsers de número agora estão corretos (R$ 320 mil bruto iFood é coerente). O bug **não está nos dados**, está em **3 lugares na lógica de classificação**:

### Bug 1 — `classify_ifood_deposits` (Cresol) compara 1:1, deveria ser N:1

iFood deposita o valor previsto de um dia em **múltiplas parcelas** (uma por bandeira/método). A RPC atual pega cada depósito isolado e compara com o total esperado do dia → todos viram `nao_identificado`.

**Exemplo 02/03:** esperado R$ 9.779,77 — chegaram 6 depósitos somando R$ 36.012 (com parcelas de fevereiro misturadas). A soma dos depósitos do dia que pertencem à competência casa quase exato, mas a RPC nem chega a tentar essa comparação.

**Correção:** somar TODOS os depósitos Cresol/iFood do dia e comparar com o total esperado da competência + tolerância. Se sobra dinheiro depositado, o excedente vai pra `fora_periodo` (vendas adjacentes), não pra `nao_identificado`.

### Bug 2 — `categorizeBB` não reconhece "Pix - Recebido" 

111 depósitos somando R$ 993.638,79 caíram como `outro` → `nao_identificado`. Esse "Pix - Recebido" é provavelmente repasse iFood via BB, Brendi, ou outras fontes. Sem categorizar, infla o "recebido geral" e estoura a taxa efetiva.

**Correção:** investigar 5-10 amostras do "Pix - Recebido" para entender o origem (campo `detail` completo) e adicionar regras em `categorizeBB`. Se for Brendi/iFood, marcar como tal.

### Bug 3 — Cresol "fora_periodo" R$ 588.699 inclui não-iFood

Cresol em 18/02 tem R$ 90.294 num único dia que não é razoável pra iFood. Provavelmente são outros tipos de crédito (TED, salário, etc.) que `import-cresol` está marcando como `ifood` indiscriminadamente.

**Correção:** revisar filtro de `import-cresol` — só importar linhas cujo `detail` contém "iFood"/"IFOOD"/"IFOODCOM". Demais linhas: ignorar ou marcar como `outro`.

### Bug 4 — Card "Taxa efetiva" no dashboard usa fórmula errada

Atualmente parece somar todo `audit_bank_deposits.amount` (incluindo o "outro" de R$ 1M e Brendi de R$ 134k) contra vendas competência → taxa fantasma.

**Correção:** taxa efetiva = `(bruto_competência - SUM(deposits WHERE match_status='matched')) / bruto_competência`. Verificar `AuditDashboard.tsx` e ajustar o cálculo.

---

## Plano de execução (em ordem)

### Passo 1 — Investigar dados antes de mexer em código
Rodar queries de inspeção (sem alterar nada):
- 10 amostras de `description` + `detail` dos "Pix - Recebido" categorizados como `outro` no BB
- 10 amostras dos depósitos Cresol em fevereiro >R$ 50k (validar se são realmente iFood ou poluição)
- Verificar onde `AuditDashboard.tsx` calcula a "taxa efetiva total" exibida

### Passo 2 — Corrigir `classify_ifood_deposits` (migration SQL)

Nova lógica:
```sql
-- Para cada deposit_date com depósitos Cresol iFood:
-- 1. Somar TODOS depósitos do dia
-- 2. Pegar esperado_competência + esperado_adjacente
-- 3. Se SUM(depósitos) ≈ esperado_competência (±1%) → marcar TODOS depósitos do dia como 'matched'
-- 4. Se SUM(depósitos) > esperado_competência: distribuir FIFO 
--    (primeiros valores até esperado_competência → matched, resto → fora_periodo)
-- 5. Se SUM < esperado_competência mas há esperado_adjacente: marcar diferença como adjacente
```

### Passo 3 — Corrigir `categorizeBB` (edge function `import-bb`)

Adicionar regras baseadas no que descobrirmos no Passo 1. Provável:
- "Pix - Recebido" + descrição contendo "IFOOD" → `ifood` (mover pra Cresol-equivalente ou criar categoria separada)
- "Pix - Recebido" + "BRENDI" → `brendi`
- Resto → `outro` (mantém)

### Passo 4 — Filtrar linhas não-iFood na `import-cresol`

Adicionar `if (!/ifood/i.test(detail)) continue;` no parser. Re-importar Cresol após o fix.

### Passo 5 — Corrigir cálculo da "taxa efetiva" em `AuditDashboard.tsx`

Trocar fórmula para considerar apenas `match_status='matched'`. Já dentro disso, somar `amount` Cresol + BB matched, dividir pela diferença com `total_bruto_competencia`.

### Passo 6 — Re-rodar conciliação Março
1. Limpar Março (DELETE cascata, igual fizemos antes)
2. Re-importar 3 maquinonas + 3 cresol + 3 bb (parsers já corrigidos + novas regras)
3. Re-rodar `run-audit-match`
4. Validar: taxa efetiva total deve ficar entre 1,5%-3% (média ponderada de iFood + vouchers)

---

## O que NÃO faço

- ❌ Não mexo nos parsers de número (já estão corretos)
- ❌ Não mexo na lógica de FIFO de vouchers (`classify_voucher_deposits` está coerente — Alelo/Ticket/Pluxee/VR mostraram matched razoável)
- ❌ Não crio nova tela ou UI nova
- ❌ Não toco em outras telas/features

## Validação final

Após aplicar:
- Cresol matched ≈ R$ 305-310 mil (vs R$ 312.969 esperado, diferença = taxas iFood ~1-2%)
- BB "outro" deve cair drasticamente (idealmente <R$ 10 mil de ruído real)
- Taxa efetiva total no dashboard: 1,5%-3,5%
- Card vermelho 96,52% sumir
