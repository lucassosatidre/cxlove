-- 1) Cobertura do extrato por conta (para a aba "Extratos")
create or replace function public.cashflow_statement_coverage()
returns table(account_id uuid, account_name text, company text, min_tx date, max_tx date, n bigint, saldo_final numeric)
language sql stable as $fn$
  select a.id, a.name, a.company,
    min(t.tx_date), max(t.tx_date), count(t.id),
    (select t2.running_balance from public.cashflow_transactions t2 where t2.account_id = a.id order by t2.tx_date desc, t2.source_seq desc limit 1)
  from public.cashflow_accounts a
  left join public.cashflow_transactions t on t.account_id = a.id
  where a.active
  group by a.id, a.name, a.company
  order by a.company, a.name;
$fn$;
grant execute on function public.cashflow_statement_coverage() to anon, authenticated;

create or replace function public.reconcile_saidas(p_ini date, p_fim date)
returns table(
  tipo text, account_name text, valor numeric, vencimento date,
  fornecedor text, categoria text, tx_date date, descricao_banco text, confianca text
)
language sql stable as $fn$
  with saida as (
    select s.id, s.company, abs(s.amount) val, s.vencimento, s.fornecedor, s.descricao, s.category, s.payment_method,
      acc.id as account_id, acc.name as account_name
    from public.cashflow_saipos s
    join public.cashflow_accounts acc on acc.active and (
         (s.payment_method ilike '%banco do brasil%' and acc.name = 'Banco do Brasil')
      or (s.payment_method ilike '%cresol%'          and acc.name = 'Cresol')
      or (s.payment_method ilike '%ifood%'           and acc.name = 'iFood Pago')
      or (s.payment_method ilike '%c6%'              and acc.name = case when s.company = 'prover' then 'C6 Prover' else 'C6 Propósito' end)
    )
    where s.amount < 0 and coalesce(s.is_frente_caixa, false) = false and s.paid = true
      and s.payment_method not ilike '%crédito%'
      and s.vencimento between p_ini and p_fim
  ),
  deb as (
    select t.id, t.account_id, abs(t.amount) val, t.tx_date, t.description
    from public.cashflow_transactions t
    where t.amount < 0 and coalesce(t.is_internal_transfer, false) = false
      and t.tx_date between p_ini - 3 and p_fim + 3
  ),
  cand as (
    select s.id sid, d.id did, s.account_id, s.val, s.vencimento, d.tx_date,
      abs(d.tx_date - s.vencimento) gap, (d.tx_date = s.vencimento) exato
    from saida s
    join deb d on d.account_id = s.account_id and round(d.val, 2) = round(s.val, 2)
      and d.tx_date between s.vencimento - 3 and s.vencimento + 3
  ),
  ranked as (
    select *, row_number() over (partition by sid order by gap, did) rs,
              row_number() over (partition by did order by gap, sid) rd
    from cand
  ),
  matched as (select * from ranked where rs = 1 and rd = 1)
  select
    case when m.did is not null then 'casado' else 'saipos_sem_banco' end,
    s.account_name, s.val, s.vencimento, s.fornecedor, s.category,
    m.tx_date,
    (select d.description from deb d where d.id = m.did),
    case when m.exato then 'ALTA' when m.did is not null then 'MEDIA' else null end
  from saida s
  left join matched m on m.sid = s.id
  union all
  select 'banco_sem_saipos', acc.name, d.val, null::date, null, null, d.tx_date, d.description, null
  from deb d
  join public.cashflow_accounts acc on acc.id = d.account_id
  where d.tx_date between p_ini and p_fim
    and not exists (select 1 from matched m where m.did = d.id)
    and d.description not ilike '%fatura%'
    and d.description not ilike '%cart%';
$fn$;
grant execute on function public.reconcile_saidas(date, date) to anon, authenticated;