## Limpar dados de auditoria — Março/2026 e Abril/2026

### Períodos identificados
- **Mar/2026**: `74d75c7c-a4f2-4e58-ac97-721bf8ca9c4b` (status: conciliado)
- **Abr/2026**: `40e431fc-9766-4846-a8c8-0102df23922a` (status: aberto)

Os dois períodos serão **mantidos** (registros em `audit_periods`). Apenas os dados importados e os resultados de conciliação serão apagados, deixando ambos prontos para reimportação do zero.

### Tabelas que serão limpas (apenas linhas dos 2 períodos)

Extratos importados:
- `audit_card_transactions` — vendas Maquinona
- `audit_bank_deposits` — depósitos Cresol e BB
- `audit_imports` — registros de importação Maquinona/Cresol/BB

Extratos das operadoras (Pluxee/Alelo/Ticket/VR):
- `voucher_lot_items`
- `voucher_lots`
- `voucher_imports`
- `voucher_adjustments`

Resultados de conciliação:
- `audit_daily_matches` — matches iFood
- `audit_voucher_matches` — matches voucher

Histórico (opcional, vou manter):
- `audit_period_log` — fica preservado para rastreabilidade

### Status dos períodos após limpeza

Vou também resetar o status de Mar/2026 de `conciliado` → `aberto`, para que ele apareça pronto para nova importação como Abril.

### Como será executado

Tudo via uma migration SQL única, com `DELETE` filtrado por `audit_period_id IN (...)` para garantir que **nenhum dado de outros meses (Jan, Fev, etc.) seja afetado**.

### Validação pós-execução

Vou rodar um SELECT de contagem em cada tabela filtrando pelos dois período_ids para confirmar que tudo zerou.
