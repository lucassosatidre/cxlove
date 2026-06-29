insert into public.menu_permissions (user_id, menu_key, can_view, can_create, can_edit, can_delete)
select distinct r.user_id, k.key, true, true, true, true
from public.user_roles r
cross join (values ('op.tele'),('op.salao'),('op.entregadores')) k(key)
where r.role = 'lider'
on conflict (user_id, menu_key) do update set can_view=true, can_create=true, can_edit=true, can_delete=true;