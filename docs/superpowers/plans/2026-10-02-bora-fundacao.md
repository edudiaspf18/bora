# Bora Fundação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a base multi-loja do Bora: tenants por subdomínio, isolamento por RLS no Postgres, auth de staff e de cliente, tema por loja e marca Bora.

**Architecture:** Next.js 15 (App Router) full-stack. O `middleware.ts` resolve o `Host` e faz rewrite para rotas internas (`/panel/*` para o painel, `/s/{segmento}/*` para a vitrine). Todo acesso a dados por loja passa por `withTenant`, que seta `app.tenant_id` na transação; RLS no Postgres faz o isolamento, com um papel de aplicação sem `BYPASSRLS`. Sessões são JWT (jose) em cookies host-only.

**Tech Stack:** Next.js 15, React 19, TypeScript, PostgreSQL 16, drizzle-orm + postgres.js, Zod, jose, @node-rs/argon2, Tailwind v4, Shadcn, lucide-react, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-02-bora-fundacao-design.md`

## Global Constraints

Valores copiados da spec. Toda task os herda.

- Stack: Next.js (App Router) + TypeScript + PostgreSQL + Drizzle + Zod + Tailwind + Shadcn + lucide-react.
- Server Components por padrão; `'use client'` só com estado ou eventos; sem `any`; Tailwind apenas (sem CSS puro, sem `.module.css`); ícones só de `lucide-react`; `focus-visible:` (nunca `focus:`) e `transition-all duration-200` em toda interação.
- Banco: PostgreSQL local gerenciado no pgAdmin via `DATABASE_URL`, sem Docker. Antes de usar, verificar com `psql -lqt` e criar com `createdb` se não existir.
- IDs UUID v7; dinheiro em centavos (`integer`); datas em `timestamptz`.
- A aplicação conecta com papel Postgres sem `BYPASSRLS`; migrations rodam com outro papel.
- Staff: e-mail + senha com Argon2id; cookie `httpOnly`, `secure`, `sameSite=lax`; 5 falhas bloqueiam por 15 min (por e-mail e por IP); reset de senha por e-mail com token de uso único e validade de 30 min.
- Cliente: pedido como convidado (nome + telefone); OTP de 6 dígitos, validade de 10 min, 5 tentativas, guardado com hash, rate limit por telefone e por IP; sessão em cookie isolado por subdomínio.
- CSP com nonce gerado no middleware. CPF não é coletado.
- Slugs reservados: `app`, `www`, `api`, `admin`, `static`.
- Nenhuma ocorrência de "baratao" no código do Bora (fora de `docs/` e `README.md`).
- Estética: monocromática Zinc, uma cor de destaque, bordas 1px (`border-zinc-200` / `border-zinc-800`), `tracking-tight` em títulos, `text-zinc-500` em texto secundário, sem gradientes roxo/azul, sem sombras pesadas.
- Mensagens ao usuário em português (pt-BR).

## Desvios da spec (já aplicados na spec)

1. Sessão do staff é JWT próprio (jose), não Auth.js. Staff e cliente usam o mesmo módulo de sessão; evita dependência beta e o tenant ativo é claim nosso.
2. O tenant chega às páginas pelo segmento da rota reescrita (`/s/{slug|host}`), não por header `x-tenant-slug`. O middleware roda no Edge e não consulta o banco.
3. Variáveis de tema se chamam `--brand` e `--brand-foreground`. O Shadcn já usa `--accent` para outra coisa; `--primary` é mapeado para `--brand`.
4. `tenants` e `tenant_domains` são globais (sem RLS): a vitrine precisa resolver o tenant antes de saber o `tenant_id`.

## Review Focus

Entradas que a spec implica e que mais provavelmente quebram. Cada linha tem teste na task indicada.

1. Header `Host` com maiúsculas, porta, ponto final, `..`, colchetes IPv6 ou caracteres estranhos deve resolver para a loja certa ou para 404, nunca lançar erro (Task 4).
2. Cor de destaque com injeção de CSS (`#fff;}body{display:none`), hex de 3 dígitos, maiúsculas, branco ou preto puro: rejeitar ou normalizar, nunca emitir CSS inválido (Task 5).
3. Código OTP com zeros à esquerda (`004213`), reuso depois do sucesso e digitação depois de 5 erros: o zero à esquerda funciona, o reuso falha, depois de 5 erros nem o código certo passa (Task 10).
4. Telefone digitado como `(62) 99828-6169`, `+55 62 998286169`, `5562998286169`, com letras ou curto demais: normaliza para E.164 ou rejeita (Task 10).
5. E-mail do staff com maiúsculas e espaços, senha de 10 mil caracteres (DoS no Argon2) e 20 logins errados concorrentes: e-mail normaliza, senha longa é rejeitada antes do hash, bloqueio vale mesmo com concorrência (Tasks 7 e 8).

Também coberto: tabela com `tenant_id` sem policy de RLS falha o teste de schema (Task 2).

---

## File Structure

```
bora/
  .github/workflows/ci.yml
  .env.example
  next.config.ts
  playwright.config.ts
  vitest.config.ts
  scripts/migrate.ts
  scripts/seed.ts
  src/
    middleware.ts
    app/
      layout.tsx                         raiz (fontes, dynamic)
      globals.css
      (platform)/page.tsx                landing
      panel/                             painel do staff (host app.*)
        layout.tsx
        page.tsx
        actions.ts
        login/page.tsx
        esqueci-senha/page.tsx
        redefinir-senha/page.tsx
      s/[slug]/                          vitrine (host {slug}.*)
        layout.tsx
        page.tsx
        not-found.tsx
        entrar/page.tsx
        entrar/actions.ts
        conta/page.tsx
    server/
      db/{client,schema,tenant,migrate}.ts
      db/migrations/{0001_init,0002_rls,0003_staff_memberships_fn}.sql
      tenancy/{host,lookup,cached}.ts
      security/csp.ts
      theme/{contrast,theme,load}.ts
      auth/{can,password,session,cookies,ip,throttle,staff,reset,customer}.ts
      otp/{phone,sender,otp}.ts
      audit.ts
    components/ui/                       Shadcn
  tests/
    global-setup.ts
    helpers/db.ts
    db/{schema,rls}.test.ts
    tenancy/{host,middleware,lookup}.test.ts
    security/csp.test.ts
    theme/{contrast,theme}.test.ts
    auth/{can,password,session,ip,throttle,staff,reset}.test.ts
    otp/{phone,otp}.test.ts
    no-legacy-names.test.ts
    e2e/*.spec.ts
```

---

### Task 1: Scaffold, tooling e bancos

**Files:**
- Create: toda a base Next.js (via create-next-app), `vitest.config.ts`, `.env.example`, `.env`, `tests/smoke.test.ts`
- Modify: `package.json`, `.gitignore`, `next.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`

**Interfaces:**
- Produces: scripts npm `dev`, `build`, `lint`, `typecheck`, `test`, `db:migrate`, `db:seed`, `e2e`; alias `@/*` → `src/*`; variáveis de ambiente de `.env.example`.

- [ ] **Step 1: Gerar o scaffold em pasta temporária e copiar**

O diretório já tem `README.md`, `.gitignore` e `docs/`, que não podem ser sobrescritos.

```bash
cd /Users/user/DevWeb/bora
SCAFFOLD="$(mktemp -d)/app"
npx create-next-app@15 "$SCAFFOLD" --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack --yes
rsync -a --exclude .git --exclude README.md --exclude .gitignore --exclude node_modules "$SCAFFOLD"/ ./
cat "$SCAFFOLD"/.gitignore >> .gitignore
npm install
```

Expected: `npm install` termina sem erro; existe `src/app/page.tsx`.

- [ ] **Step 2: Instalar dependências**

```bash
npm install drizzle-orm postgres zod uuidv7 jose @node-rs/argon2
npm install -D vitest tsx @playwright/test
```

- [ ] **Step 3: Inicializar Shadcn (base Zinc) e adicionar componentes**

```bash
npx shadcn@latest init -d --base-color zinc
npx shadcn@latest add button input label card -y
```

Se o CLI não aceitar `--base-color`, escolha **Zinc** no prompt.

- [ ] **Step 4: Dark mode por `prefers-color-scheme`**

Em `src/app/globals.css`:
1. Troque `@custom-variant dark (&:is(.dark *));` por `@custom-variant dark (@media (prefers-color-scheme: dark));`.
2. Pegue o conteúdo do bloco `.dark { ... }` e reescreva como `@media (prefers-color-scheme: dark) { :root { ...mesmo conteúdo... } }`.

Verify: `grep -n "prefers-color-scheme" src/app/globals.css` mostra as duas ocorrências, e `grep -n "^\.dark" src/app/globals.css` não retorna nada.

- [ ] **Step 5: Layout raiz com as 3 fontes e render dinâmico**

Substitua `src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Fraunces, Geist, Inter } from "next/font/google";
import "./globals.css";

// Nonce de CSP exige render dinâmico em todas as páginas.
export const dynamic = "force-dynamic";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const editorial = Fraunces({ subsets: ["latin"], variable: "--font-editorial" });

export const metadata: Metadata = {
  title: { default: "Bora", template: "%s · Bora" },
  description: "Cardápio digital e pedidos para o seu negócio de comida.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${geist.variable} ${inter.variable} ${editorial.variable}`}
    >
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
```

Apague `src/app/page.tsx` (a landing nasce na Task 11 em `(platform)/page.tsx`) e crie um placeholder temporário `src/app/(platform)/page.tsx`:

```tsx
export default function Placeholder() {
  return <main className="p-12">bora</main>;
}
```

- [ ] **Step 6: `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@node-rs/argon2"],
};

export default nextConfig;
```

- [ ] **Step 7: `vitest.config.ts`**

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env");
} catch {
  // CI injeta as variáveis direto no ambiente.
}

// Testes sempre usam o banco de teste.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
process.env.DATABASE_ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "";
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-123456";
process.env.ROOT_DOMAIN = "bora.test";
process.env.PANEL_ORIGIN = "http://app.bora.test";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
```

- [ ] **Step 8: Scripts do `package.json`**

Em `"scripts"`, deixe exatamente:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "db:migrate": "tsx --env-file=.env scripts/migrate.ts",
  "db:seed": "tsx --env-file=.env scripts/seed.ts",
  "e2e": "playwright test"
}
```

- [ ] **Step 9: `.env.example` e `.env`**

`.env.example`:

```
ROOT_DOMAIN=localhost
PANEL_ORIGIN=http://app.localhost:3000
SESSION_SECRET=troque-por-uma-string-aleatoria-de-32-bytes-ou-mais
OTP_SENDER=console
APP_DB_PASSWORD=bora_app_dev
DATABASE_ADMIN_URL=postgresql://SEU_USUARIO@localhost:5432/bora
DATABASE_URL=postgresql://bora_app:bora_app_dev@localhost:5432/bora
TEST_DATABASE_ADMIN_URL=postgresql://SEU_USUARIO@localhost:5432/bora_test
TEST_DATABASE_URL=postgresql://bora_app:bora_app_dev@localhost:5432/bora_test
```

Crie `.env` copiando e preenchendo: `cp .env.example .env`, troque `SEU_USUARIO` por `$(whoami)` e `SESSION_SECRET` por `$(openssl rand -hex 32)`. O `.gitignore` já ignora `.env`; garanta que `.env.example` NÃO está ignorado: `git check-ignore .env.example` não deve imprimir nada.

- [ ] **Step 10: Criar os bancos no servidor gerenciado pelo pgAdmin**

```bash
psql -lqt | cut -d'|' -f1 | grep -w bora || createdb bora
psql -lqt | cut -d'|' -f1 | grep -w bora_test || createdb bora_test
psql -lqt | cut -d'|' -f1 | grep -w bora
```

Expected: as linhas `bora` e `bora_test` aparecem.

- [ ] **Step 11: Teste de fumaça**

`tests/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("ambiente de teste", () => {
  it("aponta para o banco de teste", () => {
    expect(process.env.DATABASE_URL).toContain("bora_test");
    expect(process.env.DATABASE_ADMIN_URL).toContain("bora_test");
  });
});
```

Run: `npm test`
Expected: PASS (1 test).

Run: `npm run typecheck && npm run lint && npm run build`
Expected: os três passam.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold next 15, shadcn, vitest e env"
```

---

### Task 2: Migrations, papéis e RLS

**Files:**
- Create: `src/server/db/migrate.ts`, `src/server/db/migrations/0001_init.sql`, `src/server/db/migrations/0002_rls.sql`, `scripts/migrate.ts`, `tests/global-setup.ts`, `tests/helpers/db.ts`, `tests/db/schema.test.ts`
- Modify: `vitest.config.ts` (adicionar `globalSetup`)

**Interfaces:**
- Produces: `migrate(adminUrl: string, appPassword: string): Promise<string[]>` (retorna nomes aplicados); papel `bora_app` (LOGIN, sem SUPERUSER, sem BYPASSRLS); função SQL `current_tenant() returns uuid`; helpers de teste `adminSql`, `resetDb()`, `createTenant(slug, name?, vertical?)`, `closeAdmin()`.

- [ ] **Step 1: Escrever o teste de schema (falha primeiro)**

`tests/helpers/db.ts`:

```ts
import postgres from "postgres";

export const adminSql = postgres(process.env.DATABASE_ADMIN_URL!, {
  max: 2,
  onnotice: () => {},
});

export async function resetDb(): Promise<void> {
  await adminSql`truncate tenants, customers, staff_users, throttles cascade`;
}

export async function createTenant(
  slug: string,
  name: string = slug,
  vertical: string = "restaurante",
): Promise<string> {
  const [row] = await adminSql`
    insert into tenants (slug, name, vertical)
    values (${slug}, ${name}, ${vertical})
    returning id`;
  return row.id as string;
}

export async function closeAdmin(): Promise<void> {
  await adminSql.end();
}
```

`tests/db/schema.test.ts`:

```ts
import { afterAll, describe, expect, it } from "vitest";
import { adminSql, closeAdmin } from "../helpers/db";

// Tabelas que têm coluna tenant_id mas são globais de propósito.
const GLOBAL_WITH_TENANT_COLUMN = new Set(["tenant_domains"]);

afterAll(closeAdmin);

describe("schema", () => {
  it("toda tabela por loja tem RLS ligada e ao menos uma policy", async () => {
    const rows = await adminSql`
      select c.relname as name, c.relrowsecurity as rls,
        (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public' and col.table_name = c.relname
            and col.column_name = 'tenant_id')`;
    const perTenant = rows.filter((r) => !GLOBAL_WITH_TENANT_COLUMN.has(r.name as string));
    expect(perTenant.map((r) => r.name).sort()).toEqual([
      "audit_log",
      "customer_profiles",
      "otp_codes",
      "staff_memberships",
      "tenant_settings",
    ]);
    for (const r of perTenant) {
      expect(r.rls, `RLS off em ${r.name}`).toBe(true);
      expect(r.policies, `sem policy em ${r.name}`).toBeGreaterThan(0);
    }
  });

  it("papel da aplicação não é superuser e não ignora RLS", async () => {
    const [role] = await adminSql`
      select rolsuper, rolbypassrls from pg_roles where rolname = 'bora_app'`;
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  it("papel da aplicação não enxerga a tabela de controle de migrations", async () => {
    const [row] = await adminSql`
      select has_table_privilege('bora_app', '_migrations', 'select') as ok`;
    expect(row.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: FAIL (tabelas e papel não existem).

- [ ] **Step 3: SQL de schema**

`src/server/db/migrations/0001_init.sql`:

```sql
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
```

- [ ] **Step 4: SQL de RLS e grants**

`src/server/db/migrations/0002_rls.sql`:

```sql
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
```

- [ ] **Step 5: Runner de migrations**

`src/server/db/migrate.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = path.join(process.cwd(), "src/server/db/migrations");
const LOCK_ID = 727274;

