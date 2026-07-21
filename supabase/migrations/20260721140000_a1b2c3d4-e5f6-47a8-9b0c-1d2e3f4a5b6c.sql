-- Notas de Entrada no Vigia: puxa a NF-e de entrada direto do Espião (sem triangular pelo Maná).
create table if not exists public.nfe_entrada (
  id uuid primary key default gen_random_uuid(),
  access_key text unique,
  numero text,
  serie text,
  emit_cnpj text,
  emit_name text,
  dest_cnpj text,
  emission_date timestamptz,
  total_value numeric,
  source text not null default 'espiao',
  raw_xml text,
  created_at timestamptz not null default now()
);
create index if not exists nfe_entrada_emission_idx on public.nfe_entrada (emission_date desc);

create table if not exists public.nfe_entrada_items (
  id uuid primary key default gen_random_uuid(),
  nfe_id uuid not null references public.nfe_entrada(id) on delete cascade,
  seq int,
  c_prod text, c_ean text, description text, ncm text, cfop text,
  u_com text, q_com numeric, v_un_com numeric,
  u_trib text, q_trib numeric, v_un_trib numeric,
  v_prod numeric, v_desc numeric, v_encargos numeric
);
create index if not exists nfe_entrada_items_nfe_idx on public.nfe_entrada_items (nfe_id);

alter table public.nfe_entrada enable row level security;
alter table public.nfe_entrada_items enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='nfe_entrada' and policyname='authenticated full access nfe_entrada') then
    create policy "authenticated full access nfe_entrada" on public.nfe_entrada for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='nfe_entrada_items' and policyname='authenticated full access nfe_entrada_items') then
    create policy "authenticated full access nfe_entrada_items" on public.nfe_entrada_items for all to authenticated using (true) with check (true);
  end if;
end $$;
