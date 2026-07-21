-- Opções/tags gerenciáveis dos Lançamentos (categoria, método, conta, fornecedor, descrição).
-- Permite criar novas opções que refletem nos filtros e no formulário, base para o DRE.
create table if not exists public.cashflow_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('categoria','metodo','conta','fornecedor','descricao')),
  value text not null,
  color text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists cashflow_options_kind_value_uidx
  on public.cashflow_options (kind, lower(value));

alter table public.cashflow_options enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='cashflow_options'
      and policyname='authenticated full access cashflow_options'
  ) then
    create policy "authenticated full access cashflow_options"
      on public.cashflow_options for all to authenticated using (true) with check (true);
  end if;
end $$;