export async function migrate(adminUrl: string, appPassword: string): Promise<string[]> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(${LOCK_ID})`;

    const roles = await sql`select 1 from pg_roles where rolname = 'bora_app'`;
    if (roles.length === 0) {
      const pwd = appPassword.replace(/'/g, "''");
      await sql.unsafe(
        `create role bora_app login nosuperuser nobypassrls password '${pwd}'`,
      );
    }

    await sql`create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
    const done = new Set(
      (await sql`select name from _migrations`).map((r) => r.name as string),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const text = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into _migrations (name) values (${file})`;
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await sql.end();
  }
}
```

`scripts/migrate.ts`:

```ts
import { migrate } from "../src/server/db/migrate";

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL ausente");
  const applied = await migrate(url, process.env.APP_DB_PASSWORD ?? "bora_app_dev");
  console.log(applied.length ? `aplicadas: ${applied.join(", ")}` : "nada a aplicar");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`tests/global-setup.ts`:

```ts
import { migrate } from "../src/server/db/migrate";

export default async function setup() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("TEST_DATABASE_ADMIN_URL ausente");
  await migrate(url, process.env.APP_DB_PASSWORD ?? "bora_app_dev");
}
```

Em `vitest.config.ts`, dentro de `test`, adicione `globalSetup: ["./tests/global-setup.ts"],`.

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: PASS (3 tests).

Run também `npm run db:migrate`
Expected: `aplicadas: 0001_init.sql, 0002_rls.sql` (banco `bora` de dev).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(db): migrations, papel bora_app e RLS por loja"
```

---

### Task 3: Schema Drizzle e `withTenant`

**Files:**
- Create: `src/server/db/schema.ts`, `src/server/db/client.ts`, `src/server/db/tenant.ts`, `tests/db/rls.test.ts`

**Interfaces:**
- Consumes: papel `bora_app`, `current_tenant()`, helpers `adminSql`, `resetDb`, `createTenant`, `closeAdmin` (Task 2).
- Produces:
  - `db` (Drizzle sobre `DATABASE_URL`), `type Tx`, `closeDb(): Promise<void>` em `@/server/db/client`.
  - Tabelas Drizzle em `@/server/db/schema`: `tenants`, `tenantDomains`, `customers`, `staffUsers`, `passwordResetTokens`, `staffMemberships`, `customerProfiles`, `tenantSettings`, `auditLog`, `otpCodes`.
  - `withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T>` em `@/server/db/tenant`.

- [ ] **Step 1: Teste de isolamento (falha primeiro)**

`tests/db/rls.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

let tenantA: string;
let tenantB: string;

beforeEach(async () => {
  await resetDb();
  tenantA = await createTenant("loja-a");
  tenantB = await createTenant("loja-b");
  await adminSql`insert into audit_log (tenant_id, actor, action) values
    (${tenantA}, 'a', 'x'), (${tenantB}, 'b', 'y')`;
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("withTenant + RLS", () => {
  it("query fora de withTenant retorna zero linhas", async () => {
    const rows = await db.select().from(auditLog);
    expect(rows).toEqual([]);
  });

  it("enxerga só a própria loja", async () => {
    const rows = await withTenant(tenantA, (tx) => tx.select().from(auditLog));
    expect(rows.map((r) => r.actor)).toEqual(["a"]);
  });

  it("a loja A não consegue inserir linha da loja B", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(auditLog).values({ tenantId: tenantB, actor: "intruso", action: "z" }),
      ),
    ).rejects.toThrow();
    const rows = await adminSql`select 1 from audit_log where actor = 'intruso'`;
    expect(rows.length).toBe(0);
  });

  it("a loja A não consegue apagar nem alterar linha da loja B", async () => {
    const deleted = await withTenant(tenantA, (tx) =>
      tx.delete(auditLog).returning(),
    );
    expect(deleted.map((r) => r.actor)).toEqual(["a"]);
    const remaining = await adminSql`select actor from audit_log`;
    expect(remaining.map((r) => r.actor)).toEqual(["b"]);
  });

  it("rejeita tenant id que não é uuid (sem injeção)", async () => {
    await expect(
      withTenant("x' or '1'='1", (tx) => tx.select().from(auditLog)),
    ).rejects.toThrow();
  });

  it("o tenant não vaza para a próxima query da conexão", async () => {
    await withTenant(tenantA, (tx) => tx.select().from(auditLog));
    const rows = await db.select().from(auditLog);
    expect(rows).toEqual([]);
    const cfg = await db.execute(sql`select current_setting('app.tenant_id', true) as v`);
    expect(["", null]).toContain(cfg[0].v);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/db/rls.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Schema Drizzle**

`src/server/db/schema.ts`:

```ts
import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { uuidv7 } from "uuidv7";

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const tenants = pgTable("tenants", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  vertical: text("vertical").notNull(),
  status: text("status").notNull().default("active"),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  country: text("country").notNull().default("BR"),
  currency: text("currency").notNull().default("BRL"),
  createdAt: createdAt(),
});

export const tenantDomains = pgTable("tenant_domains", {
  host: text("host").primaryKey(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  verified: boolean("verified").notNull().default(false),
});

export const customers = pgTable("customers", {
  id: id(),
  phone: text("phone").notNull().unique(),
  name: text("name"),
  createdAt: createdAt(),
});

export const staffUsers = pgTable("staff_users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  staffId: uuid("staff_id")
    .notNull()
    .references(() => staffUsers.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const staffMemberships = pgTable(
  "staff_memberships",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.staffId] })],
);

export const customerProfiles = pgTable(
  "customer_profiles",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.customerId] })],
);

export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  theme: jsonb("theme").notNull().default(sql`'{}'::jsonb`),
  serviceModes: text("service_modes").array().notNull().default(sql`'{pickup}'`),
  paymentMethods: text("payment_methods").array().notNull().default(sql`'{}'`),
  contact: jsonb("contact").notNull().default(sql`'{}'::jsonb`),
  address: jsonb("address").notNull().default(sql`'{}'::jsonb`),
});

