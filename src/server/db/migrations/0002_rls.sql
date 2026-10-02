-- O papel bora_app é criado pelo runner antes das migrations.
grant usage on schema public to bora_app;
grant select, insert, update, delete on all tables in schema public to bora_app;
revoke all on _migrations from bora_app;
-- Tabelas futuras criadas pelo papel admin já nascem com grant.
alter default privileges in schema public
  grant select, insert, update, delete on tables to bora_app;

create or replace function current_tenant() returns uuid
language sql stable
as $$ select nullif(current_setting('app.tenant_id', true), '')::uuid $$;

alter table staff_memberships enable row level security;
alter table customer_profiles enable row level security;
alter table tenant_settings enable row level security;
alter table audit_log enable row level security;
alter table otp_codes enable row level security;

create policy tenant_isolation on staff_memberships
  using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
create policy tenant_isolation on customer_profiles
  using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
create policy tenant_isolation on tenant_settings
  using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
create policy tenant_isolation on audit_log
  using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
create policy tenant_isolation on otp_codes
  using (tenant_id = current_tenant()) with check (tenant_id = current_tenant());
