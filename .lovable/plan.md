## Limpar todos os dados de auditoria — Fev, Mar e Abr/2026

### Períodos identificados (todos serão zerados, mas mantidos)

| Período | ID | Status atual |
|---|---|---|
| Fev/2026 | `6112cd94-e577-44b2-aac7-3964bbac495a` | importado |
| Mar/2026 | `74d75c7c-a4f2-4e58-ac97-721bf8ca9c4b` | importado |
| Abr/2026 | `40e431fc-9766-4846-a8c8-0102df23922a` | aberto |

Os 3 períodos ficam preservados em `audit_periods`, mas voltam para status `aberto` e sem nenhum dado importado.

### O que será apagado (filtrado pelos 3 period_ids)

**Extratos brutos**
- `audit_card_transactions` (Maquinona)
- `audit_bank_deposits` (Cresol + BB)
- `audit_imports` (histórico de uploads Maquinona/Cresol/BB)

**Vouchers**
- `voucher_lot_items`
- `voucher_lots`
- `voucher_imports`
- `voucher_adjustments` (se houver)

**Resultados de conciliação**
- `audit_daily_matches` (iFood)
- `audit_voucher_matches` (legado)
- `audit_voucher_competencia` (novo)

**Histórico**
- `audit_period_log` — também limpo para zerar a trilha

### O que NÃO será mexido

- Os 3 registros em `audit_periods` (continuam existindo, só voltam para status `aberto`)
- Tabelas de outros módulos (Tele, Salão, Entregadores, etc.)
- Dados de meses fora desses 3 períodos
- Edge Functions, RPCs, RLS

### Como será executado

Uma única migration SQL com `DELETE ... WHERE audit_period_id IN (3 ids)` em cada tabela, na ordem correta de dependência (items antes de lots; deposits/transactions/lots antes de matches), seguido de `UPDATE audit_periods SET status='aberto'`.

### Validação pós-execução

SELECT de contagem em cada tabela filtrando pelos 3 period_ids, esperando 0 em todas.