export const auditLog = pgTable("audit_log", {
  id: id(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  resource: text("resource"),
  ip: text("ip"),
  createdAt: createdAt(),
});

export const otpCodes = pgTable("otp_codes", {
  id: id(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt(),
});
```

- [ ] **Step 4: Cliente e `withTenant`**

`src/server/db/client.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __boraSql: ReturnType<typeof postgres> | undefined;
}

// Reaproveita a conexão entre hot reloads em dev.
const client =
  globalThis.__boraSql ??
  (globalThis.__boraSql = postgres(process.env.DATABASE_URL ?? "", {
    max: 10,
    onnotice: () => {},
  }));

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function closeDb(): Promise<void> {
  await client.end();
  globalThis.__boraSql = undefined;
}
```

`src/server/db/tenant.ts`:

```ts
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "./client";

const tenantIdSchema = z.string().uuid();

/**
 * Único caminho para ler/escrever dados por loja.
 * `set_config(..., true)` vale só até o fim da transação.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const id = tenantIdSchema.parse(tenantId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${id}, true)`);
    return fn(tx);
  });
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/db`
Expected: PASS (schema 3 + rls 6).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): schema drizzle e withTenant com testes de isolamento"
```

---

### Task 4: Resolução de host, CSP e middleware

**Files:**
- Create: `src/server/tenancy/host.ts`, `src/server/security/csp.ts`, `src/middleware.ts`, `tests/tenancy/host.test.ts`, `tests/security/csp.test.ts`, `tests/tenancy/middleware.test.ts`

**Interfaces:**
- Produces:
  - `type HostTarget = { kind: "landing" } | { kind: "panel" } | { kind: "store"; slug: string } | { kind: "custom"; host: string } | { kind: "unknown" }`
  - `normalizeHost(raw: string | null): string | null`
  - `resolveHost(raw: string | null, rootDomain: string): HostTarget`
  - `segmentFor(target: HostTarget): string | null` (slug para store, host para custom, `null` nos demais)
  - `buildCsp(nonce: string, dev: boolean): string`
  - middleware: loja → rewrite `/s/{segmento}{path}`; painel → rewrite `/panel{path}`; landing passa direto; `/s` e `/panel` acessados direto no host errado e hosts inválidos → 404. Envia `x-nonce` no request e `Content-Security-Policy` no request e na resposta.

- [ ] **Step 1: Testes de host (Review Focus 1)**

`tests/tenancy/host.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeHost, resolveHost, segmentFor } from "@/server/tenancy/host";

const ROOT = "bora.app";

describe("normalizeHost", () => {
  it("minúsculas, sem porta e sem ponto final", () => {
    expect(normalizeHost("Loja.BORA.app:3000")).toBe("loja.bora.app");
    expect(normalizeHost("loja.bora.app.")).toBe("loja.bora.app");
  });
  it("rejeita lixo", () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("a..bora.app")).toBeNull();
    expect(normalizeHost("[::1]:3000")).toBeNull();
    expect(normalizeHost("loja.bora.app/../x")).toBeNull();
    expect(normalizeHost("loja bora.app")).toBeNull();
    expect(normalizeHost("a".repeat(300))).toBeNull();
  });
});

describe("resolveHost", () => {
  it("landing", () => {
    expect(resolveHost("bora.app", ROOT)).toEqual({ kind: "landing" });
    expect(resolveHost("www.bora.app", ROOT)).toEqual({ kind: "landing" });
  });
  it("painel", () => {
    expect(resolveHost("app.bora.app", ROOT)).toEqual({ kind: "panel" });
    expect(resolveHost("APP.bora.app:443", ROOT)).toEqual({ kind: "panel" });
  });
  it("vitrine por slug, ignorando caixa, porta e ponto final", () => {
    expect(resolveHost("acai-do-ze.bora.app", ROOT)).toEqual({ kind: "store", slug: "acai-do-ze" });
    expect(resolveHost("Acai-Do-Ze.Bora.App:8080", ROOT)).toEqual({ kind: "store", slug: "acai-do-ze" });
    expect(resolveHost("acai-do-ze.bora.app.", ROOT)).toEqual({ kind: "store", slug: "acai-do-ze" });
  });
  it("slugs reservados e inválidos são unknown", () => {
    for (const h of ["api", "admin", "static"]) {
      expect(resolveHost(`${h}.bora.app`, ROOT)).toEqual({ kind: "unknown" });
    }
    expect(resolveHost("-ruim.bora.app", ROOT)).toEqual({ kind: "unknown" });
    expect(resolveHost("a.b.bora.app", ROOT)).toEqual({ kind: "unknown" });
  });
  it("host fora do domínio raiz é custom", () => {
    expect(resolveHost("cardapio.minhaloja.com.br", ROOT)).toEqual({
      kind: "custom",
      host: "cardapio.minhaloja.com.br",
    });
    expect(resolveHost("evilbora.app", ROOT)).toEqual({ kind: "custom", host: "evilbora.app" });
  });
  it("host ausente ou malformado é unknown, nunca lança", () => {
    expect(resolveHost(null, ROOT)).toEqual({ kind: "unknown" });
    expect(resolveHost("[::1]", ROOT)).toEqual({ kind: "unknown" });
    expect(resolveHost("a..b", ROOT)).toEqual({ kind: "unknown" });
  });
  it("funciona com root localhost", () => {
    expect(resolveHost("demo.localhost:3000", "localhost")).toEqual({ kind: "store", slug: "demo" });
    expect(resolveHost("localhost:3000", "localhost")).toEqual({ kind: "landing" });
  });
});

describe("segmentFor", () => {
  it("slug para loja, host para custom, null nos demais", () => {
    expect(segmentFor({ kind: "store", slug: "x" })).toBe("x");
    expect(segmentFor({ kind: "custom", host: "a.b.com" })).toBe("a.b.com");
    expect(segmentFor({ kind: "landing" })).toBeNull();
    expect(segmentFor({ kind: "panel" })).toBeNull();
    expect(segmentFor({ kind: "unknown" })).toBeNull();
  });
});
```

`tests/security/csp.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCsp } from "@/server/security/csp";

describe("buildCsp", () => {
  it("produção: nonce, strict-dynamic, sem unsafe-eval", () => {
    const csp = buildCsp("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
  });
  it("dev: permite eval para o refresh do React", () => {
    expect(buildCsp("n", true)).toContain("'unsafe-eval'");
  });
});
```

`tests/tenancy/middleware.test.ts`:

```ts
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "@/middleware";

function req(host: string, path = "/") {
  return new NextRequest(`http://${host}${path}`, { headers: { host } });
}

describe("middleware", () => {
  it("vitrine: reescreve para /s/{slug}", () => {
    const res = middleware(req("demo.bora.test", "/entrar"));
    expect(res.headers.get("x-middleware-rewrite")).toMatch(/\/s\/demo\/entrar$/);
  });
  it("vitrine na raiz: /s/{slug}", () => {
    const res = middleware(req("demo.bora.test", "/"));
    expect(res.headers.get("x-middleware-rewrite")).toMatch(/\/s\/demo$/);
  });
  it("domínio próprio: segmento é o host", () => {
    const res = middleware(req("cardapio.loja.com.br", "/"));
    expect(res.headers.get("x-middleware-rewrite")).toMatch(/\/s\/cardapio\.loja\.com\.br$/);
  });
  it("painel: reescreve para /panel", () => {
    const res = middleware(req("app.bora.test", "/login"));
    expect(res.headers.get("x-middleware-rewrite")).toMatch(/\/panel\/login$/);
  });
  it("landing passa direto", () => {
    const res = middleware(req("bora.test", "/"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
  it("rotas internas não são acessíveis direto", () => {
    expect(middleware(req("bora.test", "/panel/login")).status).toBe(404);
    expect(middleware(req("bora.test", "/s/demo")).status).toBe(404);
    expect(middleware(req("demo.bora.test", "/panel")).status).toBe(404);
    expect(middleware(req("app.bora.test", "/s/demo")).status).toBe(404);
  });
  it("host inválido ou slug reservado dá 404", () => {
    expect(middleware(req("api.bora.test")).status).toBe(404);
    expect(middleware(req("a.b.bora.test")).status).toBe(404);
  });
  it("define CSP com o mesmo nonce enviado ao request", () => {
    const res = middleware(req("bora.test", "/"));
    const csp = res.headers.get("content-security-policy") ?? "";
    const nonce = res.headers.get("x-middleware-request-x-nonce") ?? "";
    expect(nonce.length).toBeGreaterThan(10);
    expect(csp).toContain(`'nonce-${nonce}'`);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/tenancy tests/security`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Resolver de host**

`src/server/tenancy/host.ts`:

```ts
const RESERVED = new Set(["app", "www", "api", "admin", "static"]);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export type HostTarget =
  | { kind: "landing" }
  | { kind: "panel" }
  | { kind: "store"; slug: string }
  | { kind: "custom"; host: string }
  | { kind: "unknown" };

export function normalizeHost(raw: string | null): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  if (host.startsWith("[")) return null;
  host = host.replace(/:\d{1,5}$/, "").replace(/\.$/, "");
  if (host.length === 0 || host.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..")) return null;
  return host;
}

export function resolveHost(raw: string | null, rootDomain: string): HostTarget {
  const host = normalizeHost(raw);
  if (!host) return { kind: "unknown" };
  const root = rootDomain.toLowerCase();

  if (host === root || host === `www.${root}`) return { kind: "landing" };
  if (host === `app.${root}`) return { kind: "panel" };

  if (host.endsWith(`.${root}`)) {
    const label = host.slice(0, -(root.length + 1));
    if (label.includes(".") || RESERVED.has(label) || !SLUG_RE.test(label)) {
      return { kind: "unknown" };
    }
    return { kind: "store", slug: label };
  }
  return { kind: "custom", host };
}

export function segmentFor(target: HostTarget): string | null {
  if (target.kind === "store") return target.slug;
  if (target.kind === "custom") return target.host;
  return null;
}
```

- [ ] **Step 4: CSP**

`src/server/security/csp.ts`:

```ts
export function buildCsp(nonce: string, dev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": dev ? ["'self'", "'unsafe-inline'"] : ["'self'", `'nonce-${nonce}'`],
    "style-src-attr": ["'unsafe-inline'"],
    "img-src": ["'self'", "data:", "https:"],
    "font-src": ["'self'"],
    "connect-src": dev ? ["'self'", "ws:", "http:"] : ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");
}
```

- [ ] **Step 5: Middleware**

`src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/server/security/csp";
import { resolveHost, segmentFor } from "@/server/tenancy/host";

// Arquivos com extensão (public/) e assets do Next não passam pelo middleware.
export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};

function isInternalPath(pathname: string): boolean {
  return (
    pathname === "/panel" ||
    pathname.startsWith("/panel/") ||
    pathname === "/s" ||
    pathname.startsWith("/s/")
  );
}

function notFound(csp: string): NextResponse {
  const res = new NextResponse("Not found", { status: 404 });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  const rootDomain = process.env.ROOT_DOMAIN ?? "localhost";
  const target = resolveHost(req.headers.get("host"), rootDomain);
  const { pathname } = req.nextUrl;

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  if (target.kind === "unknown" || isInternalPath(pathname)) return notFound(csp);

  let res: NextResponse;
  if (target.kind === "landing") {
    res = NextResponse.next({ request: { headers } });
  } else {
    const url = req.nextUrl.clone();
    const rest = pathname === "/" ? "" : pathname;
    url.pathname =
      target.kind === "panel" ? `/panel${rest}` : `/s/${segmentFor(target)}${rest}`;
    res = NextResponse.rewrite(url, { request: { headers } });
  }
  res.headers.set("Content-Security-Policy", csp);
  return res;
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run tests/tenancy tests/security`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(tenancy): resolução de host, CSP com nonce e middleware"
```

---

### Task 5: Tema por loja

**Files:**
- Create: `src/server/theme/contrast.ts`, `src/server/theme/theme.ts`, `tests/theme/contrast.test.ts`, `tests/theme/theme.test.ts`

**Interfaces:**
- Produces:
  - `contrastRatio(a: string, b: string): number` (hex `#rrggbb`)
  - `pickForeground(accent: string): "#ffffff" | "#09090b"`
  - `normalizeAccent(hex: string): string | null` (minúsculo, ou `null` se inválido)
  - `validateAccent(hex: string): { ok: true; accent: string; foreground: string } | { ok: false; reason: string }`
  - `themeSchema` (Zod), `type Theme`, `defaultTheme: Theme`
  - `themeToCss(theme: Theme): string`
  - `FOREGROUND_LIGHT = "#ffffff"`, `FOREGROUND_DARK = "#09090b"`

- [ ] **Step 1: Testes (Review Focus 2)**

`tests/theme/contrast.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  normalizeAccent,
  pickForeground,
  validateAccent,
} from "@/server/theme/contrast";

describe("contrastRatio", () => {
  it("preto no branco é 21", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
  });
  it("é simétrico", () => {
    expect(contrastRatio("#ea580c", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#ea580c"),
      5,
    );
  });
});

describe("pickForeground", () => {
  it("laranja Bora usa texto escuro (contraste maior)", () => {
    expect(pickForeground("#ea580c")).toBe("#09090b");
  });
  it("azul escuro usa texto branco", () => {
    expect(pickForeground("#1e3a8a")).toBe("#ffffff");
  });
});

describe("normalizeAccent / validateAccent", () => {
  it("normaliza maiúsculas", () => {
    expect(normalizeAccent("#EA580C")).toBe("#ea580c");
  });
  it("rejeita formato inválido e injeção de CSS", () => {
    for (const bad of ["#fff", "red", "ea580c", "#ea580c;}body{display:none", "#gggggg", "", "#ea580c "]) {
      expect(normalizeAccent(bad), bad).toBeNull();
      expect(validateAccent(bad).ok, bad).toBe(false);
    }
  });
  it("rejeita branco e preto puros (somem em um dos modos)", () => {
    expect(validateAccent("#ffffff").ok).toBe(false);
    expect(validateAccent("#09090b").ok).toBe(false);
    expect(validateAccent("#000000").ok).toBe(false);
  });
  it("aceita cores curadas com contraste de texto >= 4.5", () => {
    for (const ok of ["#ea580c", "#be185d", "#15803d", "#1e3a8a", "#ffd600"]) {
      const v = validateAccent(ok);
      expect(v.ok, ok).toBe(true);
      if (v.ok) expect(contrastRatio(v.accent, v.foreground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
```

`tests/theme/theme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultTheme, themeSchema, themeToCss } from "@/server/theme/theme";

describe("themeSchema", () => {
  it("aceita o tema padrão", () => {
    expect(themeSchema.safeParse(defaultTheme).success).toBe(true);
  });
  it("normaliza accent para minúsculas", () => {
    const parsed = themeSchema.parse({ ...defaultTheme, accent: "#BE185D" });
    expect(parsed.accent).toBe("#be185d");
  });
  it("rejeita fonte, raio e accent fora da lista/formato", () => {
    expect(themeSchema.safeParse({ ...defaultTheme, font: "comic" }).success).toBe(false);
    expect(themeSchema.safeParse({ ...defaultTheme, radius: "xl" }).success).toBe(false);
    expect(
      themeSchema.safeParse({ ...defaultTheme, accent: "#fff;}body{display:none" }).success,
    ).toBe(false);
    expect(themeSchema.safeParse({ ...defaultTheme, accent: "#ffffff" }).success).toBe(false);
  });
  it("logoUrl só aceita http(s) ou null", () => {
    expect(themeSchema.safeParse({ ...defaultTheme, logoUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(themeSchema.safeParse({ ...defaultTheme, logoUrl: "https://x.com/l.png" }).success).toBe(true);
  });
});

describe("themeToCss", () => {
  it("emite as variáveis esperadas", () => {
    const css = themeToCss({ ...defaultTheme, accent: "#be185d", radius: "lg", font: "inter" });
    expect(css).toContain("--brand:#be185d");
    expect(css).toContain("--brand-foreground:#ffffff");
    expect(css).toContain("--primary:var(--brand)");
    expect(css).toContain("--radius:0.75rem");
    expect(css).toContain("--font-store:var(--font-inter)");
    expect(css.startsWith(":root{")).toBe(true);
  });
  it("nunca contém caracteres que quebrem o bloco de estilo", () => {
    const css = themeToCss(defaultTheme);
    expect(css).not.toMatch(/[<>]/);
    expect((css.match(/\{/g) ?? []).length).toBe(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/theme`
Expected: FAIL.

- [ ] **Step 3: Contraste**

`src/server/theme/contrast.ts`:

```ts
export const FOREGROUND_LIGHT = "#ffffff";
export const FOREGROUND_DARK = "#09090b";
const BACKGROUND_LIGHT = "#ffffff";
const BACKGROUND_DARK = "#09090b";
const MIN_TEXT_CONTRAST = 4.5;
// Abaixo disso o destaque some contra o fundo em um dos modos.
const MIN_BACKGROUND_CONTRAST = 1.25;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function pickForeground(accent: string): typeof FOREGROUND_LIGHT | typeof FOREGROUND_DARK {
  return contrastRatio(accent, FOREGROUND_LIGHT) >= contrastRatio(accent, FOREGROUND_DARK)
    ? FOREGROUND_LIGHT
    : FOREGROUND_DARK;
}

export function normalizeAccent(hex: string): string | null {
  return HEX_RE.test(hex) ? hex.toLowerCase() : null;
}

export type AccentValidation =
  | { ok: true; accent: string; foreground: string }
  | { ok: false; reason: string };

export function validateAccent(hex: string): AccentValidation {
  const accent = normalizeAccent(hex);
  if (!accent) return { ok: false, reason: "Use uma cor no formato #rrggbb." };

  const foreground = pickForeground(accent);
  if (contrastRatio(accent, foreground) < MIN_TEXT_CONTRAST) {
    return { ok: false, reason: "Contraste do texto sobre a cor é baixo demais." };
  }
  if (
    contrastRatio(accent, BACKGROUND_LIGHT) < MIN_BACKGROUND_CONTRAST ||
    contrastRatio(accent, BACKGROUND_DARK) < MIN_BACKGROUND_CONTRAST
  ) {
    return { ok: false, reason: "Cor muito próxima do fundo branco ou preto." };
  }
  return { ok: true, accent, foreground };
}
```

- [ ] **Step 4: Tema**

`src/server/theme/theme.ts`:

```ts
import { z } from "zod";
import { validateAccent } from "./contrast";

const FONT_VAR = {
  geist: "var(--font-geist-sans)",
  inter: "var(--font-inter)",
  editorial: "var(--font-editorial)",
} as const;

const RADIUS = { sm: "0.25rem", md: "0.5rem", lg: "0.75rem" } as const;

export const themeSchema = z.object({
  accent: z
    .string()
    .superRefine((value, ctx) => {
      const result = validateAccent(value);
      if (!result.ok) ctx.addIssue({ code: "custom", message: result.reason });
    })
    .transform((value) => value.toLowerCase()),
  font: z.enum(["geist", "inter", "editorial"]),
  radius: z.enum(["sm", "md", "lg"]),
  logoUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "Use uma URL http(s).")
    .nullable(),
});

export type Theme = z.infer<typeof themeSchema>;

export const defaultTheme: Theme = {
  accent: "#ea580c",
  font: "geist",
  radius: "md",
  logoUrl: null,
};

/** Só emite valores vindos de regex estrita ou de enum: seguro para <style>. */
export function themeToCss(theme: Theme): string {
  const result = validateAccent(theme.accent);
  if (!result.ok) throw new Error("Tema inválido");
  return (
    `:root{--brand:${result.accent};--brand-foreground:${result.foreground};` +
    `--primary:var(--brand);--primary-foreground:var(--brand-foreground);` +
    `--ring:var(--brand);--radius:${RADIUS[theme.radius]};` +
    `--font-store:${FONT_VAR[theme.font]}}`
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/theme`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(theme): guarda de contraste, schema do tema e variáveis CSS"
```

---

### Task 6: Primitivas de auth (senha, papéis, sessão, IP)

**Files:**
- Create: `src/server/auth/password.ts`, `src/server/auth/can.ts`, `src/server/auth/session.ts`, `src/server/auth/cookies.ts`, `src/server/auth/ip.ts`, `tests/auth/password.test.ts`, `tests/auth/can.test.ts`, `tests/auth/session.test.ts`, `tests/auth/ip.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(plain: string): Promise<string>`, `verifyPassword(stored: string, plain: string): Promise<boolean>`, `passwordSchema` (Zod, 10 a 128 caracteres), `dummyHash(): Promise<string>`
  - `type Role = "owner" | "manager" | "attendant"`, `type Action`, `can(role: Role, action: Action): boolean`, `ROLES`
  - `type Session = { kind: "staff"; staffId: string; tenantId: string | null } | { kind: "customer"; customerId: string; tenantId: string }`, `signSession(session: Session, ttlSeconds: number): Promise<string>`, `verifySession(token: string | undefined, now?: Date): Promise<Session | null>`
  - `STAFF_COOKIE = "bora_staff"`, `CUSTOMER_COOKIE = "bora_customer"`, `STAFF_TTL_SECONDS`, `CUSTOMER_TTL_SECONDS`, `cookieOptions(maxAge: number)`
  - `clientIp(headers: Headers): string`

- [ ] **Step 1: Testes**

`tests/auth/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, passwordSchema, verifyPassword } from "@/server/auth/password";

describe("password", () => {
  it("hash é argon2id e verifica", async () => {
    const hash = await hashPassword("uma-senha-boa-123");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "uma-senha-boa-123")).toBe(true);
    expect(await verifyPassword(hash, "outra-senha-123")).toBe(false);
  });
  it("hash inválido verifica como false, sem lançar", async () => {
    expect(await verifyPassword("nao-e-um-hash", "x")).toBe(false);
  });
  it("política: 10 a 128 caracteres (limite protege o argon2 de DoS)", () => {
    expect(passwordSchema.safeParse("curta").success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(10)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(10_000)).success).toBe(false);
  });
});
```

`tests/auth/can.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { can } from "@/server/auth/can";

describe("can", () => {
  it("owner pode tudo", () => {
    for (const a of ["billing:manage", "team:manage", "settings:edit", "catalog:edit", "orders:manage", "stock:edit"] as const) {
      expect(can("owner", a)).toBe(true);
    }
  });
  it("manager não gerencia equipe nem cobrança", () => {
    expect(can("manager", "team:manage")).toBe(false);
    expect(can("manager", "billing:manage")).toBe(false);
    expect(can("manager", "catalog:edit")).toBe(true);
    expect(can("manager", "settings:edit")).toBe(true);
  });
  it("attendant só pedidos e estoque", () => {
    expect(can("attendant", "orders:manage")).toBe(true);
    expect(can("attendant", "stock:edit")).toBe(true);
    expect(can("attendant", "catalog:edit")).toBe(false);
    expect(can("attendant", "settings:edit")).toBe(false);
  });
});
```

`tests/auth/session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { signSession, verifySession, type Session } from "@/server/auth/session";

const uuid = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const staff: Session = { kind: "staff", staffId: uuid, tenantId: null };
const customer: Session = { kind: "customer", customerId: uuid, tenantId: uuid };

describe("session", () => {
  it("ida e volta", async () => {
    expect(await verifySession(await signSession(staff, 60))).toEqual(staff);
    expect(await verifySession(await signSession(customer, 60))).toEqual(customer);
  });
  it("token adulterado, vazio ou ausente vira null", async () => {
    const token = await signSession(staff, 60);
    expect(await verifySession(token.slice(0, -2) + "xx")).toBeNull();
    expect(await verifySession("lixo")).toBeNull();
    expect(await verifySession("")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });
  it("expira", async () => {
    const token = await signSession(staff, 10);
    expect(await verifySession(token, new Date(Date.now() + 60_000))).toBeNull();
  });
  it("payload com forma inesperada é rejeitado", async () => {
    const bad = await signSession({ kind: "customer", customerId: "x", tenantId: "y" } as Session, 60);
    expect(await verifySession(bad)).toBeNull();
  });
});
```

`tests/auth/ip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clientIp } from "@/server/auth/ip";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIp", () => {
  it("usa o primeiro x-forwarded-for", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
  });
  it("cai para x-real-ip e depois unknown", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(h({}))).toBe("unknown");
  });
  it("descarta valor com caracteres estranhos ou longo demais", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4<script>" }))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "1".repeat(100) }))).toBe("unknown");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/auth/password.test.ts tests/auth/can.test.ts tests/auth/session.test.ts tests/auth/ip.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementações**

`src/server/auth/password.ts`:

```ts
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// argon2id é o algoritmo padrão do @node-rs/argon2.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const passwordSchema = z.string().min(10).max(128);

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** Hash descartável para igualar o tempo de resposta quando o usuário não existe. */
export function dummyHash(): Promise<string> {
  return (dummy ??= hashPassword("senha-descartavel-para-tempo-constante"));
}
```

`src/server/auth/can.ts`:

```ts
export const ROLES = ["owner", "manager", "attendant"] as const;
export type Role = (typeof ROLES)[number];

export type Action =
  | "billing:manage"
  | "team:manage"
  | "settings:edit"
  | "catalog:edit"
  | "orders:manage"
  | "stock:edit";

const MATRIX: Record<Role, readonly Action[]> = {
  owner: ["billing:manage", "team:manage", "settings:edit", "catalog:edit", "orders:manage", "stock:edit"],
  manager: ["settings:edit", "catalog:edit", "orders:manage", "stock:edit"],
  attendant: ["orders:manage", "stock:edit"],
};

export function can(role: Role, action: Action): boolean {
  return MATRIX[role].includes(action);
}
```

`src/server/auth/session.ts`:

```ts
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

const sessionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("staff"),
    staffId: z.string().uuid(),
    tenantId: z.string().uuid().nullable(),
  }),
  z.object({
    kind: z.literal("customer"),
    customerId: z.string().uuid(),
    tenantId: z.string().uuid(),
  }),
]);

