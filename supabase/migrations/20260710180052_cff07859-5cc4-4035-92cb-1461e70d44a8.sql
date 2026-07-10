CREATE OR REPLACE FUNCTION public.reconcile_saidas(p_ini date, p_fim date)
 RETURNS TABLE(tipo text, account_name text, valor numeric, vencimento date, fornecedor text, descricao text, categoria text, tx_date date, descricao_banco text, confianca text)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  with saida as (
    select s.id, s.company, abs(s.amount) val, s.vencimento,
      coalesce(s.pagamento, s.vencimento) as dpag,
      s.fornecedor,
      coalesce(nullif(trim(s.descricao),''), s.fornecedor) as descricao,
      s.category, s.payment_method,
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
      and s.payment_method not ilike '%cart%'
      and s.vencimento between p_ini and p_fim
  ),
  deb as (
    select t.id, t.account_id, abs(t.amount) val, t.tx_date, t.description,
           coalesce(t.is_internal_transfer, false) as interna
    from public.cashflow_transactions t
    where t.amount < 0
      and t.tx_date between p_ini - 5 and p_fim + 7
  ),
  cand as (
    select s.id sid, d.id did, s.account_id, s.val, s.vencimento, d.tx_date,
      least(abs(d.tx_date - s.vencimento), abs(d.tx_date - s.dpag)) gap,
      (d.tx_date = s.vencimento or d.tx_date = s.dpag) exato
    from saida s
    join deb d on d.account_id = s.account_id and round(d.val, 2) = round(s.val, 2)
      and ( d.tx_date between s.vencimento - 3 and s.vencimento + 3
         or d.tx_date between s.dpag - 3 and s.dpag + 3 )
  ),
  ranked as (
    select *, row_number() over (partition by sid order by gap, did) rs,
              row_number() over (partition by did order by gap, sid) rd
    from cand
  ),
  matched as (select * from ranked where rs = 1 and rd = 1)
  select
    case when m.did is not null then 'casado' else 'saipos_sem_banco' end,
    s.account_name, s.val, s.vencimento, s.fornecedor, s.descricao, s.category,
    m.tx_date,
    (select d.description from deb d where d.id = m.did),
    case when m.exato then 'ALTA' when m.did is not null then 'MEDIA' else null end
  from saida s
  left join matched m on m.sid = s.id
  union all
  select 'banco_sem_saipos', acc.name, d.val, null::date, null, null, null, d.tx_date, d.description, null
  from deb d
  join public.cashflow_accounts acc on acc.id = d.account_id
  where d.tx_date between p_ini and p_fim
    and d.interna = false
    and not exists (select 1 from matched m where m.did = d.id)
    and d.description not ilike '%fatura%'
    and d.description not ilike '%cart%';
$$;