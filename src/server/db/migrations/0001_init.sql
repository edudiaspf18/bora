create extension if not exists pgcrypto;

-- Globais (sem RLS)
create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name text not null,
  vertical text not null check (vertical in ('restaurante', 'lanchonete', 'acaiteria', 'quiosque')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  timezone text not null default 'America/Sao_Paulo',
  country text not null default 'BR',
  currency text not null default 'BRL',
  created_at timestamptz not null default now()
);

create table tenant_domains (
  host text primary key check (host = lower(host)),
  tenant_id uuid not null references tenants (id) on delete cascade,
  verified boolean not null default false
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  name text,
  created_at timestamptz not null default now()
);

create table staff_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table throttles (
  key text primary key,
  failures integer not null default 0,
  window_start timestamptz not null default now(),
  blocked_until timestamptz
);

create table password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff_users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Por loja (RLS na migration 0002)
create table staff_memberships (
  tenant_id uuid not null references tenants (id) on delete cascade,
  staff_id uuid not null references staff_users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'attendant')),
  primary key (tenant_id, staff_id)
);

create table customer_profiles (
  tenant_id uuid not null references tenants (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tenant_id, customer_id)
);

create table tenant_settings (
  tenant_id uuid primary key references tenants (id) on delete cascade,
  theme jsonb not null default '{}'::jsonb,
  service_modes text[] not null default '{pickup}'
    check (service_modes <@ array['delivery', 'pickup', 'dine_in']),
  payment_methods text[] not null default '{}',
  contact jsonb not null default '{}'::jsonb,
  address jsonb not null default '{}'::jsonb
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  actor text not null,
  action text not null,
  resource text,
  ip text,
  created_at timestamptz not null default now()
);

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index otp_codes_lookup on otp_codes (tenant_id, phone, created_at desc);
