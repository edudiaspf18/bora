create or replace function staff_memberships_for(p_staff uuid)
returns table (tenant_id uuid, role text, slug text, name text)
language sql stable security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select m.tenant_id, m.role, t.slug, t.name
  from public.staff_memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.staff_id = p_staff and t.status = 'active'
  order by t.name
$$;

revoke all on function staff_memberships_for(uuid) from public;
grant execute on function staff_memberships_for(uuid) to bora_app;