export type Session = z.infer<typeof sessionSchema>;

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET ausente ou curto (mín. 32)");
  return new TextEncoder().encode(value);
}

export function signSession(session: Session, ttlSeconds: number): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
}

export async function verifySession(
  token: string | undefined,
  now: Date = new Date(),
): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
      currentDate: now,
    });
    const parsed = sessionSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
```

`src/server/auth/cookies.ts`:

```ts
export const STAFF_COOKIE = "bora_staff";
export const CUSTOMER_COOKIE = "bora_customer";
export const STAFF_TTL_SECONDS = 60 * 60 * 12;
export const CUSTOMER_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Sem `domain`: o cookie fica preso ao host, isolando uma loja da outra. */
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
```

`src/server/auth/ip.ts`:

```ts
const SAFE_IP = /^[0-9a-fA-F:.]{2,45}$/;

/** Confia no proxy da hospedagem para preencher x-forwarded-for. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers.get("x-real-ip")?.trim() || "";
  return SAFE_IP.test(candidate) ? candidate : "unknown";
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): senha argon2id, papéis, sessão jwt e ip do cliente"
```

---

### Task 7: Throttle (brute force e rate limit)

**Files:**
- Create: `src/server/auth/throttle.ts`, `tests/auth/throttle.test.ts`

**Interfaces:**
- Consumes: `db` (Task 3); tabela `throttles` (Task 2).
- Produces:
  - `type ThrottleOpts = { max: number; windowMs: number; blockMs: number }`
  - `hit(key: string, opts: ThrottleOpts, now?: Date): Promise<{ blocked: boolean }>` (conta uma ocorrência; `blocked: true` quando atingiu `max`)
  - `retryAfterMs(key: string, now?: Date): Promise<number>` (0 se livre)
  - `resetThrottle(key: string): Promise<void>`

- [ ] **Step 1: Testes (inclui concorrência, Review Focus 5)**

`tests/auth/throttle.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { hit, resetThrottle, retryAfterMs } from "@/server/auth/throttle";
import { adminSql, closeAdmin, resetDb } from "../helpers/db";

const OPTS = { max: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
const T0 = new Date("2026-01-01T12:00:00Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeEach(resetDb);
afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("throttle", () => {
  it("chave nova não está bloqueada", async () => {
    expect(await retryAfterMs("k", T0)).toBe(0);
  });

  it("a 5ª ocorrência bloqueia; as 4 primeiras não", async () => {
    for (let i = 1; i <= 4; i++) {
      expect((await hit("k", OPTS, at(i))).blocked).toBe(false);
    }
    expect((await hit("k", OPTS, at(5))).blocked).toBe(true);
    expect(await retryAfterMs("k", at(6))).toBeGreaterThan(14 * 60_000);
  });

  it("libera depois do tempo de bloqueio e recomeça a contar", async () => {
    for (let i = 0; i < 5; i++) await hit("k", OPTS, at(i));
    expect(await retryAfterMs("k", at(OPTS.blockMs + 10))).toBe(0);
    expect((await hit("k", OPTS, at(OPTS.blockMs + 10))).blocked).toBe(false);
  });

  it("a janela expirada zera a contagem", async () => {
    for (let i = 0; i < 4; i++) await hit("k", OPTS, at(i));
    const later = at(OPTS.windowMs + 1000);
    expect((await hit("k", OPTS, later)).blocked).toBe(false);
    const [row] = await adminSql`select failures from throttles where key = 'k'`;
    expect(row.failures).toBe(1);
  });

  it("resetThrottle limpa", async () => {
    for (let i = 0; i < 5; i++) await hit("k", OPTS, at(i));
    await resetThrottle("k");
    expect(await retryAfterMs("k", at(10))).toBe(0);
  });

  it("chaves são independentes", async () => {
    for (let i = 0; i < 5; i++) await hit("a", OPTS, at(i));
    expect(await retryAfterMs("b", at(10))).toBe(0);
  });

  it("20 ocorrências concorrentes não escapam do bloqueio", async () => {
    await Promise.all(Array.from({ length: 20 }, () => hit("c", OPTS, T0)));
    expect(await retryAfterMs("c", at(1))).toBeGreaterThan(0);
    const [row] = await adminSql`select failures, blocked_until from throttles where key = 'c'`;
    expect(row.blocked_until).not.toBeNull();
    expect(row.failures).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/auth/throttle.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementação**

`src/server/auth/throttle.ts`:

```ts
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

export interface ThrottleOpts {
  max: number;
  windowMs: number;
  blockMs: number;
}

interface Row {
  failures: number;
  window_start: Date;
  blocked_until: Date | null;
}

/**
 * Conta uma ocorrência. Linha trancada com FOR UPDATE: ocorrências concorrentes
 * se enfileiram e a contagem não se perde. Enquanto bloqueado, não incrementa.
 */
export async function hit(
  key: string,
  opts: ThrottleOpts,
  now: Date = new Date(),
): Promise<{ blocked: boolean }> {
  return db.transaction(async (tx) => {
    const nowIso = now.toISOString();
    await tx.execute(sql`
      insert into throttles (key, failures, window_start)
      values (${key}, 0, ${nowIso}::timestamptz)
      on conflict (key) do nothing`);
    const rows = await tx.execute(sql`
      select failures, window_start, blocked_until
      from throttles where key = ${key} for update`);
    const row = rows[0] as unknown as Row;

    if (row.blocked_until && row.blocked_until > now) return { blocked: true };

    const reset =
      row.blocked_until !== null ||
      now.getTime() - row.window_start.getTime() > opts.windowMs;
    const failures = (reset ? 0 : row.failures) + 1;
    const windowStart = reset ? now : row.window_start;
    const blockedUntil =
      failures >= opts.max ? new Date(now.getTime() + opts.blockMs) : null;

    await tx.execute(sql`
      update throttles
      set failures = ${failures},
          window_start = ${windowStart.toISOString()}::timestamptz,
          blocked_until = ${blockedUntil ? blockedUntil.toISOString() : null}::timestamptz
      where key = ${key}`);
    return { blocked: blockedUntil !== null };
  });
}

export async function retryAfterMs(key: string, now: Date = new Date()): Promise<number> {
  const rows = await db.execute(sql`select blocked_until from throttles where key = ${key}`);
  const until = (rows[0] as unknown as { blocked_until: Date | null } | undefined)?.blocked_until;
  if (!until || until <= now) return 0;
  return until.getTime() - now.getTime();
}

export async function resetThrottle(key: string): Promise<void> {
  await db.execute(sql`delete from throttles where key = ${key}`);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/auth/throttle.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): throttle persistente com bloqueio por janela"
```

---

### Task 8: Login do staff, escolha de loja e painel

**Files:**
- Create: `src/server/db/migrations/0003_staff_memberships_fn.sql`, `src/server/audit.ts`, `src/server/auth/staff.ts`, `src/app/panel/layout.tsx`, `src/app/panel/page.tsx`, `src/app/panel/actions.ts`, `src/app/panel/login/page.tsx`, `tests/auth/staff.test.ts`
- Modify: `tests/helpers/db.ts` (adicionar `createStaff`)

**Interfaces:**
- Consumes: `withTenant`, `db`, tabelas (Task 3); `hashPassword`, `verifyPassword`, `dummyHash`, `passwordSchema`, `can`, `Role`, `signSession`, `verifySession`, cookies, `clientIp` (Task 6); `hit`, `retryAfterMs`, `resetThrottle` (Task 7).
- Produces:
  - `normalizeEmail(raw: string): string`
  - `type Membership = { tenantId: string; role: Role; slug: string; name: string }`
  - `authenticateStaff(rawEmail: string, password: string, ip: string): Promise<{ ok: true; staffId: string } | { ok: false; reason: "invalid" | "throttled" }>`
  - `listMemberships(staffId: string): Promise<Membership[]>`
  - `type StaffContext = { staffId: string; memberships: Membership[]; active: Membership | null }`
  - `resolveStaffContext(token: string | undefined): Promise<StaffContext | null>` (revalida membership a cada chamada)
  - `getStaffContext(): Promise<StaffContext | null>` (lê o cookie), `requireAction(action: Action): Promise<StaffContext & { active: Membership }>`
  - `writeAudit(tenantId: string, entry: { actor: string; action: string; resource?: string; ip?: string }): Promise<void>`
  - Server actions: `loginAction`, `selectTenantAction`, `logoutAction`
  - Helper de teste: `createStaff(email: string, password: string, name?: string): Promise<string>`, `addMembership(tenantId, staffId, role)`

- [ ] **Step 1: Helpers e testes (Review Focus 5)**

Acrescente em `tests/helpers/db.ts`:

```ts
import { hashPassword } from "@/server/auth/password";

export async function createStaff(
  email: string,
  password: string,
  name = "Pessoa",
): Promise<string> {
  const hash = await hashPassword(password);
  const [row] = await adminSql`
    insert into staff_users (email, password_hash, name)
    values (${email.toLowerCase()}, ${hash}, ${name})
    returning id`;
  return row.id as string;
}

export async function addMembership(
  tenantId: string,
  staffId: string,
  role: "owner" | "manager" | "attendant",
): Promise<void> {
  await adminSql`
    insert into staff_memberships (tenant_id, staff_id, role)
    values (${tenantId}, ${staffId}, ${role})`;
}
```

`tests/auth/staff.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { writeAudit } from "@/server/audit";
import { signSession } from "@/server/auth/session";
import {
  authenticateStaff,
  listMemberships,
  normalizeEmail,
  resolveStaffContext,
} from "@/server/auth/staff";
import { closeDb } from "@/server/db/client";
import { adminSql, addMembership, closeAdmin, createStaff, createTenant, resetDb } from "../helpers/db";

const PASSWORD = "senha-correta-123";
let tenantA: string;
let tenantB: string;
let staffId: string;

beforeEach(async () => {
  await resetDb();
  tenantA = await createTenant("loja-a", "Loja A");
  tenantB = await createTenant("loja-b", "Loja B");
  staffId = await createStaff("dono@exemplo.com", PASSWORD);
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("normalizeEmail", () => {
  it("minúsculas e sem espaços nas pontas", () => {
    expect(normalizeEmail("  Dono@Exemplo.COM ")).toBe("dono@exemplo.com");
  });
});

describe("authenticateStaff", () => {
  it("aceita e-mail com maiúsculas e espaços", async () => {
    const r = await authenticateStaff("  DONO@exemplo.com ", PASSWORD, "1.1.1.1");
    expect(r).toEqual({ ok: true, staffId });
  });
  it("senha errada e e-mail inexistente dão a mesma resposta", async () => {
    expect(await authenticateStaff("dono@exemplo.com", "errada-errada-1", "1.1.1.1")).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticateStaff("ninguem@exemplo.com", "errada-errada-1", "1.1.1.1")).toEqual({ ok: false, reason: "invalid" });
  });
  it("5 falhas bloqueiam, mesmo com a senha certa depois", async () => {
    for (let i = 0; i < 5; i++) {
      await authenticateStaff("dono@exemplo.com", "errada-errada-1", `9.9.9.${i}`);
    }
    expect(await authenticateStaff("dono@exemplo.com", PASSWORD, "8.8.8.8")).toEqual({ ok: false, reason: "throttled" });
  });
  it("tentativas concorrentes também esbarram no bloqueio", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => authenticateStaff("dono@exemplo.com", "errada-errada-1", "7.7.7.7")),
    );
    expect(await authenticateStaff("dono@exemplo.com", PASSWORD, "6.6.6.6")).toEqual({ ok: false, reason: "throttled" });
  });
  it("senha gigante é rejeitada antes do hash", async () => {
    const started = Date.now();
    const r = await authenticateStaff("dono@exemplo.com", "a".repeat(10_000), "1.1.1.1");
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it("login correto zera o contador de falhas do e-mail", async () => {
    for (let i = 0; i < 3; i++) {
      await authenticateStaff("dono@exemplo.com", "errada-errada-1", "1.1.1.1");
    }
    await authenticateStaff("dono@exemplo.com", PASSWORD, "1.1.1.1");
    const rows = await adminSql`select 1 from throttles where key = 'staff:email:dono@exemplo.com'`;
    expect(rows.length).toBe(0);
  });
});

describe("listMemberships / resolveStaffContext", () => {
  it("lista as lojas ativas do staff, com papel", async () => {
    await addMembership(tenantA, staffId, "owner");
    await addMembership(tenantB, staffId, "attendant");
    const list = await listMemberships(staffId);
    expect(list.map((m) => [m.slug, m.role])).toEqual([
      ["loja-a", "owner"],
      ["loja-b", "attendant"],
    ]);
  });
  it("loja suspensa some da lista", async () => {
    await addMembership(tenantA, staffId, "owner");
    await adminSql`update tenants set status = 'suspended' where id = ${tenantA}`;
    expect(await listMemberships(staffId)).toEqual([]);
  });
  it("ninguém vê memberships de outro staff", async () => {
    await addMembership(tenantA, staffId, "owner");
    const other = await createStaff("outro@exemplo.com", PASSWORD);
    expect(await listMemberships(other)).toEqual([]);
  });
  it("contexto: sem tenant ativo até escolher", async () => {
    await addMembership(tenantA, staffId, "owner");
    const token = await signSession({ kind: "staff", staffId, tenantId: null }, 60);
    const ctx = await resolveStaffContext(token);
    expect(ctx?.active).toBeNull();
    expect(ctx?.memberships.length).toBe(1);
  });
  it("contexto: papel vem do banco a cada request", async () => {
    await addMembership(tenantA, staffId, "owner");
    const token = await signSession({ kind: "staff", staffId, tenantId: tenantA }, 60);
    expect((await resolveStaffContext(token))?.active?.role).toBe("owner");
    await adminSql`update staff_memberships set role = 'attendant' where staff_id = ${staffId}`;
    expect((await resolveStaffContext(token))?.active?.role).toBe("attendant");
  });
  it("contexto: membership removida invalida a loja ativa", async () => {
    await addMembership(tenantA, staffId, "owner");
    await addMembership(tenantB, staffId, "owner");
    const token = await signSession({ kind: "staff", staffId, tenantId: tenantA }, 60);
    await adminSql`delete from staff_memberships where tenant_id = ${tenantA}`;
    const ctx = await resolveStaffContext(token);
    expect(ctx?.active).toBeNull();
  });
  it("contexto: sem nenhuma membership ou token inválido vira null", async () => {
    const token = await signSession({ kind: "staff", staffId, tenantId: null }, 60);
    expect(await resolveStaffContext(token)).toBeNull();
    expect(await resolveStaffContext("lixo")).toBeNull();
    expect(await resolveStaffContext(undefined)).toBeNull();
  });
});

