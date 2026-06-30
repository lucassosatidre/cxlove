alter table public.cashflow_saipos add column if not exists conta text;
alter table public.cashflow_saipos add column if not exists is_retido boolean not null default false;

update public.cashflow_saipos set is_retido = true
where amount < 0 and coalesce(is_frente_caixa, false) = false
  and (
    category in ('Comissão do Ifood','Ifood Ads','Taxa de Antecipação - Ifood','Taxas de Cartão - Crédito, Débito e Pix','Taxas de Cartão - Vouchers','Taxas Brendi')
    or (category = 'Motoboy' and (descricao ilike '%ifood%' or descricao ilike '%frete%' or descricao ilike '%frota%' or descricao ilike '%retenç%' or descricao ilike '%sob demanda%' or descricao ilike '%serviço%'))
  );

create or replace function public.cashflow_monthly_consolidated()
returns table(ym text, entradas numeric, saidas numeric)
language sql stable set search_path = public as $fn$
  with ent as (
    select to_char(tx_date,'YYYY-MM') ym, sum(amount) v
    from public.cashflow_transactions
    where coalesce(is_internal_transfer,false) = false and amount > 0
    group by 1
  ),
  sai as (
    select to_char(vencimento,'YYYY-MM') ym, sum(amount) v
    from public.cashflow_saipos
    where amount < 0 and coalesce(is_frente_caixa,false) = false and coalesce(is_retido,false) = false
    group by 1
  )
  select coalesce(e.ym, s.ym) ym, coalesce(e.v,0) entradas, coalesce(s.v,0) saidas
  from ent e full outer join sai s on e.ym = s.ym
  order by 1;
$fn$;

create or replace function public.cashflow_category_summary(p_start date, p_end date)
returns table(company text, category text, total numeric, n bigint)
language sql stable set search_path = public as $fn$
  select company, coalesce(nullif(trim(category),''),'Sem categoria') category, sum(amount) total, count(*) n
  from public.cashflow_saipos
  where amount < 0 and coalesce(is_frente_caixa,false) = false and coalesce(is_retido,false) = false
    and vencimento between p_start and p_end
  group by company, coalesce(nullif(trim(category),''),'Sem categoria')
  order by total asc;
$fn$;

create or replace function public.cashflow_upcoming_bills()
returns table(vencimento date, amount numeric, category text, fornecedor text)
language sql stable set search_path = public as $fn$
  select vencimento, amount, category, fornecedor
  from public.cashflow_saipos
  where paid = false and amount < 0 and coalesce(is_frente_caixa,false) = false and coalesce(is_retido,false) = false
    and vencimento >= current_date
  order by vencimento;
$fn$;

create or replace function public.cashflow_upcoming_bills_daily(p_start date default current_date, p_days int default 30)
returns table(date date, total numeric, n bigint, items jsonb)
language sql stable set search_path = public as $fn$
  with days as (select generate_series(p_start, p_start + (greatest(p_days,1)-1), interval '1 day')::date dia)
  select d.dia, coalesce(sum(abs(s.amount)),0), coalesce(count(s.id),0),
    coalesce(jsonb_agg(jsonb_build_object('categoria', coalesce(nullif(trim(s.category),''),'Sem categoria'),'fornecedor', s.fornecedor,'valor', abs(s.amount)) order by abs(s.amount) desc) filter (where s.id is not null), '[]'::jsonb)
  from days d
  left join public.cashflow_saipos s on s.vencimento = d.dia and s.paid=false and s.amount<0 and coalesce(s.is_frente_caixa,false)=false and coalesce(s.is_retido,false)=false
  group by d.dia order by d.dia;
$fn$;

create or replace function public.cashflow_retido_summary(p_start date, p_end date)
returns table(category text, total numeric, n bigint)
language sql stable set search_path = public as $fn$
  select coalesce(nullif(trim(category),''),'Sem categoria') category, sum(abs(amount)) total, count(*) n
  from public.cashflow_saipos
  where amount < 0 and coalesce(is_retido,false) = true and vencimento between p_start and p_end
  group by 1 order by total desc;
$fn$;
grant execute on function public.cashflow_retido_summary(date, date) to anon, authenticated;