-- ===== profiles =====
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
do $$ begin create policy "auth select profiles" on public.profiles for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "auth insert profiles" on public.profiles for insert with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "auth update profiles" on public.profiles for update using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "auth delete profiles" on public.profiles for delete using (true); exception when duplicate_object then null; end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $fn$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end; $fn$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

insert into public.profiles (id, email, full_name)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(u.email,'@',1))
from auth.users u
on conflict (id) do nothing;

-- ===== menu_permissions =====
create table if not exists public.menu_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  menu_key text not null,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, menu_key)
);
alter table public.menu_permissions enable row level security;
do $$ begin create policy "auth select menuperm" on public.menu_permissions for select using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "auth insert menuperm" on public.menu_permissions for insert with check (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "auth update menuperm" on public.menu_permissions for update using (true); exception when duplicate_object then null; end $$;
do $$ begin create policy "auth delete menuperm" on public.menu_permissions for delete using (true); exception when duplicate_object then null; end $$;

insert into public.menu_permissions (user_id, menu_key, can_view)
select p.id, 'dashboard', not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'entregador')
from public.profiles p
on conflict (user_id, menu_key) do nothing;
insert into public.menu_permissions (user_id, menu_key, can_view, can_create, can_edit, can_delete)
select r.user_id, k.key, true, true, true, true
from public.user_roles r
cross join (values ('dashboard'),('dashboard.controle_caixa'),('dashboard.abrir_caixa'),('op.tele'),('op.tele.conciliacao'),('op.salao'),('op.salao.conciliacao'),('op.entregadores'),('op.maquininhas'),('audit.importacoes'),('audit.maquinona'),('audit.vouchers'),('audit.brendi'),('audit.ifood'),('audit.relatorios'),('fluxo_caixa'),('clau.memoria'),('config.usuarios')) k(key)
where r.role = 'admin'
on conflict (user_id, menu_key) do update set can_view = true, can_create = true, can_edit = true, can_delete = true;
insert into public.menu_permissions (user_id, menu_key, can_view, can_create, can_edit, can_delete)
select distinct r.user_id, 'op.tele', true, true, true, false from public.user_roles r where r.role = 'caixa_tele'
on conflict (user_id, menu_key) do update set can_view=true, can_create=true, can_edit=true;
insert into public.menu_permissions (user_id, menu_key, can_view, can_create, can_edit, can_delete)
select distinct r.user_id, 'op.salao', true, true, true, false from public.user_roles r where r.role = 'caixa_salao'
on conflict (user_id, menu_key) do update set can_view=true, can_create=true, can_edit=true;
insert into public.menu_permissions (user_id, menu_key, can_view, can_create, can_edit, can_delete)
select distinct r.user_id, k.key, true, true, true, false from public.user_roles r
cross join (values ('op.tele'),('op.salao'),('op.entregadores')) k(key)
where r.role = 'lider'
on conflict (user_id, menu_key) do update set can_view=true, can_create=true, can_edit=true;