describe("writeAudit", () => {
  it("grava na loja certa", async () => {
    await writeAudit(tenantA, { actor: `staff:${staffId}`, action: "tenant.select", ip: "1.1.1.1" });
    const rows = await adminSql`select tenant_id, action from audit_log`;
    expect(rows.map((r) => [r.tenant_id, r.action])).toEqual([[tenantA, "tenant.select"]]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/auth/staff.test.ts`
Expected: FAIL.

- [ ] **Step 3: Migration da função de memberships**

O staff precisa listar as próprias lojas **antes** de escolher uma, mas a RLS exige tenant. Uma função `SECURITY DEFINER` com escopo mínimo resolve isso.

`src/server/db/migrations/0003_staff_memberships_fn.sql`:

```sql
create function staff_memberships_for(p_staff uuid)
returns table (tenant_id uuid, role text, slug text, name text)
language sql stable security definer
set search_path = public
as $$
  select m.tenant_id, m.role, t.slug, t.name
  from staff_memberships m
  join tenants t on t.id = m.tenant_id
  where m.staff_id = p_staff and t.status = 'active'
  order by t.name
$$;

revoke all on function staff_memberships_for(uuid) from public;
grant execute on function staff_memberships_for(uuid) to bora_app;
```

Run: `npm run db:migrate`
Expected: `aplicadas: 0003_staff_memberships_fn.sql`.

- [ ] **Step 4: Auditoria**

`src/server/audit.ts`:

```ts
import { auditLog } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";

export async function writeAudit(
  tenantId: string,
  entry: { actor: string; action: string; resource?: string; ip?: string },
): Promise<void> {
  await withTenant(tenantId, (tx) =>
    tx.insert(auditLog).values({
      tenantId,
      actor: entry.actor,
      action: entry.action,
      resource: entry.resource ?? null,
      ip: entry.ip ?? null,
    }),
  );
}
```

- [ ] **Step 5: Módulo de staff**

`src/server/auth/staff.ts`:

```ts
import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can, type Action, type Role } from "@/server/auth/can";
import { STAFF_COOKIE } from "@/server/auth/cookies";
import { dummyHash, verifyPassword } from "@/server/auth/password";
import { verifySession } from "@/server/auth/session";
import { hit, resetThrottle, retryAfterMs, type ThrottleOpts } from "@/server/auth/throttle";
import { db } from "@/server/db/client";
import { staffUsers } from "@/server/db/schema";

const MAX_PASSWORD_LENGTH = 128;
const EMAIL_LIMIT: ThrottleOpts = { max: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
const IP_LIMIT: ThrottleOpts = { max: 20, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };

export const loginSchema = z.object({
  email: z.string().max(254),
  password: z.string().min(1).max(128),
});

export function normalizeEmail(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

export type AuthResult =
  | { ok: true; staffId: string }
  | { ok: false; reason: "invalid" | "throttled" };

export async function authenticateStaff(
  rawEmail: string,
  password: string,
  ip: string,
): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  const emailKey = `staff:email:${email}`;
  const ipKey = `staff:ip:${ip}`;

  const waits = await Promise.all([retryAfterMs(emailKey), retryAfterMs(ipKey)]);
  if (waits.some((ms) => ms > 0)) return { ok: false, reason: "throttled" };

  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, email)).limit(1);
  // Senha acima de 128 caracteres nunca chega ao argon2 (evita DoS por entrada gigante).
  const matches =
    password.length > MAX_PASSWORD_LENGTH
      ? false
      : await verifyPassword(user?.passwordHash ?? (await dummyHash()), password);

  if (!user || !matches) {
    await Promise.all([hit(emailKey, EMAIL_LIMIT), hit(ipKey, IP_LIMIT)]);
    return { ok: false, reason: "invalid" };
  }
  await resetThrottle(emailKey);
  return { ok: true, staffId: user.id };
}

export interface Membership {
  tenantId: string;
  role: Role;
  slug: string;
  name: string;
}

export async function listMemberships(staffId: string): Promise<Membership[]> {
  const rows = await db.execute(
    sql`select tenant_id, role, slug, name from staff_memberships_for(${staffId}::uuid)`,
  );
  return rows.map((r) => ({
    tenantId: r.tenant_id as string,
    role: r.role as Role,
    slug: r.slug as string,
    name: r.name as string,
  }));
}

export interface StaffContext {
  staffId: string;
  memberships: Membership[];
  active: Membership | null;
}

/** Revalida contra o banco a cada request: papel e loja ativa nunca vêm só do token. */
export async function resolveStaffContext(
  token: string | undefined,
): Promise<StaffContext | null> {
  const session = await verifySession(token);
  if (!session || session.kind !== "staff") return null;
  const memberships = await listMemberships(session.staffId);
  if (memberships.length === 0) return null;
  const active = memberships.find((m) => m.tenantId === session.tenantId) ?? null;
  return { staffId: session.staffId, memberships, active };
}

export async function getStaffContext(): Promise<StaffContext | null> {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  return resolveStaffContext(token);
}

export async function requireAction(
  action: Action,
): Promise<StaffContext & { active: Membership }> {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/login");
  if (!ctx.active || !can(ctx.active.role, action)) redirect("/");
  return { ...ctx, active: ctx.active };
}
```

A política de tamanho mínimo vale só para criar e trocar senha; o login só limita o máximo.

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run tests/auth/staff.test.ts`
Expected: PASS.

- [ ] **Step 7: Server actions do painel**

`src/app/panel/actions.ts`:

```ts
"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import {
  cookieOptions,
  STAFF_COOKIE,
  STAFF_TTL_SECONDS,
} from "@/server/auth/cookies";
import { clientIp } from "@/server/auth/ip";
import { signSession } from "@/server/auth/session";
import {
  authenticateStaff,
  getStaffContext,
  listMemberships,
  loginSchema,
} from "@/server/auth/staff";

export async function loginAction(formData: FormData): Promise<void> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/login?error=invalid");

  const ip = clientIp(await headers());
  const result = await authenticateStaff(parsed.data.email, parsed.data.password, ip);
  if (!result.ok) redirect(`/login?error=${result.reason}`);

  const memberships = await listMemberships(result.staffId);
  if (memberships.length === 0) redirect("/login?error=no_store");

  // Com uma única loja, já entra nela.
  const tenantId = memberships.length === 1 ? memberships[0].tenantId : null;
  const token = await signSession(
    { kind: "staff", staffId: result.staffId, tenantId },
    STAFF_TTL_SECONDS,
  );
  (await cookies()).set(STAFF_COOKIE, token, cookieOptions(STAFF_TTL_SECONDS));
  if (tenantId) {
    await writeAudit(tenantId, { actor: `staff:${result.staffId}`, action: "staff.login", ip });
  }
  redirect("/");
}

export async function selectTenantAction(formData: FormData): Promise<void> {
  const tenantId = z.string().uuid().safeParse(formData.get("tenantId"));
  const ctx = await getStaffContext();
  if (!ctx) redirect("/login");
  if (!tenantId.success || !ctx.memberships.some((m) => m.tenantId === tenantId.data)) {
    redirect("/");
  }

  const token = await signSession(
    { kind: "staff", staffId: ctx.staffId, tenantId: tenantId.data },
    STAFF_TTL_SECONDS,
  );
  (await cookies()).set(STAFF_COOKIE, token, cookieOptions(STAFF_TTL_SECONDS));
  await writeAudit(tenantId.data, {
    actor: `staff:${ctx.staffId}`,
    action: "tenant.select",
    ip: clientIp(await headers()),
  });
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(STAFF_COOKIE);
  redirect("/login");
}
```

- [ ] **Step 8: Páginas do painel**

`src/app/panel/layout.tsx`:

```tsx
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <p className="mb-12 text-2xl font-bold tracking-tight">
        bora<span className="text-[#EA580C]">.</span>
      </p>
      {children}
    </div>
  );
}
```

`src/app/panel/login/page.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "../actions";

const ERRORS: Record<string, string> = {
  invalid: "E-mail ou senha incorretos.",
  throttled: "Muitas tentativas. Aguarde 15 minutos e tente de novo.",
  no_store: "Sua conta ainda não está vinculada a nenhuma loja.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? ERRORS[error] : undefined;

  return (
    <main>
      <h1 className="text-4xl font-bold tracking-tight">Entrar</h1>
      <p className="mt-3 leading-relaxed text-zinc-500">Acesse o painel da sua loja.</p>

      <form action={loginAction} className="mt-10 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" autoComplete="username" required maxLength={254} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required maxLength={128} />
        </div>
        {message ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {message}
          </p>
        ) : null}
        <Button type="submit" className="w-full transition-all duration-200">
          Entrar
        </Button>
      </form>

      <Link
        href="/esqueci-senha"
        className="mt-6 inline-block text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Esqueci minha senha
      </Link>
    </main>
  );
}
```

`src/app/panel/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { Building2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStaffContext } from "@/server/auth/staff";
import { logoutAction, selectTenantAction } from "./actions";

const ROLE_LABEL = { owner: "Dono", manager: "Gerente", attendant: "Atendente" } as const;

export default async function PanelHome() {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/login");

  if (!ctx.active) {
    return (
      <main>
        <h1 className="text-4xl font-bold tracking-tight">Escolha a loja</h1>
        <ul className="mt-10 space-y-3">
          {ctx.memberships.map((m) => (
            <li key={m.tenantId}>
              <form action={selectTenantAction}>
                <input type="hidden" name="tenantId" value={m.tenantId} />
                <button
                  type="submit"
                  className="flex w-full items-center justify-between rounded-md border border-zinc-200 px-4 py-4 text-left transition-all duration-200 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <span className="flex items-center gap-3">
                    <Building2 className="size-4 text-zinc-500" />
                    <span className="font-medium">{m.name}</span>
                  </span>
                  <span className="text-sm text-zinc-500">{ROLE_LABEL[m.role]}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  return (
    <main>
      <p className="text-sm text-zinc-500">{ROLE_LABEL[ctx.active.role]}</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">{ctx.active.name}</h1>
      <p className="mt-3 leading-relaxed text-zinc-500">
        Painel em construção. Pedidos, catálogo e estoque chegam nos próximos módulos.
      </p>
      <form action={logoutAction} className="mt-10">
        <Button type="submit" variant="outline" className="transition-all duration-200">
          <LogOut className="size-4" />
          Sair
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 9: Verificar build e commit**

Run: `npm run typecheck && npm run lint && npx vitest run tests/auth`
Expected: tudo passa.

```bash
git add -A
git commit -m "feat(auth): login do staff, escolha de loja, painel e auditoria"
```

---

### Task 9: Reset de senha do staff

**Files:**
- Create: `src/server/auth/reset.ts`, `src/app/panel/esqueci-senha/page.tsx`, `src/app/panel/esqueci-senha/actions.ts`, `src/app/panel/redefinir-senha/page.tsx`, `src/app/panel/redefinir-senha/actions.ts`, `tests/auth/reset.test.ts`

**Interfaces:**
- Consumes: `normalizeEmail` (Task 8), `hashPassword`, `passwordSchema` (Task 6), `hit`, `retryAfterMs` (Task 7), `db`, tabelas.
- Produces:
  - `interface Mailer { send(to: string, subject: string, text: string): Promise<void> }`, `consoleMailer: Mailer`, `getMailer(): Mailer`
  - `requestPasswordReset(rawEmail: string, ip: string, mailer?: Mailer): Promise<void>` (nunca revela se o e-mail existe)
  - `confirmPasswordReset(token: string, newPassword: string): Promise<{ ok: true } | { ok: false; reason: "invalid" | "weak" }>`

- [ ] **Step 1: Testes**

`tests/auth/reset.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { verifyPassword } from "@/server/auth/password";
import { confirmPasswordReset, requestPasswordReset, type Mailer } from "@/server/auth/reset";
import { closeDb, db } from "@/server/db/client";
import { staffUsers } from "@/server/db/schema";
import { adminSql, closeAdmin, createStaff, resetDb } from "../helpers/db";

const sent: { to: string; subject: string; text: string }[] = [];
const mailer: Mailer = {
  async send(to, subject, text) {
    sent.push({ to, subject, text });
  },
};

function tokenFromMail(): string {
  const match = sent.at(-1)?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("sem token no e-mail");
  return match[1];
}

beforeEach(async () => {
  sent.length = 0;
  await resetDb();
  await createStaff("dono@exemplo.com", "senha-antiga-123");
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("reset de senha", () => {
  it("e-mail inexistente: não envia nada e não lança", async () => {
    await expect(requestPasswordReset("ninguem@exemplo.com", "1.1.1.1", mailer)).resolves.toBeUndefined();
    expect(sent.length).toBe(0);
  });

  it("fluxo completo troca a senha", async () => {
    await requestPasswordReset("  DONO@exemplo.com ", "1.1.1.1", mailer);
    expect(sent.length).toBe(1);
    const token = tokenFromMail();
    expect(await confirmPasswordReset(token, "senha-nova-456789")).toEqual({ ok: true });
    const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, "dono@exemplo.com"));
    expect(await verifyPassword(user.passwordHash, "senha-nova-456789")).toBe(true);
    expect(await verifyPassword(user.passwordHash, "senha-antiga-123")).toBe(false);
  });

  it("o token é de uso único", async () => {
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    const token = tokenFromMail();
    await confirmPasswordReset(token, "senha-nova-456789");
    expect(await confirmPasswordReset(token, "outra-senha-456789")).toEqual({ ok: false, reason: "invalid" });
  });

  it("token expirado (30 min) é recusado", async () => {
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    const token = tokenFromMail();
    await adminSql`update password_reset_tokens set expires_at = now() - interval '1 minute'`;
    expect(await confirmPasswordReset(token, "senha-nova-456789")).toEqual({ ok: false, reason: "invalid" });
  });

  it("o token fica guardado com hash, nunca em claro", async () => {
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    const token = tokenFromMail();
    const rows = await adminSql`select token_hash from password_reset_tokens`;
    expect(rows[0].token_hash).not.toContain(token);
  });

  it("senha fraca é recusada sem consumir o token", async () => {
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    const token = tokenFromMail();
    expect(await confirmPasswordReset(token, "curta")).toEqual({ ok: false, reason: "weak" });
    expect(await confirmPasswordReset(token, "senha-nova-456789")).toEqual({ ok: true });
  });

  it("token inventado ou vazio é recusado", async () => {
    expect(await confirmPasswordReset("inventado", "senha-nova-456789")).toEqual({ ok: false, reason: "invalid" });
    expect(await confirmPasswordReset("", "senha-nova-456789")).toEqual({ ok: false, reason: "invalid" });
  });

  it("no máximo 3 pedidos por e-mail em 15 min", async () => {
    for (let i = 0; i < 5; i++) await requestPasswordReset("dono@exemplo.com", `2.2.2.${i}`, mailer);
    expect(sent.length).toBe(3);
  });

  it("pedir novo reset invalida os tokens anteriores", async () => {
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    const first = tokenFromMail();
    await requestPasswordReset("dono@exemplo.com", "1.1.1.1", mailer);
    expect(await confirmPasswordReset(first, "senha-nova-456789")).toEqual({ ok: false, reason: "invalid" });
    expect(await confirmPasswordReset(tokenFromMail(), "senha-nova-456789")).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/auth/reset.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementação**

`src/server/auth/reset.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { hashPassword, passwordSchema } from "@/server/auth/password";
import { normalizeEmail } from "@/server/auth/staff";
import { hit, retryAfterMs, type ThrottleOpts } from "@/server/auth/throttle";
import { db } from "@/server/db/client";
import { passwordResetTokens, staffUsers } from "@/server/db/schema";

const TOKEN_TTL_MS = 30 * 60_000;
const EMAIL_LIMIT: ThrottleOpts = { max: 3, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
const IP_LIMIT: ThrottleOpts = { max: 10, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export const consoleMailer: Mailer = {
  async send(to, subject, text) {
    console.log(`[mail] para=${to} assunto="${subject}"\n${text}`);
  },
};

/** Provedor real de e-mail entra depois, atrás desta interface. */
export function getMailer(): Mailer {
  return consoleMailer;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function panelOrigin(): string {
  return process.env.PANEL_ORIGIN ?? "http://app.localhost:3000";
}

export async function requestPasswordReset(
  rawEmail: string,
  ip: string,
  mailer: Mailer = getMailer(),
): Promise<void> {
  const email = normalizeEmail(rawEmail).slice(0, 254);
  const emailKey = `reset:email:${email}`;
  const ipKey = `reset:ip:${ip}`;

  const waits = await Promise.all([retryAfterMs(emailKey), retryAfterMs(ipKey)]);
  if (waits.some((ms) => ms > 0)) return;
  await Promise.all([hit(emailKey, EMAIL_LIMIT), hit(ipKey, IP_LIMIT)]);

  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, email)).limit(1);
  if (!user) return;

  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update password_reset_tokens set used_at = now()
      where staff_id = ${user.id} and used_at is null`);
    await tx.insert(passwordResetTokens).values({
      staffId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });
  });

  await mailer.send(
    user.email,
    "Redefinir sua senha no Bora",
    `Use o link para criar uma nova senha (vale por 30 minutos):\n` +
      `${panelOrigin()}/redefinir-senha?token=${token}\n\n` +
      `Se não foi você, ignore este e-mail.`,
  );
}

export type ResetResult = { ok: true } | { ok: false; reason: "invalid" | "weak" };

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<ResetResult> {
  if (token.length === 0 || token.length > 200) return { ok: false, reason: "invalid" };
  if (!passwordSchema.safeParse(newPassword).success) return { ok: false, reason: "weak" };

  const passwordHash = await hashPassword(newPassword);
  return db.transaction(async (tx) => {
    // Consome o token de forma atômica: dois cliques simultâneos não passam os dois.
    const consumed = await tx.execute(sql`
      update password_reset_tokens set used_at = now()
      where token_hash = ${sha256(token)} and used_at is null and expires_at > now()
      returning staff_id`);
    const row = consumed[0] as unknown as { staff_id: string } | undefined;
    if (!row) return { ok: false, reason: "invalid" } as const;

    await tx.update(staffUsers).set({ passwordHash }).where(eq(staffUsers.id, row.staff_id));
    return { ok: true } as const;
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/auth/reset.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Páginas e actions**

`src/app/panel/esqueci-senha/actions.ts`:

```ts
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/server/auth/ip";
import { requestPasswordReset } from "@/server/auth/reset";

export async function requestResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").slice(0, 254);
  await requestPasswordReset(email, clientIp(await headers()));
  // Mesma resposta exista ou não a conta.
  redirect("/esqueci-senha?sent=1");
}
```

`src/app/panel/esqueci-senha/page.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestResetAction } from "./actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <main>
      <h1 className="text-4xl font-bold tracking-tight">Esqueci a senha</h1>
      {sent ? (
        <p role="status" className="mt-6 leading-relaxed text-zinc-500">
          Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Ele vale por 30 minutos.
        </p>
      ) : (
        <form action={requestResetAction} className="mt-10 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" required maxLength={254} />
          </div>
          <Button type="submit" className="w-full transition-all duration-200">
            Enviar link
          </Button>
        </form>
      )}
      <Link
        href="/login"
        className="mt-6 inline-block text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Voltar ao login
      </Link>
    </main>
  );
}
```

`src/app/panel/redefinir-senha/actions.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { confirmPasswordReset } from "@/server/auth/reset";

export async function confirmResetAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await confirmPasswordReset(token, password);
  if (!result.ok) {
    redirect(`/redefinir-senha?token=${encodeURIComponent(token)}&error=${result.reason}`);
  }
  redirect("/login?reset=ok");
}
```

`src/app/panel/redefinir-senha/page.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmResetAction } from "./actions";

const ERRORS: Record<string, string> = {
  invalid: "Link inválido ou expirado. Peça um novo.",
  weak: "A senha precisa ter de 10 a 128 caracteres.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  if (!token) {
    return <p className="text-zinc-500">Link inválido. Peça um novo na tela de login.</p>;
  }

  return (
    <main>
      <h1 className="text-4xl font-bold tracking-tight">Nova senha</h1>
      <form action={confirmResetAction} className="mt-10 space-y-5">
        <input type="hidden" name="token" value={token} />
        <div className="space-y-2">
          <Label htmlFor="password">Nova senha</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} maxLength={128} />
        </div>
        {error && ERRORS[error] ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {ERRORS[error]}
          </p>
        ) : null}
        <Button type="submit" className="w-full transition-all duration-200">
          Salvar senha
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: Verificar e commit**

Run: `npm run typecheck && npm run lint && npx vitest run tests/auth/reset.test.ts`
Expected: passa.

```bash
git add -A
git commit -m "feat(auth): reset de senha por e-mail com token de uso único"
```

---

### Task 10: OTP do cliente e telefone

**Files:**
- Create: `src/server/otp/phone.ts`, `src/server/otp/sender.ts`, `src/server/otp/otp.ts`, `src/server/auth/customer.ts`, `tests/otp/phone.test.ts`, `tests/otp/otp.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `db`, tabelas `otpCodes`, `customers`, `customerProfiles` (Task 3); `hit`, `retryAfterMs` (Task 7); `signSession`/`verifySession` e cookies (Task 6).
- Produces:
  - `normalizePhone(raw: string, dialCode?: string): string | null` (E.164)
  - `interface OtpSender { send(phone: string, code: string, ctx: { tenantSlug: string }): Promise<void> }`, `consoleSender`, `getOtpSender(): OtpSender`
  - `generateCode(): string` (6 dígitos, com zeros à esquerda)
  - `issueOtp(args: { tenantId: string; tenantSlug: string; rawPhone: string; ip: string; sender: OtpSender; generate?: () => string; now?: Date }): Promise<{ ok: true; phone: string } | { ok: false; reason: "invalid_phone" | "throttled" }>`
  - `verifyOtp(args: { tenantId: string; rawPhone: string; code: string; now?: Date }): Promise<{ ok: true; customerId: string } | { ok: false; reason: "invalid" | "expired" | "locked" }>`
  - `getCustomerSession(tenantId: string): Promise<{ customerId: string } | null>` (lê o cookie e exige o mesmo tenant)

- [ ] **Step 1: Testes de telefone (Review Focus 4)**

`tests/otp/phone.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/server/otp/phone";

describe("normalizePhone", () => {
  it("aceita formatos comuns do Brasil", () => {
    for (const input of [
      "(62) 99828-6169",
      "62998286169",
      "+55 62 998286169",
      "5562998286169",
      "+55 (62) 99828-6169",
      "62 9982-86169",
    ]) {
      expect(normalizePhone(input), input).toBe("+5562998286169");
    }
  });
  it("aceita fixo (10 dígitos)", () => {
    expect(normalizePhone("(62) 3225-1234")).toBe("+556232251234");
  });
  it("DDD 55 não é confundido com código do país", () => {
    expect(normalizePhone("55 99999-9999")).toBe("+5555999999999");
  });
  it("rejeita letras, curto, longo e símbolos", () => {
    for (const bad of ["", "abc", "123", "629982861699999", "62998286169x", "62-99828+6169", "'; drop table customers;--"]) {
      expect(normalizePhone(bad), bad).toBeNull();
    }
  });
  it("limite de tamanho da entrada", () => {
    expect(normalizePhone("1".repeat(500))).toBeNull();
  });
});
```

- [ ] **Step 2: Implementar telefone e sender**

`src/server/otp/phone.ts`:

```ts
const NATIONAL_LENGTHS = [10, 11];

/** E.164. `dialCode` virá do país da loja; por ora o padrão é Brasil. */
export function normalizePhone(raw: string, dialCode = "55"): string | null {
  if (raw.length === 0 || raw.length > 32) return null;
  if (!/^[\d\s()+\-.]+$/.test(raw)) return null;
  if (raw.includes("+") && !raw.trim().startsWith("+")) return null;

  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith(dialCode) && NATIONAL_LENGTHS.includes(digits.length - dialCode.length)) {
    return `+${digits}`;
  }
  if (NATIONAL_LENGTHS.includes(digits.length)) return `+${dialCode}${digits}`;
  return null;
}
```

`src/server/otp/sender.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface OtpSender {
  send(phone: string, code: string, ctx: { tenantSlug: string }): Promise<void>;
}

export const consoleSender: OtpSender = {
  async send(phone, code, ctx) {
    console.log(`[otp] loja=${ctx.tenantSlug} telefone=${phone} codigo=${code}`);
  },
};

/** Só para E2E: grava o último código em arquivo. Bloqueado em produção. */
const fileSender: OtpSender = {
  async send(phone, code, ctx) {
    const file = process.env.OTP_FILE ?? ".e2e/otp.json";
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ phone, code, tenant: ctx.tenantSlug }));
  },
};

/** O canal real (WhatsApp) entra no sub-projeto 5, atrás desta interface. */
export function getOtpSender(): OtpSender {
  if (process.env.OTP_SENDER === "file" && process.env.NODE_ENV !== "production") {
    return fileSender;
  }
  return consoleSender;
}
```

- [ ] **Step 3: Testes de OTP (Review Focus 3)**

`tests/otp/otp.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { generateCode, issueOtp, verifyOtp } from "@/server/otp/otp";
import type { OtpSender } from "@/server/otp/sender";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

const PHONE_RAW = "(62) 99828-6169";
const PHONE = "+5562998286169";
const sent: { phone: string; code: string }[] = [];
const sender: OtpSender = {
  async send(phone, code) {
    sent.push({ phone, code });
  },
};

let tenantA: string;
let tenantB: string;

const issue = (over: Partial<Parameters<typeof issueOtp>[0]> = {}) =>
  issueOtp({
    tenantId: tenantA,
    tenantSlug: "loja-a",
    rawPhone: PHONE_RAW,
    ip: "1.1.1.1",
    sender,
    ...over,
  });

beforeEach(async () => {
  sent.length = 0;
  await resetDb();
  tenantA = await createTenant("loja-a");
  tenantB = await createTenant("loja-b");
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("generateCode", () => {
  it("sempre 6 dígitos, preservando zeros à esquerda", () => {
    for (let i = 0; i < 2000; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });
});

describe("issueOtp", () => {
  it("telefone inválido é recusado sem enviar", async () => {
    expect(await issue({ rawPhone: "abc" })).toEqual({ ok: false, reason: "invalid_phone" });
    expect(sent.length).toBe(0);
  });
  it("envia o código e guarda só o hash", async () => {
    expect(await issue()).toEqual({ ok: true, phone: PHONE });
    expect(sent).toHaveLength(1);
    expect(sent[0].phone).toBe(PHONE);
    const [row] = await adminSql`select code_hash from otp_codes`;
    expect(row.code_hash).not.toContain(sent[0].code);
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("o 6º pedido seguido para o mesmo telefone é barrado", async () => {
    for (let i = 0; i < 5; i++) expect((await issue({ ip: `3.3.3.${i}` })).ok).toBe(true);
    expect(await issue({ ip: "3.3.3.99" })).toEqual({ ok: false, reason: "throttled" });
  });
  it("um IP não pode pedir códigos sem fim para telefones diferentes", async () => {
    let blocked = false;
    for (let i = 0; i < 25; i++) {
      // 25 telefones válidos e distintos: (62) 9XXXX-XXXX
      const r = await issue({ rawPhone: `(62) 9${String(10_000_000 + i)}`, ip: "4.4.4.4" });
      if (!r.ok && r.reason === "throttled") blocked = true;
    }
    expect(blocked).toBe(true);
  });
});

describe("verifyOtp", () => {
  it("código certo autentica e cria cliente + perfil da loja", async () => {
    await issue();
    const r = await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: sent[0].code });
    expect(r.ok).toBe(true);
    const customers = await adminSql`select phone from customers`;
    expect(customers.map((c) => c.phone)).toEqual([PHONE]);
    const profiles = await adminSql`select tenant_id from customer_profiles`;
    expect(profiles.map((p) => p.tenant_id)).toEqual([tenantA]);
  });

  it("código com zeros à esquerda funciona como texto", async () => {
    await issue({ generate: () => "004213" });
    expect((await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "004213" })).ok).toBe(true);
  });

  it("código só vale uma vez", async () => {
    await issue({ generate: () => "123456" });
    await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "123456" });
    expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "123456" })).toEqual({ ok: false, reason: "invalid" });
  });

  it("formato inválido é recusado sem gastar tentativa", async () => {
    await issue({ generate: () => "123456" });
    for (const bad of ["12345", "1234567", "abcdef", "", "12 456"]) {
      expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: bad })).toEqual({ ok: false, reason: "invalid" });
    }
    const [row] = await adminSql`select attempts from otp_codes`;
    expect(row.attempts).toBe(0);
  });

  it("5 erros travam: nem o código certo passa depois", async () => {
    await issue({ generate: () => "123456" });
    for (let i = 0; i < 5; i++) {
      expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "000000" })).toEqual({ ok: false, reason: "invalid" });
    }
    expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "123456" })).toEqual({ ok: false, reason: "locked" });
  });

  it("código expira em 10 minutos", async () => {
    const t0 = new Date("2026-01-01T12:00:00Z");
    await issue({ generate: () => "123456", now: t0 });
    const late = new Date(t0.getTime() + 10 * 60_000 + 1000);
    expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "123456", now: late })).toEqual({ ok: false, reason: "expired" });
  });

  it("um novo código invalida o anterior", async () => {
    await issue({ generate: () => "111111" });
    await issue({ generate: () => "222222" });
    expect(await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "111111" })).toEqual({ ok: false, reason: "invalid" });
    expect((await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "222222" })).ok).toBe(true);
  });

  it("código de uma loja não vale em outra", async () => {
    await issue({ generate: () => "123456" });
    expect(await verifyOtp({ tenantId: tenantB, rawPhone: PHONE_RAW, code: "123456" })).toEqual({ ok: false, reason: "invalid" });
  });

  it("o mesmo telefone vira um único cliente global com perfis por loja", async () => {
    await issue({ generate: () => "111111" });
    await verifyOtp({ tenantId: tenantA, rawPhone: PHONE_RAW, code: "111111" });
    await issueOtp({ tenantId: tenantB, tenantSlug: "loja-b", rawPhone: PHONE_RAW, ip: "1.1.1.1", sender, generate: () => "222222" });
    await verifyOtp({ tenantId: tenantB, rawPhone: PHONE_RAW, code: "222222" });
    expect((await adminSql`select 1 from customers`).length).toBe(1);
    expect((await adminSql`select 1 from customer_profiles`).length).toBe(2);
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run tests/otp`
Expected: FAIL (otp.ts não existe).

- [ ] **Step 5: Implementar OTP**

`src/server/otp/otp.ts`:

```ts
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { hit, retryAfterMs, type ThrottleOpts } from "@/server/auth/throttle";
import { customerProfiles, customers, otpCodes } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { normalizePhone } from "./phone";
import type { OtpSender } from "./sender";

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const PHONE_LIMIT: ThrottleOpts = { max: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
const IP_LIMIT: ThrottleOpts = { max: 20, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashCode(code: string, tenantId: string, phone: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET ausente");
  return createHmac("sha256", secret).update(`otp:${tenantId}:${phone}:${code}`).digest("hex");
}

export type IssueResult =
  | { ok: true; phone: string }
  | { ok: false; reason: "invalid_phone" | "throttled" };

export async function issueOtp(args: {
  tenantId: string;
  tenantSlug: string;
  rawPhone: string;
  ip: string;
  sender: OtpSender;
  generate?: () => string;
  now?: Date;
}): Promise<IssueResult> {
  const phone = normalizePhone(args.rawPhone);
  if (!phone) return { ok: false, reason: "invalid_phone" };

  const now = args.now ?? new Date();
  const phoneKey = `otp:req:${args.tenantId}:${phone}`;
  const ipKey = `otp:ip:${args.ip}`;
  const waits = await Promise.all([retryAfterMs(phoneKey, now), retryAfterMs(ipKey, now)]);
  if (waits.some((ms) => ms > 0)) return { ok: false, reason: "throttled" };
  await Promise.all([hit(phoneKey, PHONE_LIMIT, now), hit(ipKey, IP_LIMIT, now)]);

  const code = (args.generate ?? generateCode)();
  await withTenant(args.tenantId, async (tx) => {
    // Só o código mais recente vale.
    await tx
      .update(otpCodes)
      .set({ consumedAt: now })
      .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)));
    await tx.insert(otpCodes).values({
      tenantId: args.tenantId,
      phone,
      codeHash: hashCode(code, args.tenantId, phone),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    });
  });
  await args.sender.send(phone, code, { tenantSlug: args.tenantSlug });
  return { ok: true, phone };
}

export type VerifyResult =
  | { ok: true; customerId: string }
  | { ok: false; reason: "invalid" | "expired" | "locked" };

export async function verifyOtp(args: {
  tenantId: string;
  rawPhone: string;
  code: string;
  now?: Date;
}): Promise<VerifyResult> {
  const phone = normalizePhone(args.rawPhone);
  if (!phone || !/^\d{6}$/.test(args.code)) return { ok: false, reason: "invalid" };
  const now = args.now ?? new Date();

  return withTenant(args.tenantId, async (tx): Promise<VerifyResult> => {
    const [row] = await tx
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt)))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1)
      .for("update");
    if (!row) return { ok: false, reason: "invalid" };
    if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };
    if (row.expiresAt <= now) return { ok: false, reason: "expired" };

    const expected = Buffer.from(row.codeHash, "hex");
    const given = Buffer.from(hashCode(args.code, args.tenantId, phone), "hex");
    const match = expected.length === given.length && timingSafeEqual(expected, given);

    if (!match) {
      await tx
        .update(otpCodes)
        .set({ attempts: row.attempts + 1 })
        .where(eq(otpCodes.id, row.id));
      return { ok: false, reason: "invalid" };
    }

    await tx.update(otpCodes).set({ consumedAt: now }).where(eq(otpCodes.id, row.id));
    const [customer] = await tx
      .insert(customers)
      .values({ phone })
      .onConflictDoUpdate({ target: customers.phone, set: { phone: sql`excluded.phone` } })
      .returning({ id: customers.id });
    await tx
      .insert(customerProfiles)
      .values({ tenantId: args.tenantId, customerId: customer.id })
      .onConflictDoNothing();
    return { ok: true, customerId: customer.id };
  });
}
```

`src/server/auth/customer.ts`:

```ts
import { cookies } from "next/headers";
import { CUSTOMER_COOKIE } from "@/server/auth/cookies";
import { verifySession } from "@/server/auth/session";

/** A sessão só vale na loja para a qual foi emitida. */
export async function getCustomerSession(
  tenantId: string,
): Promise<{ customerId: string } | null> {
  const token = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session || session.kind !== "customer" || session.tenantId !== tenantId) return null;
  return { customerId: session.customerId };
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run tests/otp`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(otp): código por telefone com hash, limite e sessão do cliente"
```

---

### Task 11: Vitrine da loja, landing e fluxo de entrar do cliente

**Files:**
- Create: `src/server/tenancy/lookup.ts`, `src/server/tenancy/cached.ts`, `src/server/theme/load.ts`, `src/app/(platform)/page.tsx` (substitui o placeholder), `src/app/s/[slug]/layout.tsx`, `src/app/s/[slug]/page.tsx`, `src/app/s/[slug]/not-found.tsx`, `src/app/s/[slug]/entrar/page.tsx`, `src/app/s/[slug]/entrar/actions.ts`, `src/app/s/[slug]/conta/page.tsx`, `tests/tenancy/lookup.test.ts`

**Interfaces:**
- Consumes: `resolve`/`segmentFor` (Task 4); `themeSchema`, `defaultTheme`, `themeToCss` (Task 5); `issueOtp`, `verifyOtp`, `getOtpSender`, `getCustomerSession` (Task 10); `withTenant`, `db`, tabelas.
- Produces:
  - `type TenantRef = { id: string; slug: string; name: string; vertical: string; timezone: string }`
  - `findTenantBySegment(segment: string): Promise<TenantRef | null>` (slug, ou host se tiver ponto; só tenants ativos; domínio só se verificado)
  - `loadTenantTheme(tenantId: string): Promise<Theme>` (cai no padrão se vazio ou inválido)
  - `getTenantCached`, `getThemeCached` (cache de 60 s)

- [ ] **Step 1: Testes de lookup e tema**

`tests/tenancy/lookup.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { findTenantBySegment } from "@/server/tenancy/lookup";
import { defaultTheme } from "@/server/theme/theme";
import { loadTenantTheme } from "@/server/theme/load";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

let tenantA: string;

beforeEach(async () => {
  await resetDb();
  tenantA = await createTenant("loja-a", "Loja A", "acaiteria");
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("findTenantBySegment", () => {
  it("acha por slug, ignorando caixa", async () => {
    expect((await findTenantBySegment("LOJA-A"))?.id).toBe(tenantA);
  });
  it("slug desconhecido é null", async () => {
    expect(await findTenantBySegment("nao-existe")).toBeNull();
  });
  it("loja suspensa não é servida", async () => {
    await adminSql`update tenants set status = 'suspended' where id = ${tenantA}`;
    expect(await findTenantBySegment("loja-a")).toBeNull();
  });
  it("domínio próprio só vale se verificado", async () => {
    await adminSql`insert into tenant_domains (host, tenant_id, verified) values ('cardapio.loja.com.br', ${tenantA}, false)`;
    expect(await findTenantBySegment("cardapio.loja.com.br")).toBeNull();
    await adminSql`update tenant_domains set verified = true`;
    expect((await findTenantBySegment("cardapio.loja.com.br"))?.slug).toBe("loja-a");
  });
  it("segmento com percent-encoding malformado não lança", async () => {
    expect(await findTenantBySegment("%E0%A4%A")).toBeNull();
  });
});

describe("loadTenantTheme", () => {
  it("sem settings: tema padrão", async () => {
    expect(await loadTenantTheme(tenantA)).toEqual(defaultTheme);
  });
  it("mescla o salvo com o padrão", async () => {
    await adminSql`insert into tenant_settings (tenant_id, theme) values (${tenantA}, ${adminSql.json({ accent: "#BE185D", radius: "lg" })})`;
    const theme = await loadTenantTheme(tenantA);
    expect(theme.accent).toBe("#be185d");
    expect(theme.radius).toBe("lg");
    expect(theme.font).toBe("geist");
  });
  it("tema salvo inválido cai no padrão em vez de quebrar a loja", async () => {
    await adminSql`insert into tenant_settings (tenant_id, theme) values (${tenantA}, ${adminSql.json({ accent: "#fff;}body{display:none" })})`;
    expect(await loadTenantTheme(tenantA)).toEqual(defaultTheme);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/tenancy/lookup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Lookup e tema**

`src/server/tenancy/lookup.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { tenantDomains, tenants } from "@/server/db/schema";

export interface TenantRef {
  id: string;
  slug: string;
  name: string;
  vertical: string;
  timezone: string;
}

const COLUMNS = {
  id: tenants.id,
  slug: tenants.slug,
  name: tenants.name,
  vertical: tenants.vertical,
  timezone: tenants.timezone,
};

export async function findTenantBySegment(segment: string): Promise<TenantRef | null> {
  let value: string;
  try {
    value = decodeURIComponent(segment).toLowerCase();
  } catch {
    return null;
  }

  if (value.includes(".")) {
    const [row] = await db
      .select(COLUMNS)
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(
        and(
          eq(tenantDomains.host, value),
          eq(tenantDomains.verified, true),
          eq(tenants.status, "active"),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  const [row] = await db
    .select(COLUMNS)
    .from(tenants)
    .where(and(eq(tenants.slug, value), eq(tenants.status, "active")))
    .limit(1);
  return row ?? null;
}
```

`src/server/theme/load.ts`:

```ts
import { tenantSettings } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { defaultTheme, themeSchema, type Theme } from "./theme";

export async function loadTenantTheme(tenantId: string): Promise<Theme> {
  const [row] = await withTenant(tenantId, (tx) =>
    tx.select({ theme: tenantSettings.theme }).from(tenantSettings).limit(1),
  );
  const stored = row?.theme;
  if (!stored || typeof stored !== "object") return defaultTheme;
  const parsed = themeSchema.safeParse({ ...defaultTheme, ...(stored as Record<string, unknown>) });
  return parsed.success ? parsed.data : defaultTheme;
}
```

`src/server/tenancy/cached.ts`:

```ts
import { unstable_cache } from "next/cache";
import { loadTenantTheme } from "@/server/theme/load";
import { findTenantBySegment } from "./lookup";

export const getTenantCached = unstable_cache(findTenantBySegment, ["tenant-by-segment"], {
  revalidate: 60,
  tags: ["tenants"],
});

export const getThemeCached = unstable_cache(loadTenantTheme, ["tenant-theme"], {
  revalidate: 60,
  tags: ["tenants"],
});
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/tenancy/lookup.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Landing do Bora**

`src/app/(platform)/page.tsx`:

```tsx
import { ArrowRight } from "lucide-react";

export default function LandingPage() {
  const panelOrigin = process.env.PANEL_ORIGIN ?? "http://app.localhost:3000";

  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-between px-6 py-12 md:py-24">
      <header className="flex items-center justify-between">
        <span className="text-2xl font-bold tracking-tight">
          bora<span className="text-[#EA580C]">.</span>
        </span>
        <a
          href={`${panelOrigin}/login`}
          className="text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Entrar
        </a>
      </header>

      <section className="max-w-3xl py-24">
        <h1 className="text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
          Seu cardápio no ar.
          <br />
          Seus pedidos na mão.
        </h1>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-zinc-500">
          Restaurante, lanchonete ou quiosque de açaí: uma vitrine com a cara da sua marca e um painel simples para
          receber e acompanhar cada pedido.
        </p>
        <a
          href={`${panelOrigin}/login`}
          className="mt-12 inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-3 text-sm font-medium text-background transition-all duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Acessar o painel
          <ArrowRight className="size-4" />
        </a>
      </section>

      <footer className="border-t border-zinc-200 pt-6 text-sm text-zinc-500 dark:border-zinc-800">
        bora, pedidos sem complicação.
      </footer>
    </main>
  );
}
```

- [ ] **Step 6: Layout da vitrine com tema sem flash**

`src/app/s/[slug]/layout.tsx`:

```tsx
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTenantCached, getThemeCached } from "@/server/tenancy/cached";
import { themeToCss } from "@/server/theme/theme";

export default async function StoreLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = await getTenantCached(slug);
  if (!tenant) notFound();

  const theme = await getThemeCached(tenant.id);
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <>
      {/* Variáveis de tema no HTML do servidor: sem flash de cor errada. */}
      <style nonce={nonce} dangerouslySetInnerHTML={{ __html: themeToCss(theme) }} />
      <div className="min-h-dvh bg-background font-[family-name:var(--font-store)] text-foreground">
        {children}
      </div>
    </>
  );
}
```

`src/app/s/[slug]/not-found.tsx`:

```tsx
export default function StoreNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <h1 className="text-4xl font-bold tracking-tight">Loja não encontrada</h1>
      <p className="mt-3 leading-relaxed text-zinc-500">Confira o endereço e tente de novo.</p>
    </main>
  );
}
```

`notFound()` chamado no `layout.tsx` do segmento é capturado pelo `not-found.tsx` do nível acima. Por isso, crie também `src/app/not-found.tsx` com o mesmo conteúdo do arquivo acima (a página `page.tsx` do segmento usa o `not-found.tsx` do próprio segmento).

`src/app/s/[slug]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { User } from "lucide-react";
import { getTenantCached } from "@/server/tenancy/cached";

const VERTICAL_LABEL: Record<string, string> = {
  restaurante: "Restaurante",
  lanchonete: "Lanchonete",
  acaiteria: "Açaiteria",
  quiosque: "Quiosque",
};

export default async function StoreHome({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getTenantCached(slug);
  if (!tenant) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-12 md:py-24">
      <header className="flex items-center justify-between">
        <span className="size-3 rounded-full bg-primary" aria-hidden />
        <Link
          href="/entrar"
          className="inline-flex items-center gap-2 text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <User className="size-4" />
          Entrar
        </Link>
      </header>

      <section className="py-24">
        <p className="text-sm text-zinc-500">{VERTICAL_LABEL[tenant.vertical] ?? "Loja"}</p>
        <h1 className="mt-3 text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">{tenant.name}</h1>
        <p className="mt-6 max-w-lg text-lg leading-relaxed text-zinc-500">
          O cardápio chega em breve. Por enquanto, entre com seu telefone para acompanhar seus pedidos.
        </p>
      </section>
    </main>
  );
}
```

- [ ] **Step 7: Fluxo de entrar (OTP) e conta**

`src/app/s/[slug]/entrar/actions.ts`:

```ts
"use server";

import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { CUSTOMER_COOKIE, CUSTOMER_TTL_SECONDS, cookieOptions } from "@/server/auth/cookies";
import { clientIp } from "@/server/auth/ip";
import { signSession } from "@/server/auth/session";
import { issueOtp, verifyOtp } from "@/server/otp/otp";
import { getOtpSender } from "@/server/otp/sender";
import { findTenantBySegment } from "@/server/tenancy/lookup";

const segmentSchema = z.string().min(1).max(253);

export async function requestCodeAction(formData: FormData): Promise<void> {
  const segment = segmentSchema.parse(formData.get("segment"));
  const tenant = await findTenantBySegment(segment);
  if (!tenant) notFound();

  const result = await issueOtp({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    rawPhone: String(formData.get("phone") ?? ""),
    ip: clientIp(await headers()),
    sender: getOtpSender(),
  });
  if (!result.ok) redirect(`/entrar?erro=${result.reason}`);
  redirect(`/entrar?etapa=codigo&tel=${encodeURIComponent(result.phone)}`);
}

export async function verifyCodeAction(formData: FormData): Promise<void> {
  const segment = segmentSchema.parse(formData.get("segment"));
  const tenant = await findTenantBySegment(segment);
  if (!tenant) notFound();

  const phone = String(formData.get("phone") ?? "");
  const result = await verifyOtp({
    tenantId: tenant.id,
    rawPhone: phone,
    code: String(formData.get("code") ?? ""),
  });
  if (!result.ok) {
    redirect(`/entrar?etapa=codigo&tel=${encodeURIComponent(phone)}&erro=${result.reason}`);
  }

  const token = await signSession(
    { kind: "customer", customerId: result.customerId, tenantId: tenant.id },
    CUSTOMER_TTL_SECONDS,
  );
  (await cookies()).set(CUSTOMER_COOKIE, token, cookieOptions(CUSTOMER_TTL_SECONDS));
  await writeAudit(tenant.id, {
    actor: `customer:${result.customerId}`,
    action: "customer.login",
    ip: clientIp(await headers()),
  });
  redirect("/conta");
}

export async function customerLogoutAction(): Promise<void> {
  (await cookies()).delete(CUSTOMER_COOKIE);
  redirect("/");
}
```

`src/app/s/[slug]/entrar/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTenantCached } from "@/server/tenancy/cached";
import { requestCodeAction, verifyCodeAction } from "./actions";

const ERRORS: Record<string, string> = {
  invalid_phone: "Telefone inválido. Use DDD + número.",
  throttled: "Muitas tentativas. Aguarde alguns minutos.",
  invalid: "Código incorreto.",
  expired: "Código expirado. Peça um novo.",
  locked: "Muitas tentativas erradas. Peça um novo código.",
};

export default async function EnterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ etapa?: string; tel?: string; erro?: string }>;
}) {
  const { slug } = await params;
  const { etapa, tel, erro } = await searchParams;
  const tenant = await getTenantCached(slug);
  if (!tenant) notFound();
  const message = erro ? ERRORS[erro] : undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-4xl font-bold tracking-tight">Entrar</h1>
      <p className="mt-3 leading-relaxed text-zinc-500">{tenant.name}</p>

      {etapa === "codigo" && tel ? (
        <form action={verifyCodeAction} className="mt-10 space-y-5">
          <input type="hidden" name="segment" value={slug} />
          <input type="hidden" name="phone" value={tel} />
          <div className="space-y-2">
            <Label htmlFor="code">Código enviado para {tel}</Label>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              className="text-lg tracking-[0.4em]"
            />
          </div>
          {message ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {message}
            </p>
          ) : null}
          <Button type="submit" className="w-full transition-all duration-200">
            Confirmar
          </Button>
        </form>
      ) : (
        <form action={requestCodeAction} className="mt-10 space-y-5">
          <input type="hidden" name="segment" value={slug} />
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone com DDD</Label>
            <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" required maxLength={32} />
          </div>
          {message ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {message}
            </p>
          ) : null}
          <Button type="submit" className="w-full transition-all duration-200">
            Receber código
          </Button>
        </form>
      )}
    </main>
  );
}
```

`src/app/s/[slug]/conta/page.tsx`:

```tsx
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCustomerSession } from "@/server/auth/customer";
import { db } from "@/server/db/client";
import { customers } from "@/server/db/schema";
import { getTenantCached } from "@/server/tenancy/cached";
import { customerLogoutAction } from "../entrar/actions";

