-- Catálogo (sub-projeto 2). Sem nenhuma coluna de estoque.
create table catalog_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  position integer not null default 0,
  active boolean not null default true,
  unique (tenant_id, id)
);

create table catalog_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  category_id uuid not null,
  name text not null check (length(name) between 1 and 120),
  description text not null default '' check (length(description) <= 500),
  image_url text check (image_url is null or (image_url ~ '^https://' and length(image_url) <= 500)),
  position integer not null default 0,
  active boolean not null default true,
  paused_until timestamptz,
  dietary text[] not null default '{}',
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references catalog_categories (tenant_id, id)
);
create index catalog_products_category_idx on catalog_products (tenant_id, category_id);

create table catalog_variants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  product_id uuid not null,
  name text not null check (length(name) between 1 and 60),
  price_cents integer not null check (price_cents >= 0 and price_cents <= 99999999),
  position integer not null default 0,
  active boolean not null default true,
  unique (tenant_id, id),
  foreign key (tenant_id, product_id) references catalog_products (tenant_id, id) on delete cascade
);
create index catalog_variants_product_idx on catalog_variants (tenant_id, product_id);

create table option_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer not null default 1 check (max_select >= 1),
  position integer not null default 0,
  unique (tenant_id, id),
  check (min_select <= max_select)
);

create table option_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  group_id uuid not null,
  name text not null check (length(name) between 1 and 80),
  price_delta_cents integer not null default 0 check (price_delta_cents >= 0 and price_delta_cents <= 99999999),
  position integer not null default 0,
  active boolean not null default true,
  unique (tenant_id, id),
  foreign key (tenant_id, group_id) references option_groups (tenant_id, id) on delete cascade
);

create table product_option_groups (
  tenant_id uuid not null references tenants (id) on delete cascade,
  product_id uuid not null,
  group_id uuid not null,
  position integer not null default 0,
  primary key (product_id, group_id),
  foreign key (tenant_id, product_id) references catalog_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, group_id) references option_groups (tenant_id, id) on delete cascade
);

create table schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  unique (tenant_id, id)
);

create table schedule_windows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  schedule_id uuid not null,
  weekday integer not null check (weekday between 0 and 6),
  opens_min integer not null check (opens_min between 0 and 1439),
  closes_min integer not null check (closes_min between 1 and 1440),
  check (opens_min <> closes_min),
  foreign key (tenant_id, schedule_id) references schedules (tenant_id, id) on delete cascade
);

create table category_schedules (
  tenant_id uuid not null references tenants (id) on delete cascade,
  category_id uuid not null,
  schedule_id uuid not null,
  primary key (category_id, schedule_id),
  foreign key (tenant_id, category_id) references catalog_categories (tenant_id, id) on delete cascade,
  foreign key (tenant_id, schedule_id) references schedules (tenant_id, id) on delete cascade
);

create table product_schedules (
  tenant_id uuid not null references tenants (id) on delete cascade,
  product_id uuid not null,
  schedule_id uuid not null,
  primary key (product_id, schedule_id),
  foreign key (tenant_id, product_id) references catalog_products (tenant_id, id) on delete cascade,
  foreign key (tenant_id, schedule_id) references schedules (tenant_id, id) on delete cascade
);

do $$
declare t text;
begin
  foreach t in array array[
    'catalog_categories', 'catalog_products', 'catalog_variants', 'option_groups',
    'option_items', 'product_option_groups', 'schedules', 'schedule_windows',
    'category_schedules', 'product_schedules'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = current_tenant()) with check (tenant_id = current_tenant())',
      t);
  end loop;
end $$;
