
-- 1. profiles
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
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
drop policy if exists "auth_select_profiles" on public.profiles;
create policy "auth_select_profiles" on public.profiles for select to authenticated using (true);
drop policy if exists "auth_insert_profiles" on public.profiles;
create policy "auth_insert_profiles" on public.profiles for insert to authenticated with check (true);
drop policy if exists "auth_update_profiles" on public.profiles;
create policy "auth_update_profiles" on public.profiles for update to authenticated using (true);
drop policy if exists "auth_delete_profiles" on public.profiles;
create policy "auth_delete_profiles" on public.profiles for delete to authenticated using (true);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email, full_name)
select u.id, u.email,
       coalesce(nullif(u.raw_user_meta_data->>'full_name',''),
                nullif(u.raw_user_meta_data->>'name',''),
                initcap(replace(split_part(u.email,'@',1),'.',' ')))
from auth.users u
on conflict (id) do nothing;

-- 2. menu_permissions
create table if not exists public.menu_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  menu_key text not null,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id, menu_key)
);
grant select, insert, update, delete on public.menu_permissions to authenticated;
grant all on public.menu_permissions to service_role;
alter table public.menu_permissions enable row level security;
drop policy if exists "auth_select_mp" on public.menu_permissions;
create policy "auth_select_mp" on public.menu_permissions for select to authenticated using (true);
drop policy if exists "auth_insert_mp" on public.menu_permissions;
create policy "auth_insert_mp" on public.menu_permissions for insert to authenticated with check (true);
drop policy if exists "auth_update_mp" on public.menu_permissions;
create policy "auth_update_mp" on public.menu_permissions for update to authenticated using (true);
drop policy if exists "auth_delete_mp" on public.menu_permissions;
create policy "auth_delete_mp" on public.menu_permissions for delete to authenticated using (true);

-- 3. migra acessos atuais
insert into public.menu_permissions (user_id, menu_key, can_view, can_create, can_edit, can_delete)
select p.id, 'dashboard',
       not exists (select 1 from public.user_roles ur where ur.user_id=p.id and ur.role='entregador'),
       false, false, false
from public.profiles p
on conflict (user_id, menu_key) do nothing;

insert into public.menu_permissions (user_id, menu_key, can_view, can_create, can_edit, can_delete)
select ur.user_id, k.key, true, true, true, true
from public.user_roles ur
cross join (values ('dashboard'),('op.tele'),('op.salao'),('op.entregadores'),('op.maquininhas'),
  ('audit.importacoes'),('audit.maquinona'),('audit.vouchers'),('audit.brendi'),('audit.ifood'),
  ('audit.relatorios'),('fluxo_caixa'),('clau.memoria'),('config.usuarios')) k(key)
where ur.role='admin'
on conflict (user_id, menu_key) do update set can_view=true, can_create=true, can_edit=true, can_delete=true;

insert into public.menu_permissions (user_id, menu_key, can_view, can_create, can_edit, can_delete)
select ur.user_id, 'op.tele', true, true, true, true
from public.user_roles ur where ur.role='caixa_tele'
on conflict (user_id, menu_key) do update set can_view=true, can_create=true, can_edit=true, can_delete=true;

insert into public.menu_permissions (user_id, menu_key, can_view, can_create, can_edit, can_delete)
select ur.user_id, 'op.salao', true, true, true, true
from public.user_roles ur where ur.role='caixa_salao'
on conflict (user_id, menu_key) do update set can_view=true, can_create=true, can_edit=true, can_delete=true;

insert into public.menu_permissions (user_id, menu_key, can_view, can_create, can_edit, can_delete)
select ur.user_id, k.key, true, true, true, true
from public.user_roles ur
cross join (values ('op.tele'),('op.salao'),('op.entregadores')) k(key)
where ur.role='lider'
on conflict (user_id, menu_key) do update set can_view=true, can_create=true, can_edit=true, can_delete=true;

-- 4. políticas do bucket avatars
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects for select using (bucket_id='avatars');
drop policy if exists "avatars_auth_insert" on storage.objects;
create policy "avatars_auth_insert" on storage.objects for insert to authenticated with check (bucket_id='avatars');
drop policy if exists "avatars_auth_update" on storage.objects;
create policy "avatars_auth_update" on storage.objects for update to authenticated using (bucket_id='avatars');
drop policy if exists "avatars_auth_delete" on storage.objects;
create policy "avatars_auth_delete" on storage.objects for delete to authenticated using (bucket_id='avatars');