export default async function AccountPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await getTenantCached(slug);
  if (!tenant) notFound();

  const session = await getCustomerSession(tenant.id);
  if (!session) redirect("/entrar");

  const [customer] = await db
    .select({ phone: customers.phone })
    .from(customers)
    .where(eq(customers.id, session.customerId))
    .limit(1);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <p className="text-sm text-zinc-500">{tenant.name}</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">Sua conta</h1>
      <p className="mt-3 leading-relaxed text-zinc-500">{customer?.phone}</p>
      <p className="mt-6 leading-relaxed text-zinc-500">Seus pedidos aparecem aqui assim que o cardápio abrir.</p>
      <form action={customerLogoutAction} className="mt-10">
        <Button type="submit" variant="outline" className="transition-all duration-200">
          <LogOut className="size-4" />
          Sair
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 8: Verificar build e commit**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: os três passam.

```bash
git add -A
git commit -m "feat(store): vitrine por tenant com tema sem flash, landing e login do cliente por OTP"
```

---

### Task 12: Seed, E2E, CI e guarda de nomes legados

**Files:**
- Create: `scripts/seed.ts`, `playwright.config.ts`, `tests/e2e/tenancy.spec.ts`, `tests/e2e/staff.spec.ts`, `tests/e2e/customer.spec.ts`, `tests/no-legacy-names.test.ts`, `.github/workflows/ci.yml`
- Modify: `README.md`, `.gitignore` (adicionar `.e2e/`, `playwright-report/`, `test-results/`)

