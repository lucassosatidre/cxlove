## Objetivo

Fazer as RPCs `get_audit_period_totals` e `get_audit_period_deposits` filtrarem por **data** (sale_date / deposit_date) em vez de `audit_period_id`, para que o dashboard de cada mês mostre só o seu mês — mesmo que Jan+Fev+Mar tenham sido importados sob o mesmo `audit_period_id`.

## Ajustes necessários ao prompt (validados na DB)

Achei 2 problemas na migration proposta. Vou corrigir antes de aplicar:

**1. `audit_periods` não tem `start_date` / `end_date`.** Só tem `year` e `month`. Preciso derivar:
```
period_start := make_date(p.year, p.month, 1)
period_end   := (period_start + INTERVAL '1 month' - INTERVAL '1 day')::date
```

**2. `get_audit_period_totals` retorna 7 colunas hoje, não 5.** O frontend usa `total_liquido_ifood` e `total_bruto_ifood` em `AuditDashboard.tsx:313-314` e `AuditIfood.tsx:111`. Se eu dropar e recriar com 5 colunas como o prompt pede, as duas telas quebram. Vou **preservar a assinatura completa** (7 colunas) e só trocar o filtro de `audit_period_id` para data. Também mantenho o filtro `is_competencia = true` que já existia.

## Migration única

`supabase/migrations/<ts>_fix_dashboard_filtra_por_data.sql`:

```sql
-- Fix v4: dashboard filtra por DATA (sale_date / deposit_date),
-- não por audit_period_id. Permite cross-period.
-- audit_periods só tem year/month → derivar range.

CREATE OR REPLACE FUNCTION public.get_audit_period_totals(p_period_id uuid)
RETURNS TABLE (
  total_bruto numeric,
  total_liquido_declarado numeric,
  total_liquido_ifood numeric,
  total_bruto_ifood numeric,
  total_taxa_declarada numeric,
  total_promocao numeric,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH p AS (
    SELECT make_date(year, month, 1) AS d_ini,
           (make_date(year, month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date AS d_fim
    FROM public.audit_periods WHERE id = p_period_id
  )
  SELECT
    COALESCE(SUM(ct.gross_amount), 0),
    COALESCE(SUM(ct.net_amount), 0),
    COALESCE(SUM(ct.net_amount)   FILTER (WHERE ct.deposit_group = 'ifood'), 0),
    COALESCE(SUM(ct.gross_amount) FILTER (WHERE ct.deposit_group = 'ifood'), 0),
    COALESCE(SUM(ct.tax_amount), 0),
    COALESCE(SUM(ct.promotion_amount), 0),
    COUNT(*)
  FROM public.audit_card_transactions ct, p
  WHERE ct.sale_date BETWEEN p.d_ini AND p.d_fim
    AND ct.is_competencia = true;
$$;

CREATE OR REPLACE FUNCTION public.get_audit_period_deposits(p_period_id uuid)
RETURNS TABLE (
  category text, bank text, match_status text,
  total_amount numeric, deposit_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH p AS (
    SELECT make_date(year, month, 1) AS d_ini,
           (make_date(year, month, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date AS d_fim
    FROM public.audit_periods WHERE id = p_period_id
  )
  SELECT d.category, d.bank, d.match_status,
         COALESCE(SUM(d.amount), 0), COUNT(*)
  FROM public.audit_bank_deposits d, p
  WHERE d.deposit_date BETWEEN p.d_ini AND (p.d_fim + INTERVAL '5 days')::date
  GROUP BY d.category, d.bank, d.match_status;
$$;
```

`+5 dias` no segundo: depósitos D+1/D+2 e fim de semana de vendas do fim do mês caem no mês seguinte.

## Frontend

Nada a mudar. A query direta de `audit_bank_deposits` no `AuditDashboard.tsx:~304` para `matched_competencia_amount` continua igual (já é por sale_date naturalmente via classificador).

## Validação após aplicar

Abrir `/admin/auditoria?period=<fev>`:
- Vendido = só `sale_date` em Fev/2026 (esperado bem menor que os R$ 373k atuais que somam Jan+Fev+Mar)
- Depósitos = só `deposit_date` em Fev/2026 + 5 primeiros dias de Mar

Para ver Jan e Mar separados: criar `audit_periods` para esses meses (não precisa reimportar — os dados existentes vão aparecer pelo filtro de data).

## O que NÃO vou tocar

- import-cresol, import-bb, import-maquinona
- `calcDepositGroup`, classificadores, voucher RPCs
- UI fora do que já está
- Nenhum UPDATE em dados existentes