**Interfaces:**
- Consumes: tudo acima.
- Produces: lojas de demonstração `demo-acai` (`#be185d`) e `demo-lanche` (`#15803d`); staff `dono@demo.test` (owner de `demo-acai` e manager de `demo-lanche`, senha `Demo@12345678`) e `atendente@demo.test` (attendant de `demo-lanche`).

- [ ] **Step 1: Guarda de nomes legados (critério de sucesso 5)**

`tests/no-legacy-names.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["src", "scripts", "tests", ".github"];
const SELF = path.join("tests", "no-legacy-names.test.ts");
const EXT = /\.(ts|tsx|sql|css|json|yml|yaml|md|mjs)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("nomes legados", () => {
  it("nenhum arquivo do código menciona o projeto antigo", () => {
    const offenders = ROOTS.flatMap(walk)
      .filter((f) => EXT.test(f) && f !== SELF)
      .filter((f) => /barat[aã]o/i.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
```

Run: `npx vitest run tests/no-legacy-names.test.ts`
Expected: PASS. Se falhar, remova a menção do arquivo listado.

- [ ] **Step 2: Seed de desenvolvimento**

`scripts/seed.ts`:

```ts
import postgres from "postgres";
import { hashPassword } from "../src/server/auth/password";

const STORES = [
  { slug: "demo-acai", name: "Demo Açaí", vertical: "acaiteria", accent: "#be185d" },
  { slug: "demo-lanche", name: "Demo Lanche", vertical: "lanchonete", accent: "#15803d" },
] as const;

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL ausente");
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sql`truncate throttles`;
    const passwordHash = await hashPassword("Demo@12345678");

    const tenantIds: Record<string, string> = {};
    for (const s of STORES) {
      const [t] = await sql`
        insert into tenants (slug, name, vertical)
        values (${s.slug}, ${s.name}, ${s.vertical})
        on conflict (slug) do update set name = excluded.name
        returning id`;
      tenantIds[s.slug] = t.id as string;
      const theme = { accent: s.accent, font: "geist", radius: "md", logoUrl: null };
      await sql`
        insert into tenant_settings (tenant_id, theme)
        values (${t.id}, ${sql.json(theme)})
        on conflict (tenant_id) do update set theme = excluded.theme`;
    }

    const staff = [
      { email: "dono@demo.test", name: "Dono Demo" },
      { email: "atendente@demo.test", name: "Atendente Demo" },
    ];
    const staffIds: Record<string, string> = {};
    for (const p of staff) {
      const [u] = await sql`
        insert into staff_users (email, password_hash, name)
        values (${p.email}, ${passwordHash}, ${p.name})
        on conflict (email) do update set password_hash = excluded.password_hash
        returning id`;
      staffIds[p.email] = u.id as string;
    }

    const memberships = [
      ["demo-acai", "dono@demo.test", "owner"],
      ["demo-lanche", "dono@demo.test", "manager"],
      ["demo-lanche", "atendente@demo.test", "attendant"],
    ] as const;
    for (const [slug, email, role] of memberships) {
      await sql`
        insert into staff_memberships (tenant_id, staff_id, role)
        values (${tenantIds[slug]}, ${staffIds[email]}, ${role})
        on conflict (tenant_id, staff_id) do update set role = excluded.role`;
    }
    console.log("seed ok: demo-acai, demo-lanche, dono@demo.test, atendente@demo.test");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Run: `npm run db:migrate && npm run db:seed`
Expected: `seed ok: ...`. Rodar duas vezes seguidas também termina sem erro.

- [ ] **Step 3: Configuração do Playwright**

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ROOT_DOMAIN: "localhost",
      PANEL_ORIGIN: `http://app.localhost:${PORT}`,
      OTP_SENDER: "file",
      OTP_FILE: ".e2e/otp.json",
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-123456",
      DATABASE_URL: process.env.DATABASE_URL ?? "",
    },
  },
});
```

Adicione ao `.gitignore`: `.e2e/`, `playwright-report/`, `test-results/`.

Run: `npx playwright install chromium`

- [ ] **Step 4: E2E de tenancy e tema**

`tests/e2e/tenancy.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const PORT = 3100;
const url = (host: string, path = "/") => `http://${host}.localhost:${PORT}${path}`;

test("slug desconhecido retorna 404", async ({ request }) => {
  const res = await request.get(url("nao-existe"));
  expect(res.status()).toBe(404);
});

test("rotas internas não são acessíveis direto", async ({ request }) => {
  expect((await request.get(`http://localhost:${PORT}/panel/login`)).status()).toBe(404);
  expect((await request.get(`http://localhost:${PORT}/s/demo-acai`)).status()).toBe(404);
});

test("cada loja carrega o próprio tema", async ({ page }) => {
  await page.goto(url("demo-acai"));
  const acai = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--brand").trim(),
  );
  expect(acai).toBe("#be185d");

  await page.goto(url("demo-lanche"));
  const lanche = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--brand").trim(),
  );
  expect(lanche).toBe("#15803d");
});

test("tema já vem no HTML do servidor (sem flash)", async ({ request }) => {
  const html = await (await request.get(url("demo-acai"))).text();
  expect(html).toContain("--brand:#be185d");
});

test("resposta traz CSP com nonce", async ({ request }) => {
  const res = await request.get(url("demo-acai"));
  expect(res.headers()["content-security-policy"]).toMatch(/nonce-/);
});
```

- [ ] **Step 5: E2E de staff**

`tests/e2e/staff.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

const PORT = 3100;
const panel = (path = "/") => `http://app.localhost:${PORT}${path}`;

test("senha errada mostra erro", async ({ page }) => {
  await page.goto(panel("/login"));
  await page.getByLabel("E-mail").fill("atendente@demo.test");
  await page.getByLabel("Senha").fill("senha-errada-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert")).toContainText("incorretos");
});

test("atendente com uma loja entra direto, com o papel certo", async ({ page }) => {
  await page.goto(panel("/login"));
  await page.getByLabel("E-mail").fill("atendente@demo.test");
  await page.getByLabel("Senha").fill("Demo@12345678");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Demo Lanche" })).toBeVisible();
  await expect(page.getByText("Atendente", { exact: true })).toBeVisible();
});

test("dono com duas lojas escolhe uma", async ({ page }) => {
  await page.goto(panel("/login"));
  await page.getByLabel("E-mail").fill("DONO@demo.test");
  await page.getByLabel("Senha").fill("Demo@12345678");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Escolha a loja" })).toBeVisible();
  await page.getByRole("button", { name: /Demo Açaí/ }).click();
  await expect(page.getByRole("heading", { name: "Demo Açaí" })).toBeVisible();
  await expect(page.getByText("Dono", { exact: true })).toBeVisible();
});

test("sem login, o painel manda para /login", async ({ page }) => {
  await page.goto(panel("/"));
  await expect(page).toHaveURL(/\/login$/);
});
```

- [ ] **Step 6: E2E do cliente**

`tests/e2e/customer.spec.ts`:

```ts
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const PORT = 3100;
const store = (slug: string, path = "/") => `http://${slug}.localhost:${PORT}${path}`;

test("cliente entra por OTP e a sessão não vaza para outra loja", async ({ page }) => {
  await page.goto(store("demo-acai", "/entrar"));
  await page.getByLabel("Telefone com DDD").fill("(62) 99828-6169");
  await page.getByRole("button", { name: "Receber código" }).click();

  const { code, phone } = JSON.parse(await readFile(".e2e/otp.json", "utf8")) as {
    code: string;
    phone: string;
  };
  expect(phone).toBe("+5562998286169");

  await page.getByLabel(/Código enviado/).fill(code);
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("heading", { name: "Sua conta" })).toBeVisible();

  // Cookie é por host: a outra loja não reconhece a sessão.
  await page.goto(store("demo-lanche", "/conta"));
  await expect(page).toHaveURL(/\/entrar$/);
});

test("código errado mostra erro", async ({ page }) => {
  await page.goto(store("demo-lanche", "/entrar"));
  await page.getByLabel("Telefone com DDD").fill("(62) 98888-7777");
  await page.getByRole("button", { name: "Receber código" }).click();
  await page.getByLabel(/Código enviado/).fill("000000");
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("alert")).toContainText("incorreto");
});
```

- [ ] **Step 7: Rodar E2E localmente**

Run: `npm run db:migrate && npm run db:seed && npm run e2e`
Expected: todos os testes passam. Se o Chromium não resolver `*.localhost`, adicione ao `use` do Playwright `launchOptions: { args: ["--host-resolver-rules=MAP *.localhost 127.0.0.1"] }`. Se o console do navegador acusar violação de CSP em dev, ajuste `buildCsp` (Task 4) e acrescente o caso ao `tests/security/csp.test.ts`.

- [ ] **Step 8: CI**

`.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: bora_ci
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      ROOT_DOMAIN: localhost
      PANEL_ORIGIN: http://app.localhost:3100
      SESSION_SECRET: ci-secret-ci-secret-ci-secret-ci-secret-1234
      APP_DB_PASSWORD: bora_app_ci
      DATABASE_ADMIN_URL: postgresql://postgres:postgres@localhost:5432/bora_ci
      DATABASE_URL: postgresql://bora_app:bora_app_ci@localhost:5432/bora_ci
      TEST_DATABASE_ADMIN_URL: postgresql://postgres:postgres@localhost:5432/bora_ci
      TEST_DATABASE_URL: postgresql://bora_app:bora_app_ci@localhost:5432/bora_ci
      CI: "true"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npm run db:migrate
      - run: npm run db:seed
      - run: npm run e2e
```

Ordem importa: o `npm test` limpa as tabelas, e o seed vem depois dele.

Nota: o `vitest.config.ts` lê `.env` com `process.loadEnvFile` e ignora a ausência; no CI as variáveis vêm do `env` do job.

- [ ] **Step 9: README**

Substitua `README.md`:

````markdown
# Bora

Plataforma multi-loja de cardápio digital e pedidos para restaurantes, lanchonetes, açaiterias e quiosques.
v2 do sistema anterior (repositório `baratao`, mantido intocado como v1).

## Stack

Next.js 15 · TypeScript · PostgreSQL 16 · Drizzle · Zod · Tailwind v4 · Shadcn · Vitest · Playwright

## Rodar local

```bash
cp .env.example .env            # ajuste usuário do Postgres e SESSION_SECRET
createdb bora && createdb bora_test
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Endereços (domínio raiz `localhost`):

- Landing: http://localhost:3000
- Painel: http://app.localhost:3000 (`dono@demo.test` / `Demo@12345678`)
- Lojas: http://demo-acai.localhost:3000, http://demo-lanche.localhost:3000

## Testes

```bash
npm test        # unitários e integração (Postgres real, banco bora_test)
npm run e2e     # Playwright
```

## Docs

- Spec: `docs/superpowers/specs/2026-10-02-bora-fundacao-design.md`
- Plano: `docs/superpowers/plans/2026-10-02-bora-fundacao.md`
````

- [ ] **Step 10: Verificação final e commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: tudo passa.

```bash
git add -A
git commit -m "feat: seed, e2e, ci e guarda de nomes legados"
git push
```

---

## Self-Review

**Cobertura da spec**

| Seção da spec | Task |
|---|---|
| 3 Resolução de tenant | 4 (resolver, middleware), 11 (lookup, domínio próprio) |
| 4 Modelo de dados | 2 (SQL), 3 (Drizzle) |
| 5 RLS | 2, 3 |
| 6 Staff (login, papéis, brute force, reset) | 6, 7, 8, 9 |
| 6 Cliente (OTP, sessão por loja, convidado verificado) | 10, 11 |
| 6 CSRF, CSP | 4 (CSP/Origin via Server Actions do Next), 12 |
| 7 Tema | 5, 11 |
| 8 Estrutura do repositório | 1, 4, 8, 11 |
| 9 Ambiente | 1 (bancos via `createdb`, sem Docker) |
| 10 Testes | todas as tasks; E2E na 12 |
| 11 Critérios de sucesso 1 a 5 | 11 e 12 (duas lojas e temas), 8 (papéis), 10 (OTP), 2 e 3 (RLS no CI), 12 (guarda de nomes) |

**Lacunas conhecidas, assumidas de propósito**

- "Pedidos de convidado vinculados à conta quando o telefone é verificado" depende da tabela de pedidos (sub-projeto 3). Nesta fundação, `customer_profiles` e a conta global já existem; o vínculo é feito no checkout.
- CSRF: Server Actions do Next validam `Origin` contra `Host`. Não há rotas `route.ts` que mutam nesta fundação, então a checagem manual de `Origin` não tem onde ser aplicada ainda.
- Upload de logo fica para o sub-projeto 2 (a spec já prevê URL nesta fase).

**Consistência de tipos:** `Role`/`Action`/`can` (Task 6) são usados em 8; `Membership`, `StaffContext` e `resolveStaffContext` (Task 8) são os mesmos nomes nas actions e páginas; `ThrottleOpts`/`hit`/`retryAfterMs`/`resetThrottle` (Task 7) mantêm assinatura em 8, 9 e 10; `TenantRef`/`findTenantBySegment` (Task 11) batem nas actions; `themeToCss` usa `validateAccent` (Task 5).

**Pontos que o executor deve checar ao rodar** (o plano não foi executado antes de escrito):

- Task 1: flags do `shadcn init` e a edição do `globals.css` dependem da versão do CLI.
- Task 11, Step 6: confirmar que a página de loja não encontrada renderiza o `not-found.tsx` esperado.
- Task 12, Step 7: resolução de `*.localhost` no Chromium e violações de CSP em dev.
