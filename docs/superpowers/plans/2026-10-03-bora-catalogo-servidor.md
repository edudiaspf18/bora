# Catálogo — Camada de dados e servidor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o schema do Catálogo com RLS, a regra de disponibilidade, as consultas e os comandos de escrita, tudo testado, sem UI.

**Architecture:** Migration SQL nova (`0005`) espelhada em `schema.ts` (Drizzle). Lógica pura (`time`, `availability`, `money`, `schemas`, `buildMenu`) separada do acesso a dados. Escritas em duas camadas: `writers.ts` (nível `tx`, sem auth) e `commands.ts` (valida, abre `withTenant`, grava auditoria). A UI (painel e vitrine) é o plano seguinte, `2026-10-03-bora-catalogo-ui.md`, escrito depois deste estar em `main`.

**Tech Stack:** PostgreSQL + RLS, Drizzle, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-bora-catalogo-design.md`

## Global Constraints

- Dinheiro em centavos (`integer`); datas em `timestamptz`; UUID v7 gerado pelo app (`id()` do schema).
- Toda tabela nova tem `tenant_id`, RLS `tenant_isolation` e FKs compostas `(tenant_id, id)` entre tabelas por loja.
- Acesso a dados por loja só via `withTenant` (`src/server/db/tenant.ts`).
- **Nenhuma tabela ou coluna de estoque/quantidade.**
- Arquivar (`active=false`), nunca `DELETE` de produto, categoria, variação ou item de opção.
- Sem `any`; erro de negócio como valor (`{ ok: false, reason }`), nunca exceção.
- Weekday: `0` = domingo … `6` = sábado. Janelas em minutos desde a meia-noite: `opens_min` 0–1439, `closes_min` 1–1440; `closes_min <= opens_min` cruza a meia-noite; `opens_min = closes_min` é inválido.
- Código, comentários e commits em PT-BR normal. Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Baseline antes de cada commit: `npm run typecheck` e `npm test` verdes.

## Review Focus

- Janela que cruza a meia-noite (22:00–02:00): aberta no dia seguinte até 02:00, fechada às 02:00 exatas.
- `product_id` / `category_id` / `group_id` de outra loja: `not_found`, nunca vaza nem cria ligação.
- Editar produto não pode apagar variações (arquivar as omitidas) nem quebrar ids existentes.
- Reordenar com lista incompleta, duplicada ou com id estranho não altera nada.
- Aplicar modelo inicial duas vezes não duplica o catálogo.
- Preço digitado em formatos pt-BR ("12,50", "1.234,50", "R$ 9") vira centavos corretos; lixo vira `null`.

---

### Task 1: Migration, schema Drizzle e isolamento

**Files:**
- Create: `src/server/db/migrations/0005_catalog.sql`
- Modify: `src/server/db/schema.ts` (acrescentar ao fim)
- Modify: `tests/db/schema.test.ts:23-29` (lista de tabelas por loja)
- Test: `tests/catalog/rls.test.ts`

**Interfaces:**
- Produces (Drizzle, exportados de `@/server/db/schema`): `catalogCategories`, `catalogProducts`, `catalogVariants`, `optionGroups`, `optionItems`, `productOptionGroups`, `schedules`, `scheduleWindows`, `categorySchedules`, `productSchedules`. Campos camelCase: `tenantId`, `categoryId`, `productId`, `groupId`, `scheduleId`, `priceCents`, `priceDeltaCents`, `minSelect`, `maxSelect`, `opensMin`, `closesMin`, `pausedUntil`, `imageUrl`, `dietary`, `position`, `active`.

- [ ] **Step 1: Escrever o teste que falha** — `tests/catalog/rls.test.ts`:

```ts
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

let a: string;
let b: string;
let catA: string;
let catB: string;

beforeEach(async () => {
  await resetDb();
  a = await createTenant("loja-a");
  b = await createTenant("loja-b");
  [{ id: catA }] = await adminSql`
    insert into catalog_categories (tenant_id, name) values (${a}, 'Lanches') returning id`;
  [{ id: catB }] = await adminSql`
    insert into catalog_categories (tenant_id, name) values (${b}, 'Bebidas') returning id`;
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("catálogo: RLS e integridade", () => {
  it("cada loja enxerga só as próprias categorias", async () => {
    const rows = await withTenant(a, (tx) => tx.execute(sql`select name from catalog_categories`));
    expect(rows.map((r) => r.name)).toEqual(["Lanches"]);
  });

  it("loja A não insere linha com tenant_id da B", async () => {
    await expect(
      withTenant(a, (tx) =>
        tx.execute(sql`insert into catalog_categories (tenant_id, name) values (${b}, 'x')`),
      ),
    ).rejects.toThrow();
  });

  it("produto da A não pode apontar para categoria da B (FK composta)", async () => {
    await expect(
      adminSql`insert into catalog_products (tenant_id, category_id, name)
               values (${a}, ${catB}, 'Intruso')`,
    ).rejects.toThrow(/foreign key/i);
  });

  it("ligação produto-grupo entre lojas é recusada no banco", async () => {
    const [{ id: prod }] = await adminSql`
      insert into catalog_products (tenant_id, category_id, name) values (${a}, ${catA}, 'X') returning id`;
    const [{ id: grp }] = await adminSql`
      insert into option_groups (tenant_id, name, min_select, max_select) values (${b}, 'G', 0, 1) returning id`;
    await expect(
      adminSql`insert into product_option_groups (tenant_id, product_id, group_id)
               values (${a}, ${prod}, ${grp})`,
    ).rejects.toThrow(/foreign key/i);
  });

  it("checks: janela com abre = fecha, grupo min > max e imagem http são recusados", async () => {
    const [{ id: sch }] = await adminSql`
      insert into schedules (tenant_id, name) values (${a}, 'Almoço') returning id`;
    await expect(
      adminSql`insert into schedule_windows (tenant_id, schedule_id, weekday, opens_min, closes_min)
               values (${a}, ${sch}, 1, 600, 600)`,
    ).rejects.toThrow();
    await expect(
      adminSql`insert into option_groups (tenant_id, name, min_select, max_select)
               values (${a}, 'G', 3, 2)`,
    ).rejects.toThrow();
    await expect(
      adminSql`insert into catalog_products (tenant_id, category_id, name, image_url)
               values (${a}, ${catA}, 'X', 'http://x.com/a.png')`,
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/catalog/rls.test.ts`
Expected: FAIL com `relation "catalog_categories" does not exist`.

- [ ] **Step 3: Criar a migration** — `src/server/db/migrations/0005_catalog.sql`:

```sql
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
```

Nota: o `alter default privileges` da migration 0002 já concede CRUD ao `bora_app` nas tabelas novas.

- [ ] **Step 4: Espelhar no Drizzle** — acrescentar ao fim de `src/server/db/schema.ts`:

```ts
const tenantRef = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" });

// As FKs compostas (tenant_id, id) vivem na migration 0005; aqui só os tipos.
export const catalogCategories = pgTable("catalog_categories", {
  id: id(),
  tenantId: tenantRef(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const catalogProducts = pgTable("catalog_products", {
  id: id(),
  tenantId: tenantRef(),
  categoryId: uuid("category_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  imageUrl: text("image_url"),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  pausedUntil: timestamp("paused_until", { withTimezone: true }),
  dietary: text("dietary").array().notNull().default(sql`'{}'`),
});

export const catalogVariants = pgTable("catalog_variants", {
  id: id(),
  tenantId: tenantRef(),
  productId: uuid("product_id").notNull(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull(),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const optionGroups = pgTable("option_groups", {
  id: id(),
  tenantId: tenantRef(),
  name: text("name").notNull(),
  minSelect: integer("min_select").notNull().default(0),
  maxSelect: integer("max_select").notNull().default(1),
  position: integer("position").notNull().default(0),
});

export const optionItems = pgTable("option_items", {
  id: id(),
  tenantId: tenantRef(),
  groupId: uuid("group_id").notNull(),
  name: text("name").notNull(),
  priceDeltaCents: integer("price_delta_cents").notNull().default(0),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const productOptionGroups = pgTable(
  "product_option_groups",
  {
    tenantId: tenantRef(),
    productId: uuid("product_id").notNull(),
    groupId: uuid("group_id").notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.productId, t.groupId] })],
);

export const schedules = pgTable("schedules", {
  id: id(),
  tenantId: tenantRef(),
  name: text("name").notNull(),
});

export const scheduleWindows = pgTable("schedule_windows", {
  id: id(),
  tenantId: tenantRef(),
  scheduleId: uuid("schedule_id").notNull(),
  weekday: integer("weekday").notNull(),
  opensMin: integer("opens_min").notNull(),
  closesMin: integer("closes_min").notNull(),
});

export const categorySchedules = pgTable(
  "category_schedules",
  {
    tenantId: tenantRef(),
    categoryId: uuid("category_id").notNull(),
    scheduleId: uuid("schedule_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.scheduleId] })],
);

export const productSchedules = pgTable(
  "product_schedules",
  {
    tenantId: tenantRef(),
    productId: uuid("product_id").notNull(),
    scheduleId: uuid("schedule_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.productId, t.scheduleId] })],
);
```

- [ ] **Step 5: Atualizar a lista de tabelas por loja** em `tests/db/schema.test.ts` (o `toEqual([...])` das linhas 23-29) para:

```ts
    expect(perTenant.map((r) => r.name).sort()).toEqual([
      "audit_log",
      "catalog_categories",
      "catalog_products",
      "catalog_variants",
      "category_schedules",
      "customer_profiles",
      "option_groups",
      "option_items",
      "otp_codes",
      "product_option_groups",
      "product_schedules",
      "schedule_windows",
      "schedules",
      "staff_memberships",
      "tenant_settings",
    ]);
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run tests/catalog/rls.test.ts tests/db`
Expected: PASS (o `globalSetup` aplica a 0005 em `bora_test`).

- [ ] **Step 7: Typecheck e commit**

```bash
npm run typecheck
git add src/server/db tests/db tests/catalog
git commit -m "feat(catalog): schema com RLS e FKs compostas por loja"
```

---

### Task 2: Tempo e disponibilidade (funções puras)

**Files:**
- Create: `src/server/catalog/time.ts`, `src/server/catalog/availability.ts`
- Test: `tests/catalog/availability.test.ts`

**Interfaces:**
- Produces (`time.ts`): `localParts(date: Date, tz: string): { year: number; month: number; day: number; weekday: number; minute: number }`; `zonedDate(year: number, month: number, day: number, minutes: number, tz: string): Date`; `startOfNextLocalDay(now: Date, tz: string): Date`.
- Produces (`availability.ts`): `interface Window { weekday: number; opensMin: number; closesMin: number }`; `interface ScheduleRef { windows: Window[] }`; `interface AvailabilityInput { pausedUntil: Date | null; productSchedules: ScheduleRef[]; categorySchedules: ScheduleRef[] }`; `type Availability = { state: "available" } | { state: "paused"; until: Date } | { state: "out_of_hours"; nextOpensAt: Date | null }`; `itemAvailability(item: AvailabilityInput, now: Date, timezone: string): Availability`.

- [ ] **Step 1: Escrever o teste que falha** — `tests/catalog/availability.test.ts`. Referência de instantes (America/Sao_Paulo = UTC−3, sem horário de verão): `2026-10-06` é terça; 18:00 BRT = 21:00Z.

```ts
import { describe, expect, it } from "vitest";
import { itemAvailability, type AvailabilityInput, type Window } from "@/server/catalog/availability";
import { localParts, startOfNextLocalDay, zonedDate } from "@/server/catalog/time";

const SP = "America/Sao_Paulo";
const TUE = 2;
const win = (weekday: number, opensMin: number, closesMin: number): Window => ({ weekday, opensMin, closesMin });
const item = (over: Partial<AvailabilityInput> = {}): AvailabilityInput => ({
  pausedUntil: null,
  productSchedules: [],
  categorySchedules: [],
  ...over,
});
const at = (iso: string) => new Date(iso);

describe("time", () => {
  it("localParts devolve dia da semana e minuto no fuso da loja", () => {
    expect(localParts(at("2026-10-06T21:00:00Z"), SP)).toMatchObject({ weekday: TUE, minute: 18 * 60 });
  });
  it("zonedDate converte relógio de parede em instante", () => {
    expect(zonedDate(2026, 10, 6, 11 * 60, SP).toISOString()).toBe("2026-10-06T14:00:00.000Z");
    expect(zonedDate(2026, 10, 6, 1440, SP).toISOString()).toBe("2026-10-07T03:00:00.000Z");
  });
  it("startOfNextLocalDay é a próxima meia-noite local", () => {
    expect(startOfNextLocalDay(at("2026-10-06T21:00:00Z"), SP).toISOString()).toBe("2026-10-07T03:00:00.000Z");
  });
});

describe("itemAvailability", () => {
  it("sem horários ligados: sempre disponível", () => {
    expect(itemAvailability(item(), at("2026-10-06T21:00:00Z"), SP)).toEqual({ state: "available" });
  });

  it("abre inclusive e fecha exclusivo", () => {
    const lunch = item({ categorySchedules: [{ windows: [win(TUE, 660, 900)] }] });
    expect(itemAvailability(lunch, at("2026-10-06T14:00:00Z"), SP).state).toBe("available"); // 11:00
    expect(itemAvailability(lunch, at("2026-10-06T17:59:00Z"), SP).state).toBe("available"); // 14:59
    expect(itemAvailability(lunch, at("2026-10-06T18:00:00Z"), SP).state).toBe("out_of_hours"); // 15:00
  });

  it("fora do horário informa quando volta", () => {
    const lunch = item({ categorySchedules: [{ windows: [win(TUE, 660, 900)] }] });
    expect(itemAvailability(lunch, at("2026-10-06T13:59:00Z"), SP)).toEqual({
      state: "out_of_hours",
      nextOpensAt: at("2026-10-06T14:00:00Z"),
    });
  });

  it("janela que cruza a meia-noite vale até o dia seguinte", () => {
    const night = item({ categorySchedules: [{ windows: [win(TUE, 1320, 120)] }] }); // ter 22:00–02:00
    expect(itemAvailability(night, at("2026-10-07T02:00:00Z"), SP).state).toBe("available"); // ter 23:00
    expect(itemAvailability(night, at("2026-10-07T04:00:00Z"), SP).state).toBe("available"); // qua 01:00
    expect(itemAvailability(night, at("2026-10-07T05:00:00Z"), SP).state).toBe("out_of_hours"); // qua 02:00
    expect(itemAvailability(night, at("2026-10-07T00:59:00Z"), SP)).toEqual({
      state: "out_of_hours",
      nextOpensAt: at("2026-10-07T01:00:00Z"), // ter 22:00
    });
  });

  it("24h (0..1440) está sempre aberto no dia", () => {
    const all = item({ categorySchedules: [{ windows: [win(TUE, 0, 1440)] }] });
    expect(itemAvailability(all, at("2026-10-07T02:59:00Z"), SP).state).toBe("available"); // ter 23:59
  });

  it("horário do produto substitui o da categoria", () => {
    const openNow = { windows: [win(TUE, 0, 1440)] };
    const closedNow = { windows: [win(TUE, 0, 60)] };
    const i = item({ categorySchedules: [openNow], productSchedules: [closedNow] });
    expect(itemAvailability(i, at("2026-10-06T21:00:00Z"), SP).state).toBe("out_of_hours");
  });

  it("vários horários: basta um aberto; o retorno é o mais próximo", () => {
    const i = item({
      productSchedules: [
        { windows: [win(TUE, 1200, 1320)] }, // 20:00
        { windows: [win(TUE, 1140, 1200)] }, // 19:00
      ],
    });
    expect(itemAvailability(i, at("2026-10-06T21:00:00Z"), SP)).toEqual({
      state: "out_of_hours",
      nextOpensAt: at("2026-10-06T22:00:00Z"), // 19:00
    });
    expect(itemAvailability(i, at("2026-10-06T22:30:00Z"), SP).state).toBe("available"); // 19:30
  });

  it("volta na semana seguinte quando a janela é de outro dia", () => {
    const mon = item({ categorySchedules: [{ windows: [win(1, 600, 720)] }] });
    expect(itemAvailability(mon, at("2026-10-06T21:00:00Z"), SP)).toEqual({
      state: "out_of_hours",
      nextOpensAt: at("2026-10-12T13:00:00Z"), // seg 12/10 10:00 BRT
    });
  });

  it("horário sem janelas: fechado e sem retorno", () => {
    expect(itemAvailability(item({ productSchedules: [{ windows: [] }] }), at("2026-10-06T21:00:00Z"), SP)).toEqual({
      state: "out_of_hours",
      nextOpensAt: null,
    });
  });

  it("pausa vence o horário; pausa vencida é ignorada", () => {
    const until = at("2026-10-07T03:00:00Z");
    const now = at("2026-10-06T21:00:00Z");
    expect(itemAvailability(item({ pausedUntil: until }), now, SP)).toEqual({ state: "paused", until });
    expect(itemAvailability(item({ pausedUntil: at("2026-10-06T20:00:00Z") }), now, SP).state).toBe("available");
  });

  it("usa o fuso da loja, não o do servidor (Tóquio)", () => {
    const wed = item({ categorySchedules: [{ windows: [win(3, 540, 720)] }] }); // qua 09:00–12:00 JST
    expect(itemAvailability(wed, at("2026-10-06T21:00:00Z"), "Asia/Tokyo")).toEqual({
      state: "out_of_hours", // qua 06:00 JST
      nextOpensAt: at("2026-10-07T00:00:00Z"),
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/catalog/availability.test.ts`
Expected: FAIL com `Failed to resolve import "@/server/catalog/availability"`.

- [ ] **Step 3: Implementar `time.ts`**

```ts
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  /** Minutos desde a meia-noite local. */
  minute: number;
}

export function localParts(date: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
    minute: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
}

/** Relógio de parede (data local + minutos) no fuso `tz` → instante. `day` e `minutes` podem estourar. */
export function zonedDate(year: number, month: number, day: number, minutes: number, tz: string): Date {
  const naive = Date.UTC(year, month - 1, day, 0, minutes);
  let guess = naive;
  // Duas passadas corrigem o deslocamento do fuso, inclusive em virada de horário de verão.
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz);
    guess += naive - Date.UTC(p.year, p.month - 1, p.day, 0, p.minute);
  }
  return new Date(guess);
}

export function startOfNextLocalDay(now: Date, tz: string): Date {
  const p = localParts(now, tz);
  return zonedDate(p.year, p.month, p.day + 1, 0, tz);
}
```

- [ ] **Step 4: Implementar `availability.ts`**

```ts
import { localParts, zonedDate } from "./time";

export interface Window {
  weekday: number;
  opensMin: number;
  closesMin: number;
}
export interface ScheduleRef {
  windows: Window[];
}
export interface AvailabilityInput {
  pausedUntil: Date | null;
  productSchedules: ScheduleRef[];
  categorySchedules: ScheduleRef[];
}
export type Availability =
  | { state: "available" }
  | { state: "paused"; until: Date }
  | { state: "out_of_hours"; nextOpensAt: Date | null };

function windowOpen(w: Window, weekday: number, minute: number): boolean {
  if (w.closesMin > w.opensMin) {
    return w.weekday === weekday && minute >= w.opensMin && minute < w.closesMin;
  }
  // Cruza a meia-noite: parte no próprio dia, resto no dia seguinte.
  return (
    (w.weekday === weekday && minute >= w.opensMin) ||
    ((w.weekday + 1) % 7 === weekday && minute < w.closesMin)
  );
}

function nextOpening(windows: Window[], now: Date, tz: string): Date | null {
  const p = localParts(now, tz);
  let best: Date | null = null;
  for (let offset = 0; offset <= 7; offset++) {
    const weekday = (p.weekday + offset) % 7;
    for (const w of windows) {
      if (w.weekday !== weekday) continue;
      const candidate = zonedDate(p.year, p.month, p.day + offset, w.opensMin, tz);
      if (candidate > now && (best === null || candidate < best)) best = candidate;
    }
  }
  return best;
}

export function itemAvailability(item: AvailabilityInput, now: Date, timezone: string): Availability {
  if (item.pausedUntil && item.pausedUntil > now) return { state: "paused", until: item.pausedUntil };

  const effective = item.productSchedules.length > 0 ? item.productSchedules : item.categorySchedules;
  if (effective.length === 0) return { state: "available" };

  const windows = effective.flatMap((s) => s.windows);
  const p = localParts(now, timezone);
  if (windows.some((w) => windowOpen(w, p.weekday, p.minute))) return { state: "available" };
  return { state: "out_of_hours", nextOpensAt: nextOpening(windows, now, timezone) };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/catalog/availability.test.ts`
Expected: PASS (13 testes). Se `zonedDate` falhar em algum caso de fuso, depure com `systematic-debugging`; não ajuste o teste.

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add src/server/catalog tests/catalog/availability.test.ts
git commit -m "feat(catalog): disponibilidade por horário e pausa (funções puras)"
```

---

### Task 3: Dinheiro e schemas de entrada

**Files:**
- Create: `src/lib/money.ts`, `src/server/catalog/schemas.ts`
- Test: `tests/catalog/money.test.ts`, `tests/catalog/schemas.test.ts`

**Interfaces:**
- Produces (`money.ts`): `MAX_CENTS = 99_999_999`; `parseBRL(raw: string): number | null`; `formatBRL(cents: number): string`.
- Produces (`schemas.ts`): `DIETARY` (tupla `as const`), `type Dietary`; Zod `categoryInputSchema`, `productInputSchema`, `optionGroupInputSchema`, `scheduleInputSchema`; tipos `CategoryInput`, `ProductInput`, `OptionGroupInput`, `ScheduleInput`. Formas:
  - `ProductInput = { categoryId: string; name: string; description: string; imageUrl: string | null; dietary: Dietary[]; variants: { id?: string; name: string; priceCents: number }[]; optionGroupIds: string[]; scheduleIds: string[] }`
  - `OptionGroupInput = { name: string; minSelect: number; maxSelect: number; items: { id?: string; name: string; priceDeltaCents: number }[] }`
  - `ScheduleInput = { name: string; windows: { weekday: number; opensMin: number; closesMin: number }[] }`
  - `CategoryInput = { name: string; scheduleIds: string[] }`

- [ ] **Step 1: Teste que falha** — `tests/catalog/money.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatBRL, parseBRL } from "@/lib/money";

describe("parseBRL", () => {
  it.each([
    ["12,50", 1250],
    ["12,5", 1250],
    ["12.50", 1250],
    ["1.234,50", 123450],
    ["1.234", 123400],
    ["R$ 9", 900],
    ["  0 ", 0],
    ["0,99", 99],
  ])("%j → %i", (raw, cents) => expect(parseBRL(raw)).toBe(cents));

  it.each(["", "abc", "12,505", "1,2,3", "-5", "1.2.3", "999999999"])("%j → null", (raw) =>
    expect(parseBRL(raw)).toBeNull(),
  );
});

describe("formatBRL", () => {
  it("formata em reais", () => {
    expect(formatBRL(1250).replace(/\s/g, " ")).toBe("R$ 12,50");
  });
});
```

`tests/catalog/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  optionGroupInputSchema,
  productInputSchema,
  scheduleInputSchema,
} from "@/server/catalog/schemas";

const UUID = "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b";
const product = (over: Record<string, unknown> = {}) => ({
  categoryId: UUID,
  name: "Açaí",
  description: "",
  imageUrl: null,
  dietary: [],
  variants: [{ name: "300ml", priceCents: 1500 }],
  optionGroupIds: [],
  scheduleIds: [],
  ...over,
});

describe("productInputSchema", () => {
  it("aceita produto mínimo", () => {
    expect(productInputSchema.safeParse(product()).success).toBe(true);
  });
  it.each([
    ["sem variação", { variants: [] }],
    ["preço negativo", { variants: [{ name: "x", priceCents: -1 }] }],
    ["preço fracionado", { variants: [{ name: "x", priceCents: 1.5 }] }],
    ["imagem http", { imageUrl: "http://x.com/a.png" }],
    ["imagem javascript:", { imageUrl: "javascript:alert(1)" }],
    ["etiqueta fora da lista", { dietary: ["keto"] }],
    ["etiqueta repetida", { dietary: ["vegan", "vegan"] }],
    ["nome vazio", { name: "   " }],
    ["grupos repetidos", { optionGroupIds: [UUID, UUID] }],
    ["id inválido", { categoryId: "abc" }],
  ])("recusa %s", (_label, over) => {
    expect(productInputSchema.safeParse(product(over)).success).toBe(false);
  });
  it("aceita imagem https", () => {
    expect(productInputSchema.safeParse(product({ imageUrl: "https://x.com/a.png" })).success).toBe(true);
  });
});

describe("optionGroupInputSchema", () => {
  const group = (over: Record<string, unknown> = {}) => ({
    name: "Adicionais",
    minSelect: 0,
    maxSelect: 2,
    items: [
      { name: "Granola", priceDeltaCents: 200 },
      { name: "Leite em pó", priceDeltaCents: 200 },
    ],
    ...over,
  });
  it("aceita grupo válido", () => {
    expect(optionGroupInputSchema.safeParse(group()).success).toBe(true);
  });
  it.each([
    ["min > max", { minSelect: 3, maxSelect: 2 }],
    ["max maior que o número de itens", { maxSelect: 3 }],
    ["min maior que o número de itens", { minSelect: 3, maxSelect: 3 }],
    ["sem itens", { items: [] }],
    ["acréscimo negativo", { items: [{ name: "x", priceDeltaCents: -1 }] }],
  ])("recusa %s", (_label, over) => {
    expect(optionGroupInputSchema.safeParse(group(over)).success).toBe(false);
  });
});

describe("scheduleInputSchema", () => {
  const sched = (windows: unknown[]) => ({ name: "Almoço", windows });
  it("aceita janela normal e janela que cruza a meia-noite", () => {
    expect(scheduleInputSchema.safeParse(sched([{ weekday: 1, opensMin: 660, closesMin: 900 }])).success).toBe(true);
    expect(scheduleInputSchema.safeParse(sched([{ weekday: 1, opensMin: 1320, closesMin: 120 }])).success).toBe(true);
  });
  it.each([
    ["abre = fecha", [{ weekday: 1, opensMin: 600, closesMin: 600 }]],
    ["dia 7", [{ weekday: 7, opensMin: 600, closesMin: 700 }]],
    ["abre em 1440", [{ weekday: 1, opensMin: 1440, closesMin: 700 }]],
    ["fecha em 0", [{ weekday: 1, opensMin: 600, closesMin: 0 }]],
    ["sem janelas", []],
  ])("recusa %s", (_label, windows) => {
    expect(scheduleInputSchema.safeParse(sched(windows)).success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/catalog/money.test.ts tests/catalog/schemas.test.ts`
Expected: FAIL (imports inexistentes).

- [ ] **Step 3: Implementar `src/lib/money.ts`**

```ts
export const MAX_CENTS = 99_999_999;

/** "12,50", "1.234,50", "R$ 9", "12.50" → centavos; entrada inválida → null. */
export function parseBRL(raw: string): number | null {
  const s = raw.replace(/R\$|\s/g, "");
  if (s === "") return null;
  let normalized: string;
  if (s.includes(",")) {
    if (!/^(\d{1,3}(\.\d{3})+|\d+),\d{1,2}$/.test(s)) return null;
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+(\.\d{1,2})?$/.test(s)) {
    normalized = s;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    normalized = s.replace(/\./g, "");
  } else {
    return null;
  }
  const [int, dec = ""] = normalized.split(".");
  const cents = Number(int) * 100 + Number(dec.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
}

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
```

- [ ] **Step 4: Implementar `src/server/catalog/schemas.ts`**

```ts
import { z } from "zod";
import { MAX_CENTS } from "@/lib/money";

export const DIETARY = [
  "vegan",
  "vegetarian",
  "gluten_free",
  "lactose_free",
  "contains_peanut",
  "contains_nuts",
  "contains_egg",
  "contains_shellfish",
  "spicy",
] as const;
export type Dietary = (typeof DIETARY)[number];

const uuid = z.string().uuid();
const uniqueUuids = (max: number) =>
  z
    .array(uuid)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, "ids repetidos");
const name = (max: number) => z.string().trim().min(1).max(max);
const cents = z.number().int().min(0).max(MAX_CENTS);

export const categoryInputSchema = z.object({
  name: name(80),
  scheduleIds: uniqueUuids(10).default([]),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

const httpsUrl = z
  .string()
  .max(500)
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "só https");

export const productInputSchema = z.object({
  categoryId: uuid,
  name: name(120),
  description: z.string().trim().max(500).default(""),
  imageUrl: httpsUrl.nullable().default(null),
  dietary: z
    .array(z.enum(DIETARY))
    .max(DIETARY.length)
    .refine((d) => new Set(d).size === d.length, "etiquetas repetidas")
    .default([]),
  variants: z
    .array(z.object({ id: uuid.optional(), name: name(60), priceCents: cents }))
    .min(1)
    .max(20),
  optionGroupIds: uniqueUuids(20).default([]),
  scheduleIds: uniqueUuids(10).default([]),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const optionGroupInputSchema = z
  .object({
    name: name(80),
    minSelect: z.number().int().min(0),
    maxSelect: z.number().int().min(1),
    items: z
      .array(z.object({ id: uuid.optional(), name: name(80), priceDeltaCents: cents }))
      .min(1)
      .max(50),
  })
  .refine((g) => g.minSelect <= g.maxSelect, { message: "mínimo maior que o máximo" })
  .refine((g) => g.maxSelect <= g.items.length, { message: "máximo maior que o número de itens" });
export type OptionGroupInput = z.infer<typeof optionGroupInputSchema>;

export const scheduleInputSchema = z.object({
  name: name(80),
  windows: z
    .array(
      z
        .object({
          weekday: z.number().int().min(0).max(6),
          opensMin: z.number().int().min(0).max(1439),
          closesMin: z.number().int().min(1).max(1440),
        })
        .refine((w) => w.opensMin !== w.closesMin, { message: "abre e fecha no mesmo minuto" }),
    )
    .min(1)
    .max(28),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/catalog/money.test.ts tests/catalog/schemas.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck
git add src/lib/money.ts src/server/catalog/schemas.ts tests/catalog/money.test.ts tests/catalog/schemas.test.ts
git commit -m "feat(catalog): parseBRL e schemas de entrada"
```

---

### Task 4: Consultas (vitrine e painel)

**Files:**
- Create: `src/server/catalog/queries.ts`
- Test: `tests/catalog/menu.test.ts` (puro), `tests/catalog/queries.test.ts` (banco)

**Interfaces:**
- Consumes: `itemAvailability`, `Availability`, `Window` (Task 2); tabelas Drizzle (Task 1); `withTenant`.
- Produces:
  - `interface RawCatalog` (linhas cruas camelCase, ver código) e `loadCatalog(tx: Tx): Promise<RawCatalog>`.
  - `interface MenuProduct { id; categoryId; name; description; imageUrl: string | null; dietary: string[]; variants: { id; name; priceCents }[]; fromPriceCents: number; multiplePrices: boolean; optionGroups: MenuOptionGroup[]; availability: Availability }`, `interface MenuOptionGroup { id; name; minSelect; maxSelect; items: { id; name; priceDeltaCents }[] }`, `interface MenuCategory { id; name; products: MenuProduct[] }`.
  - `buildMenu(raw: RawCatalog, now: Date, tz: string, opts?: { dietary?: string }): MenuCategory[]`
  - `listMenu(tenantId: string, now: Date, tz: string, opts?: { dietary?: string }): Promise<MenuCategory[]>`
  - `getMenuProduct(tenantId, productId, now, tz): Promise<(MenuProduct & { categoryName: string }) | null>`
  - `interface PanelProduct extends MenuProduct { active: boolean; pausedUntil: Date | null; optionGroupIds: string[]; scheduleIds: string[] }`, `interface PanelCategory { id; name; active: boolean; scheduleIds: string[]; products: PanelProduct[] }`, `interface PanelGroup { id; name; minSelect; maxSelect; items: { id; name; priceDeltaCents }[] }`, `interface PanelSchedule { id; name; windows: Window[] }`
  - `buildPanel(raw, now, tz): { categories: PanelCategory[]; groups: PanelGroup[]; schedules: PanelSchedule[] }`, `listForPanel(tenantId, now, tz)`.

- [ ] **Step 1: Teste puro que falha** — `tests/catalog/menu.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildMenu, buildPanel, type RawCatalog } from "@/server/catalog/queries";

const NOW = new Date("2026-10-06T21:00:00Z"); // ter 18:00 BRT
const SP = "America/Sao_Paulo";

const raw = (over: Partial<RawCatalog> = {}): RawCatalog => ({
  categories: [{ id: "c1", name: "Lanches", position: 0, active: true }],
  products: [
    {
      id: "p1", categoryId: "c1", name: "X-Burger", description: "", imageUrl: null,
      position: 0, active: true, pausedUntil: null, dietary: ["spicy"],
    },
  ],
  variants: [
    { id: "v2", productId: "p1", name: "Duplo", priceCents: 2800, position: 1, active: true },
    { id: "v1", productId: "p1", name: "Simples", priceCents: 1800, position: 0, active: true },
    { id: "v3", productId: "p1", name: "Antigo", priceCents: 100, position: 2, active: false },
  ],
  groups: [{ id: "g1", name: "Ponto", minSelect: 1, maxSelect: 1, position: 0 }],
  items: [
    { id: "i1", groupId: "g1", name: "Mal passado", priceDeltaCents: 0, position: 0, active: true },
    { id: "i2", groupId: "g1", name: "Removido", priceDeltaCents: 0, position: 1, active: false },
  ],
  productGroups: [{ productId: "p1", groupId: "g1", position: 0 }],
  schedules: [],
  windows: [],
  categorySchedules: [],
  productSchedules: [],
  ...over,
});

describe("buildMenu", () => {
  it("monta o produto com variações ativas ordenadas, preço inicial e opções", () => {
    const [cat] = buildMenu(raw(), NOW, SP);
    const p = cat.products[0];
    expect(p.variants.map((v) => v.name)).toEqual(["Simples", "Duplo"]);
    expect(p.fromPriceCents).toBe(1800);
    expect(p.multiplePrices).toBe(true);
    expect(p.optionGroups[0].items.map((i) => i.name)).toEqual(["Mal passado"]);
    expect(p.availability).toEqual({ state: "available" });
  });

  it("exclui produto arquivado, categoria arquivada e categoria sem produto visível", () => {
    expect(buildMenu(raw({ products: [{ ...raw().products[0], active: false }] }), NOW, SP)).toEqual([]);
    expect(buildMenu(raw({ categories: [{ ...raw().categories[0], active: false }] }), NOW, SP)).toEqual([]);
  });

  it("herda horário da categoria e produto sobrepõe", () => {
    const base = raw({
      schedules: [{ id: "s1", name: "Madrugada" }],
      windows: [{ scheduleId: "s1", weekday: 2, opensMin: 0, closesMin: 60 }],
      categorySchedules: [{ categoryId: "c1", scheduleId: "s1" }],
    });
    expect(buildMenu(base, NOW, SP)[0].products[0].availability.state).toBe("out_of_hours");
    const overridden = {
      ...base,
      schedules: [...base.schedules, { id: "s2", name: "Dia todo" }],
      windows: [...base.windows, { scheduleId: "s2", weekday: 2, opensMin: 0, closesMin: 1440 }],
      productSchedules: [{ productId: "p1", scheduleId: "s2" }],
    };
    expect(buildMenu(overridden, NOW, SP)[0].products[0].availability.state).toBe("available");
  });

  it("pausa aparece como paused", () => {
    const until = new Date("2026-10-07T03:00:00Z");
    const menu = buildMenu(raw({ products: [{ ...raw().products[0], pausedUntil: until }] }), NOW, SP);
    expect(menu[0].products[0].availability).toEqual({ state: "paused", until });
  });

  it("filtra por etiqueta dietética", () => {
    expect(buildMenu(raw(), NOW, SP, { dietary: "vegan" })).toEqual([]);
    expect(buildMenu(raw(), NOW, SP, { dietary: "spicy" })).toHaveLength(1);
  });
});

describe("buildPanel", () => {
  it("inclui arquivados com flags e ids de ligação", () => {
    const panel = buildPanel(
      raw({ products: [{ ...raw().products[0], active: false }] }),
      NOW,
      SP,
    );
    const p = panel.categories[0].products[0];
    expect(p.active).toBe(false);
    expect(p.optionGroupIds).toEqual(["g1"]);
    expect(panel.groups[0].items.map((i) => i.name)).toEqual(["Mal passado"]);
  });
});
```

`tests/catalog/queries.test.ts` (banco; usa `adminSql` para semear e `listMenu` para ler):

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { getMenuProduct, listForPanel, listMenu } from "@/server/catalog/queries";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

const NOW = new Date("2026-10-06T21:00:00Z");
const SP = "America/Sao_Paulo";
let a: string;
let b: string;
let prodA: string;

beforeEach(async () => {
  await resetDb();
  a = await createTenant("loja-a");
  b = await createTenant("loja-b");
  for (const [t, cat, prod] of [
    [a, "Lanches", "X-Burger"],
    [b, "Bebidas", "Suco"],
  ] as const) {
    const [{ id: c }] = await adminSql`insert into catalog_categories (tenant_id, name) values (${t}, ${cat}) returning id`;
    const [{ id: p }] = await adminSql`insert into catalog_products (tenant_id, category_id, name) values (${t}, ${c}, ${prod}) returning id`;
    await adminSql`insert into catalog_variants (tenant_id, product_id, name, price_cents) values (${t}, ${p}, 'Único', 1500)`;
    if (t === a) prodA = p as string;
  }
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("consultas por loja", () => {
  it("listMenu devolve só a loja pedida", async () => {
    const menu = await listMenu(a, NOW, SP);
    expect(menu.map((c) => c.name)).toEqual(["Lanches"]);
    expect(menu[0].products[0].variants[0].priceCents).toBe(1500);
  });

  it("getMenuProduct não enxerga produto de outra loja", async () => {
    expect(await getMenuProduct(a, prodA, NOW, SP)).not.toBeNull();
    expect(await getMenuProduct(b, prodA, NOW, SP)).toBeNull();
  });

  it("listForPanel inclui arquivados", async () => {
    await adminSql`update catalog_products set active = false where id = ${prodA}`;
    const panel = await listForPanel(a, NOW, SP);
    expect(panel.categories[0].products[0].active).toBe(false);
    expect((await listMenu(a, NOW, SP))).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/catalog/menu.test.ts tests/catalog/queries.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/server/catalog/queries.ts`**

```ts
import { itemAvailability, type Availability, type ScheduleRef, type Window } from "./availability";
import type { Tx } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import {
  catalogCategories,
  catalogProducts,
  catalogVariants,
  categorySchedules,
  optionGroups,
  optionItems,
  productOptionGroups,
  productSchedules,
  scheduleWindows,
  schedules,
} from "@/server/db/schema";

export interface RawCatalog {
  categories: { id: string; name: string; position: number; active: boolean }[];
  products: {
    id: string; categoryId: string; name: string; description: string; imageUrl: string | null;
    position: number; active: boolean; pausedUntil: Date | null; dietary: string[];
  }[];
  variants: { id: string; productId: string; name: string; priceCents: number; position: number; active: boolean }[];
  groups: { id: string; name: string; minSelect: number; maxSelect: number; position: number }[];
  items: { id: string; groupId: string; name: string; priceDeltaCents: number; position: number; active: boolean }[];
  productGroups: { productId: string; groupId: string; position: number }[];
  schedules: { id: string; name: string }[];
  windows: { scheduleId: string; weekday: number; opensMin: number; closesMin: number }[];
  categorySchedules: { categoryId: string; scheduleId: string }[];
  productSchedules: { productId: string; scheduleId: string }[];
}

export async function loadCatalog(tx: Tx): Promise<RawCatalog> {
  const [categories, products, variants, groups, items, productGroups, scheds, windows, catScheds, prodScheds] =
    await Promise.all([
      tx.select({ id: catalogCategories.id, name: catalogCategories.name, position: catalogCategories.position, active: catalogCategories.active }).from(catalogCategories),
      tx.select({
        id: catalogProducts.id, categoryId: catalogProducts.categoryId, name: catalogProducts.name,
        description: catalogProducts.description, imageUrl: catalogProducts.imageUrl,
        position: catalogProducts.position, active: catalogProducts.active,
        pausedUntil: catalogProducts.pausedUntil, dietary: catalogProducts.dietary,
      }).from(catalogProducts),
      tx.select({ id: catalogVariants.id, productId: catalogVariants.productId, name: catalogVariants.name, priceCents: catalogVariants.priceCents, position: catalogVariants.position, active: catalogVariants.active }).from(catalogVariants),
      tx.select({ id: optionGroups.id, name: optionGroups.name, minSelect: optionGroups.minSelect, maxSelect: optionGroups.maxSelect, position: optionGroups.position }).from(optionGroups),
      tx.select({ id: optionItems.id, groupId: optionItems.groupId, name: optionItems.name, priceDeltaCents: optionItems.priceDeltaCents, position: optionItems.position, active: optionItems.active }).from(optionItems),
      tx.select({ productId: productOptionGroups.productId, groupId: productOptionGroups.groupId, position: productOptionGroups.position }).from(productOptionGroups),
      tx.select({ id: schedules.id, name: schedules.name }).from(schedules),
      tx.select({ scheduleId: scheduleWindows.scheduleId, weekday: scheduleWindows.weekday, opensMin: scheduleWindows.opensMin, closesMin: scheduleWindows.closesMin }).from(scheduleWindows),
      tx.select({ categoryId: categorySchedules.categoryId, scheduleId: categorySchedules.scheduleId }).from(categorySchedules),
      tx.select({ productId: productSchedules.productId, scheduleId: productSchedules.scheduleId }).from(productSchedules),
    ]);
  return {
    categories, products, variants, groups, items, productGroups,
    schedules: scheds, windows, categorySchedules: catScheds, productSchedules: prodScheds,
  };
}

export interface MenuOptionGroup {
  id: string; name: string; minSelect: number; maxSelect: number;
  items: { id: string; name: string; priceDeltaCents: number }[];
}
export interface MenuProduct {
  id: string; categoryId: string; name: string; description: string; imageUrl: string | null;
  dietary: string[];
  variants: { id: string; name: string; priceCents: number }[];
  fromPriceCents: number;
  multiplePrices: boolean;
  optionGroups: MenuOptionGroup[];
  availability: Availability;
}
export interface MenuCategory { id: string; name: string; products: MenuProduct[] }

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

function indexSchedules(raw: RawCatalog): Map<string, ScheduleRef> {
  const byId = new Map<string, Window[]>();
  for (const s of raw.schedules) byId.set(s.id, []);
  for (const w of raw.windows) {
    byId.get(w.scheduleId)?.push({ weekday: w.weekday, opensMin: w.opensMin, closesMin: w.closesMin });
  }
  return new Map([...byId].map(([id, windows]) => [id, { windows }]));
}

function refs(ids: string[], index: Map<string, ScheduleRef>): ScheduleRef[] {
  return ids.flatMap((id) => {
    const ref = index.get(id);
    return ref ? [ref] : [];
  });
}

function groupsFor(raw: RawCatalog, productId: string): MenuOptionGroup[] {
  return raw.productGroups
    .filter((pg) => pg.productId === productId)
    .sort(byPosition)
    .flatMap((pg) => {
      const g = raw.groups.find((x) => x.id === pg.groupId);
      if (!g) return [];
      return [{
        id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect,
        items: raw.items.filter((i) => i.groupId === g.id && i.active).sort(byPosition)
          .map((i) => ({ id: i.id, name: i.name, priceDeltaCents: i.priceDeltaCents })),
      }];
    });
}

function toMenuProduct(raw: RawCatalog, p: RawCatalog["products"][number], now: Date, tz: string, idx: Map<string, ScheduleRef>): MenuProduct | null {
  const variants = raw.variants.filter((v) => v.productId === p.id && v.active).sort(byPosition)
    .map((v) => ({ id: v.id, name: v.name, priceCents: v.priceCents }));
  if (variants.length === 0) return null;
  const prices = variants.map((v) => v.priceCents);
  const catIds = raw.categorySchedules.filter((c) => c.categoryId === p.categoryId).map((c) => c.scheduleId);
  const prodIds = raw.productSchedules.filter((s) => s.productId === p.id).map((s) => s.scheduleId);
  return {
    id: p.id, categoryId: p.categoryId, name: p.name, description: p.description, imageUrl: p.imageUrl,
    dietary: p.dietary, variants,
    fromPriceCents: Math.min(...prices),
    multiplePrices: new Set(prices).size > 1,
    optionGroups: groupsFor(raw, p.id),
    availability: itemAvailability(
      { pausedUntil: p.pausedUntil, productSchedules: refs(prodIds, idx), categorySchedules: refs(catIds, idx) },
      now, tz,
    ),
  };
}

export function buildMenu(raw: RawCatalog, now: Date, tz: string, opts: { dietary?: string } = {}): MenuCategory[] {
  const idx = indexSchedules(raw);
  return raw.categories.filter((c) => c.active).sort(byPosition).flatMap((c) => {
    const products = raw.products
      .filter((p) => p.categoryId === c.id && p.active && (!opts.dietary || p.dietary.includes(opts.dietary)))
      .sort(byPosition)
      .flatMap((p) => {
        const m = toMenuProduct(raw, p, now, tz, idx);
        return m ? [m] : [];
      });
    return products.length > 0 ? [{ id: c.id, name: c.name, products }] : [];
  });
}

export async function listMenu(tenantId: string, now: Date, tz: string, opts: { dietary?: string } = {}): Promise<MenuCategory[]> {
  return buildMenu(await withTenant(tenantId, loadCatalog), now, tz, opts);
}

export async function getMenuProduct(tenantId: string, productId: string, now: Date, tz: string): Promise<(MenuProduct & { categoryName: string }) | null> {
  for (const c of await listMenu(tenantId, now, tz)) {
    const p = c.products.find((x) => x.id === productId);
    if (p) return { ...p, categoryName: c.name };
  }
  return null;
}

export interface PanelProduct extends MenuProduct {
  active: boolean; pausedUntil: Date | null; optionGroupIds: string[]; scheduleIds: string[];
}
export interface PanelCategory { id: string; name: string; active: boolean; scheduleIds: string[]; products: PanelProduct[] }
export interface PanelGroup { id: string; name: string; minSelect: number; maxSelect: number; items: { id: string; name: string; priceDeltaCents: number }[] }
export interface PanelSchedule { id: string; name: string; windows: Window[] }

export function buildPanel(raw: RawCatalog, now: Date, tz: string): { categories: PanelCategory[]; groups: PanelGroup[]; schedules: PanelSchedule[] } {
  const idx = indexSchedules(raw);
  const categories = raw.categories.slice().sort(byPosition).map((c) => ({
    id: c.id, name: c.name, active: c.active,
    scheduleIds: raw.categorySchedules.filter((x) => x.categoryId === c.id).map((x) => x.scheduleId),
    products: raw.products.filter((p) => p.categoryId === c.id).sort(byPosition).flatMap((p) => {
      const m = toMenuProduct(raw, p, now, tz, idx);
      if (!m) return [];
      return [{
        ...m, active: p.active, pausedUntil: p.pausedUntil,
        optionGroupIds: raw.productGroups.filter((g) => g.productId === p.id).sort(byPosition).map((g) => g.groupId),
        scheduleIds: raw.productSchedules.filter((s) => s.productId === p.id).map((s) => s.scheduleId),
      }];
    }),
  }));
  const groups = raw.groups.slice().sort(byPosition).map((g) => ({
    id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect,
    items: raw.items.filter((i) => i.groupId === g.id && i.active).sort(byPosition)
      .map((i) => ({ id: i.id, name: i.name, priceDeltaCents: i.priceDeltaCents })),
  }));
  const scheds = raw.schedules.map((s) => ({ id: s.id, name: s.name, windows: idx.get(s.id)?.windows ?? [] }));
  return { categories, groups, schedules: scheds };
}

export async function listForPanel(tenantId: string, now: Date, tz: string) {
  return buildPanel(await withTenant(tenantId, loadCatalog), now, tz);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/catalog/menu.test.ts tests/catalog/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/server/catalog/queries.ts tests/catalog/menu.test.ts tests/catalog/queries.test.ts
git commit -m "feat(catalog): consultas de vitrine e painel"
```

---

### Task 5: Escritas — categorias, produtos, pausa e reordenação

**Files:**
- Create: `src/server/catalog/writers.ts`, `src/server/catalog/commands.ts`
- Test: `tests/catalog/commands.test.ts`

**Interfaces:**
- Consumes: schemas (Task 3), tabelas (Task 1), `withTenant`, `writeAudit` (`@/server/audit`), `startOfNextLocalDay` (Task 2, usado só pela UI), `listForPanel` (testes).
- Produces (`writers.ts`, nível `tx`, sem auth nem auditoria): `insertCategory(tx, tenantId, input: CategoryInput): Promise<string>`; `insertProduct(tx, tenantId, input: ProductInput): Promise<string>`; `syncProductChildren(tx, tenantId, productId, input: ProductInput): Promise<boolean>` (`false` se um `variant.id` não pertencer ao produto); `countExisting(tx, table, ids): Promise<number>`.
- Produces (`commands.ts`): `interface Ctx { tenantId: string; actor: string }`; `type Result = { ok: true; id: string } | { ok: false; reason: "not_found" | "invalid" }`; `createCategory(ctx, raw: unknown)`, `updateCategory(ctx, id, raw: unknown)`, `setCategoryActive(ctx, id, active: boolean)`, `createProduct(ctx, raw: unknown)`, `updateProduct(ctx, id, raw: unknown)`, `setProductActive(ctx, id, active)`, `pauseProduct(ctx, id, until: Date | null)`, `reorderCategories(ctx, ids: string[])`, `reorderProducts(ctx, categoryId, ids: string[])` — todas `Promise<Result>`.
- Ações de auditoria gravadas: `catalog.category.create|update|archive|restore|reorder`, `catalog.product.create|update|archive|restore|pause|resume|reorder`, com `resource` = id.

- [ ] **Step 1: Teste que falha** — `tests/catalog/commands.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import {
  createCategory, createProduct, pauseProduct, reorderCategories, reorderProducts,
  setCategoryActive, setProductActive, updateProduct, type Ctx,
} from "@/server/catalog/commands";
import { listForPanel, listMenu } from "@/server/catalog/queries";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

const NOW = new Date("2026-10-06T21:00:00Z");
const SP = "America/Sao_Paulo";
let a: Ctx;
let b: Ctx;

const mustId = (r: { ok: boolean; id?: string }) => {
  if (!r.ok || !r.id) throw new Error("esperava ok");
  return r.id;
};
const prodInput = (categoryId: string, over: Record<string, unknown> = {}) => ({
  categoryId, name: "X-Burger",
  variants: [{ name: "Simples", priceCents: 1800 }, { name: "Duplo", priceCents: 2800 }],
  ...over,
});

beforeEach(async () => {
  await resetDb();
  a = { tenantId: await createTenant("loja-a"), actor: "staff:a" };
  b = { tenantId: await createTenant("loja-b"), actor: "staff:b" };
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("categorias e produtos", () => {
  it("cria categoria e produto e o painel enxerga", async () => {
    const cat = mustId(await createCategory(a, { name: "Lanches" }));
    mustId(await createProduct(a, prodInput(cat)));
    const panel = await listForPanel(a.tenantId, NOW, SP);
    expect(panel.categories[0].products[0].variants.map((v) => v.priceCents)).toEqual([1800, 2800]);
  });

  it("entrada inválida: invalid; categoria de outra loja: not_found", async () => {
    const catB = mustId(await createCategory(b, { name: "Bebidas" }));
    expect(await createProduct(a, prodInput(catB))).toEqual({ ok: false, reason: "not_found" });
    const cat = mustId(await createCategory(a, { name: "Lanches" }));
    expect(await createProduct(a, prodInput(cat, { variants: [] }))).toEqual({ ok: false, reason: "invalid" });
  });

  it("não edita nem arquiva produto de outra loja", async () => {
    const cat = mustId(await createCategory(a, { name: "Lanches" }));
    const id = mustId(await createProduct(a, prodInput(cat)));
    expect(await updateProduct(b, id, prodInput(cat))).toEqual({ ok: false, reason: "not_found" });
    expect(await setProductActive(b, id, false)).toEqual({ ok: false, reason: "not_found" });
    expect(await pauseProduct(b, id, null)).toEqual({ ok: false, reason: "not_found" });
  });

  it("editar arquiva variação omitida em vez de apagar e mantém o id das demais", async () => {
    const cat = mustId(await createCategory(a, { name: "Lanches" }));
    const id = mustId(await createProduct(a, prodInput(cat)));
    const [first] = (await listForPanel(a.tenantId, NOW, SP)).categories[0].products[0].variants;
    mustId(await updateProduct(a, id, prodInput(cat, { variants: [{ id: first.id, name: "Simples", priceCents: 1900 }] })));
    const rows = await adminSql`select id, active, price_cents from catalog_variants where product_id = ${id} order by position`;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.active)).toEqual([expect.objectContaining({ id: first.id, price_cents: 1900 })]);
  });

  it("variação de outro produto no payload: invalid e nada muda", async () => {
    const cat = mustId(await createCategory(a, { name: "Lanches" }));
    const p1 = mustId(await createProduct(a, prodInput(cat)));
    const p2 = mustId(await createProduct(a, prodInput(cat, { name: "Outro" })));
    const [foreign] = await adminSql`select id from catalog_variants where product_id = ${p2} limit 1`;
    const r = await updateProduct(a, p1, prodInput(cat, { variants: [{ id: foreign.id, name: "x", priceCents: 1 }] }));
    expect(r).toEqual({ ok: false, reason: "invalid" });
    const [{ n }] = await adminSql`select count(*)::int as n from catalog_variants where product_id = ${p1} and active`;
    expect(n).toBe(2);
  });

  it("arquivar tira da vitrine e preserva variações; restaurar volta", async () => {
    const cat = mustId(await createCategory(a, { name: "Lanches" }));
    const id = mustId(await createProduct(a, prodInput(cat)));
    mustId(await setProductActive(a, id, false));
    expect(await listMenu(a.tenantId, NOW, SP)).toEqual([]);
    const [{ n }] = await adminSql`select count(*)::int as n from catalog_variants where product_id = ${id}`;
    expect(n).toBe(2);
    mustId(await setProductActive(a, id, true));
    expect(await listMenu(a.tenantId, NOW, SP)).toHaveLength(1);
    mustId(await setCategoryActive(a, cat, false));
    expect(await listMenu(a.tenantId, NOW, SP)).toEqual([]);
  });

  it("pausa e retoma", async () => {
    const cat = mustId(await createCategory(a, { name: "Lanches" }));
    const id = mustId(await createProduct(a, prodInput(cat)));
    const until = new Date("2026-10-07T03:00:00Z");
    mustId(await pauseProduct(a, id, until));
    expect((await listMenu(a.tenantId, NOW, SP))[0].products[0].availability).toEqual({ state: "paused", until });
    mustId(await pauseProduct(a, id, null));
    expect((await listMenu(a.tenantId, NOW, SP))[0].products[0].availability).toEqual({ state: "available" });
  });

  it("reordenar exige a lista completa; id estranho ou faltando não muda nada", async () => {
    const c1 = mustId(await createCategory(a, { name: "A" }));
    const c2 = mustId(await createCategory(a, { name: "B" }));
    const c3 = mustId(await createCategory(b, { name: "Alheia" }));
    expect(await reorderCategories(a, [c2])).toEqual({ ok: false, reason: "invalid" });
    expect(await reorderCategories(a, [c2, c1, c3])).toEqual({ ok: false, reason: "invalid" });
    expect(await reorderCategories(a, [c2, c2])).toEqual({ ok: false, reason: "invalid" });
    expect((await listForPanel(a.tenantId, NOW, SP)).categories.map((c) => c.name)).toEqual(["A", "B"]);
    mustId(await reorderCategories(a, [c2, c1]));
    expect((await listForPanel(a.tenantId, NOW, SP)).categories.map((c) => c.name)).toEqual(["B", "A"]);
  });

  it("reordena produtos dentro da categoria", async () => {
    const cat = mustId(await createCategory(a, { name: "Lanches" }));
    const p1 = mustId(await createProduct(a, prodInput(cat, { name: "Um" })));
    const p2 = mustId(await createProduct(a, prodInput(cat, { name: "Dois" })));
    mustId(await reorderProducts(a, cat, [p2, p1]));
    expect((await listForPanel(a.tenantId, NOW, SP)).categories[0].products.map((p) => p.name)).toEqual(["Dois", "Um"]);
    expect(await reorderProducts(a, cat, [p2])).toEqual({ ok: false, reason: "invalid" });
  });

  it("grava auditoria com ator e recurso", async () => {
    const cat = mustId(await createCategory(a, { name: "Lanches" }));
    const id = mustId(await createProduct(a, prodInput(cat)));
    await pauseProduct(a, id, new Date("2026-10-07T03:00:00Z"));
    const rows = await adminSql`select action, actor, resource from audit_log where tenant_id = ${a.tenantId} order by created_at`;
    expect(rows.map((r) => r.action)).toEqual(["catalog.category.create", "catalog.product.create", "catalog.product.pause"]);
    expect(rows[2]).toMatchObject({ actor: "staff:a", resource: id });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/catalog/commands.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `writers.ts`**

```ts
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/server/db/client";
import {
  catalogCategories, catalogProducts, catalogVariants, categorySchedules,
  productOptionGroups, productSchedules,
} from "@/server/db/schema";
import type { CategoryInput, ProductInput } from "./schemas";

export type CountableTable =
  | "catalog_categories" | "catalog_products" | "option_groups" | "schedules";

/** Quantos dos ids existem na loja atual (a RLS já filtra por tenant). */
export async function countExisting(tx: Tx, table: CountableTable, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = await tx.execute(sql`select count(*)::int as n from ${sql.identifier(table)} where id in (${list})`);
  return (rows[0] as unknown as { n: number }).n;
}

export async function insertCategory(tx: Tx, tenantId: string, input: CategoryInput): Promise<string> {
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${catalogCategories.position}), -1) + 1` })
    .from(catalogCategories);
  const [row] = await tx
    .insert(catalogCategories)
    .values({ tenantId, name: input.name, position: next })
    .returning({ id: catalogCategories.id });
  if (input.scheduleIds.length > 0) {
    await tx.insert(categorySchedules).values(
      input.scheduleIds.map((scheduleId) => ({ tenantId, categoryId: row.id, scheduleId })),
    );
  }
  return row.id;
}

export async function insertProduct(tx: Tx, tenantId: string, input: ProductInput): Promise<string> {
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${catalogProducts.position}), -1) + 1` })
    .from(catalogProducts)
    .where(eq(catalogProducts.categoryId, input.categoryId));
  const [row] = await tx
    .insert(catalogProducts)
    .values({
      tenantId, categoryId: input.categoryId, name: input.name, description: input.description,
      imageUrl: input.imageUrl, dietary: input.dietary, position: next,
    })
    .returning({ id: catalogProducts.id });
  await syncProductChildren(tx, tenantId, row.id, input);
  return row.id;
}

/**
 * Variações: as com id são atualizadas, as sem id são criadas e as omitidas são arquivadas (nunca apagadas).
 * Grupos e horários são configuração, não histórico: substituídos por inteiro.
 * Devolve false se algum variant.id não pertencer ao produto.
 */
export async function syncProductChildren(tx: Tx, tenantId: string, productId: string, input: ProductInput): Promise<boolean> {
  const existing = await tx.select({ id: catalogVariants.id }).from(catalogVariants).where(eq(catalogVariants.productId, productId));
  const existingIds = new Set(existing.map((v) => v.id));
  if (input.variants.some((v) => v.id && !existingIds.has(v.id))) return false;

  const kept = new Set<string>();
  for (const [position, v] of input.variants.entries()) {
    if (v.id) {
      kept.add(v.id);
      await tx.update(catalogVariants)
        .set({ name: v.name, priceCents: v.priceCents, position, active: true })
        .where(eq(catalogVariants.id, v.id));
    } else {
      await tx.insert(catalogVariants).values({ tenantId, productId, name: v.name, priceCents: v.priceCents, position });
    }
  }
  for (const id of existingIds) {
    if (!kept.has(id)) await tx.update(catalogVariants).set({ active: false }).where(eq(catalogVariants.id, id));
  }

  await tx.delete(productOptionGroups).where(eq(productOptionGroups.productId, productId));
  if (input.optionGroupIds.length > 0) {
    await tx.insert(productOptionGroups).values(
      input.optionGroupIds.map((groupId, position) => ({ tenantId, productId, groupId, position })),
    );
  }
  await tx.delete(productSchedules).where(eq(productSchedules.productId, productId));
  if (input.scheduleIds.length > 0) {
    await tx.insert(productSchedules).values(
      input.scheduleIds.map((scheduleId) => ({ tenantId, productId, scheduleId })),
    );
  }
  return true;
}
```

Nota: o import `and` de `drizzle-orm` só passa a ser usado na Task 6 (`cloneProduct`). Se o lint da Task 5 acusar import sem uso, remova `and` agora e reacrescente na Task 6.

- [ ] **Step 4: Implementar `commands.ts`**

```ts
import { eq } from "drizzle-orm";
import { writeAudit } from "@/server/audit";
import type { Tx } from "@/server/db/client";
import { catalogCategories, catalogProducts, catalogVariants, categorySchedules } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { categoryInputSchema, productInputSchema } from "./schemas";
import { countExisting, insertCategory, insertProduct, syncProductChildren } from "./writers";

export interface Ctx {
  tenantId: string;
  actor: string;
}
export type Result = { ok: true; id: string } | { ok: false; reason: "not_found" | "invalid" };

export const NOT_FOUND: Result = { ok: false, reason: "not_found" };
export const INVALID: Result = { ok: false, reason: "invalid" };

/** Roda o comando e, se deu certo, grava a auditoria. */
export async function run(ctx: Ctx, action: string, fn: (tx: Tx) => Promise<Result>): Promise<Result> {
  const result = await withTenant(ctx.tenantId, fn);
  if (result.ok) await writeAudit(ctx.tenantId, { actor: ctx.actor, action, resource: result.id });
  return result;
}

async function linksExist(tx: Tx, groupIds: string[], scheduleIds: string[]): Promise<boolean> {
  return (
    (await countExisting(tx, "option_groups", groupIds)) === groupIds.length &&
    (await countExisting(tx, "schedules", scheduleIds)) === scheduleIds.length
  );
}

export async function createCategory(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = categoryInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  return run(ctx, "catalog.category.create", async (tx) => {
    if ((await countExisting(tx, "schedules", parsed.data.scheduleIds)) !== parsed.data.scheduleIds.length) return NOT_FOUND;
    return { ok: true, id: await insertCategory(tx, ctx.tenantId, parsed.data) };
  });
}

export async function updateCategory(ctx: Ctx, id: string, raw: unknown): Promise<Result> {
  const parsed = categoryInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  return run(ctx, "catalog.category.update", async (tx) => {
    if ((await countExisting(tx, "catalog_categories", [id])) !== 1) return NOT_FOUND;
    if ((await countExisting(tx, "schedules", parsed.data.scheduleIds)) !== parsed.data.scheduleIds.length) return NOT_FOUND;
    await tx.update(catalogCategories).set({ name: parsed.data.name }).where(eq(catalogCategories.id, id));
    await tx.delete(categorySchedules).where(eq(categorySchedules.categoryId, id));
    if (parsed.data.scheduleIds.length > 0) {
      await tx.insert(categorySchedules).values(
        parsed.data.scheduleIds.map((scheduleId) => ({ tenantId: ctx.tenantId, categoryId: id, scheduleId })),
      );
    }
    return { ok: true, id };
  });
}

export async function setCategoryActive(ctx: Ctx, id: string, active: boolean): Promise<Result> {
  return run(ctx, active ? "catalog.category.restore" : "catalog.category.archive", async (tx) => {
    const rows = await tx.update(catalogCategories).set({ active }).where(eq(catalogCategories.id, id)).returning({ id: catalogCategories.id });
    return rows.length === 1 ? { ok: true, id } : NOT_FOUND;
  });
}

export async function createProduct(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const input = parsed.data;
  if (input.variants.some((v) => v.id)) return INVALID; // produto novo não tem variações existentes
  return run(ctx, "catalog.product.create", async (tx) => {
    if ((await countExisting(tx, "catalog_categories", [input.categoryId])) !== 1) return NOT_FOUND;
    if (!(await linksExist(tx, input.optionGroupIds, input.scheduleIds))) return NOT_FOUND;
    return { ok: true, id: await insertProduct(tx, ctx.tenantId, input) };
  });
}

export async function updateProduct(ctx: Ctx, id: string, raw: unknown): Promise<Result> {
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const input = parsed.data;
  return run(ctx, "catalog.product.update", async (tx) => {
    if ((await countExisting(tx, "catalog_products", [id])) !== 1) return NOT_FOUND;
    if ((await countExisting(tx, "catalog_categories", [input.categoryId])) !== 1) return NOT_FOUND;
    if (!(await linksExist(tx, input.optionGroupIds, input.scheduleIds))) return NOT_FOUND;
    // Valida os ids de variação antes de qualquer escrita: erro de negócio vira valor, não exceção.
    const owned = await tx.select({ id: catalogVariants.id }).from(catalogVariants).where(eq(catalogVariants.productId, id));
    const ownedIds = new Set(owned.map((v) => v.id));
    if (input.variants.some((v) => v.id && !ownedIds.has(v.id))) return INVALID;
    await syncProductChildren(tx, ctx.tenantId, id, input);
    await tx.update(catalogProducts).set({
      categoryId: input.categoryId, name: input.name, description: input.description,
      imageUrl: input.imageUrl, dietary: input.dietary,
    }).where(eq(catalogProducts.id, id));
    return { ok: true, id };
  });
}

export async function setProductActive(ctx: Ctx, id: string, active: boolean): Promise<Result> {
  return run(ctx, active ? "catalog.product.restore" : "catalog.product.archive", async (tx) => {
    const rows = await tx.update(catalogProducts).set({ active }).where(eq(catalogProducts.id, id)).returning({ id: catalogProducts.id });
    return rows.length === 1 ? { ok: true, id } : NOT_FOUND;
  });
}

export async function pauseProduct(ctx: Ctx, id: string, until: Date | null): Promise<Result> {
  return run(ctx, until ? "catalog.product.pause" : "catalog.product.resume", async (tx) => {
    const rows = await tx.update(catalogProducts).set({ pausedUntil: until }).where(eq(catalogProducts.id, id)).returning({ id: catalogProducts.id });
    return rows.length === 1 ? { ok: true, id } : NOT_FOUND;
  });
}

async function applyOrder(tx: Tx, table: typeof catalogCategories | typeof catalogProducts, ids: string[]): Promise<void> {
  for (const [position, id] of ids.entries()) {
    await tx.update(table).set({ position }).where(eq(table.id, id));
  }
}

export async function reorderCategories(ctx: Ctx, ids: string[]): Promise<Result> {
  return run(ctx, "catalog.category.reorder", async (tx) => {
    const current = (await tx.select({ id: catalogCategories.id }).from(catalogCategories)).map((r) => r.id);
    if (!sameSet(current, ids)) return INVALID;
    await applyOrder(tx, catalogCategories, ids);
    return { ok: true, id: ctx.tenantId };
  });
}

export async function reorderProducts(ctx: Ctx, categoryId: string, ids: string[]): Promise<Result> {
  return run(ctx, "catalog.product.reorder", async (tx) => {
    const current = (await tx.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.categoryId, categoryId))).map((r) => r.id);
    if (current.length === 0 || !sameSet(current, ids)) return INVALID;
    await applyOrder(tx, catalogProducts, ids);
    return { ok: true, id: categoryId };
  });
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && new Set(b).size === b.length && a.every((id) => b.includes(id));
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/catalog/commands.test.ts`
Expected: PASS (9 testes). Se algum falhar, use `systematic-debugging`; não enfraqueça o teste.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint
git add src/server/catalog tests/catalog/commands.test.ts
git commit -m "feat(catalog): comandos de categoria, produto, pausa e ordem"
```

---

### Task 6: Escritas — grupos de opções, horários e duplicação

**Files:**
- Modify: `src/server/catalog/writers.ts` (acrescentar `insertOptionGroup`, `syncOptionItems`, `insertSchedule`, `cloneProduct`)
- Modify: `src/server/catalog/commands.ts` (acrescentar comandos)
- Test: `tests/catalog/commands-library.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `Result`, `run`, `NOT_FOUND`, `INVALID` (Task 5); `optionGroupInputSchema`, `scheduleInputSchema` (Task 3).
- Produces (`writers.ts`): `insertOptionGroup(tx, tenantId, input: OptionGroupInput): Promise<string>`; `insertSchedule(tx, tenantId, input: ScheduleInput): Promise<string>`; `cloneProduct(tx, tenantId, productId, to: { categoryId: string; name: string; active: boolean }): Promise<string | null>`.
- Produces (`commands.ts`): `createOptionGroup(ctx, raw)`, `updateOptionGroup(ctx, id, raw)`, `createSchedule(ctx, raw)`, `updateSchedule(ctx, id, raw)`, `duplicateProduct(ctx, id)`, `duplicateCategory(ctx, id)` — todas `Promise<Result>`. Ações de auditoria: `catalog.group.create|update`, `catalog.schedule.create|update`, `catalog.product.duplicate`, `catalog.category.duplicate`.

- [ ] **Step 1: Teste que falha** — `tests/catalog/commands-library.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import {
  createCategory, createOptionGroup, createProduct, createSchedule, duplicateCategory,
  duplicateProduct, updateOptionGroup, updateSchedule, type Ctx,
} from "@/server/catalog/commands";
import { listForPanel } from "@/server/catalog/queries";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

const NOW = new Date("2026-10-06T21:00:00Z");
const SP = "America/Sao_Paulo";
let a: Ctx;
let b: Ctx;
const id = (r: { ok: boolean; id?: string }) => {
  if (!r.ok || !r.id) throw new Error("esperava ok");
  return r.id;
};
const group = (over: Record<string, unknown> = {}) => ({
  name: "Adicionais", minSelect: 0, maxSelect: 2,
  items: [{ name: "Granola", priceDeltaCents: 200 }, { name: "Leite em pó", priceDeltaCents: 300 }],
  ...over,
});
const sched = { name: "Almoço", windows: [{ weekday: 1, opensMin: 660, closesMin: 900 }] };

beforeEach(async () => {
  await resetDb();
  a = { tenantId: await createTenant("loja-a"), actor: "staff:a" };
  b = { tenantId: await createTenant("loja-b"), actor: "staff:b" };
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("grupos de opções", () => {
  it("cria e atualiza; item omitido é arquivado, não apagado", async () => {
    const gid = id(await createOptionGroup(a, group()));
    const { groups } = await listForPanel(a.tenantId, NOW, SP);
    const keep = groups[0].items[0];
    id(await updateOptionGroup(a, gid, group({
      maxSelect: 1,
      items: [{ id: keep.id, name: "Granola crocante", priceDeltaCents: 250 }],
    })));
    const rows = await adminSql`select name, active from option_items where group_id = ${gid} order by position`;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.active)).toEqual([expect.objectContaining({ name: "Granola crocante" })]);
  });

  it("recusa regra impossível e não mexe em grupo de outra loja", async () => {
    expect(await createOptionGroup(a, group({ minSelect: 3, maxSelect: 2 }))).toEqual({ ok: false, reason: "invalid" });
    const gid = id(await createOptionGroup(a, group()));
    expect(await updateOptionGroup(b, gid, group())).toEqual({ ok: false, reason: "not_found" });
  });

  it("item de outro grupo no payload: invalid", async () => {
    const g1 = id(await createOptionGroup(a, group()));
    const g2 = id(await createOptionGroup(a, group({ name: "Outro" })));
    const [foreign] = await adminSql`select id from option_items where group_id = ${g2} limit 1`;
    expect(
      await updateOptionGroup(a, g1, group({ items: [{ id: foreign.id, name: "x", priceDeltaCents: 0 }], maxSelect: 1 })),
    ).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("horários", () => {
  it("cria e substitui janelas", async () => {
    const sid = id(await createSchedule(a, sched));
    id(await updateSchedule(a, sid, { name: "Jantar", windows: [{ weekday: 2, opensMin: 1080, closesMin: 1380 }] }));
    const { schedules } = await listForPanel(a.tenantId, NOW, SP);
    expect(schedules).toEqual([{ id: sid, name: "Jantar", windows: [{ weekday: 2, opensMin: 1080, closesMin: 1380 }] }]);
  });

  it("janela inválida: invalid; horário de outra loja: not_found", async () => {
    expect(await createSchedule(a, { name: "x", windows: [{ weekday: 1, opensMin: 600, closesMin: 600 }] })).toEqual({ ok: false, reason: "invalid" });
    const sid = id(await createSchedule(a, sched));
    expect(await updateSchedule(b, sid, sched)).toEqual({ ok: false, reason: "not_found" });
  });

  it("produto não liga horário de outra loja", async () => {
    const sidB = id(await createSchedule(b, sched));
    const cat = id(await createCategory(a, { name: "Lanches" }));
    expect(
      await createProduct(a, { categoryId: cat, name: "X", variants: [{ name: "Único", priceCents: 100 }], scheduleIds: [sidB] }),
    ).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("duplicar", () => {
  async function seed() {
    const gid = id(await createOptionGroup(a, group()));
    const sid = id(await createSchedule(a, sched));
    const cat = id(await createCategory(a, { name: "Açaí" }));
    const pid = id(await createProduct(a, {
      categoryId: cat, name: "Açaí 300", dietary: ["vegan"],
      variants: [{ name: "300ml", priceCents: 1500 }, { name: "500ml", priceCents: 2200 }],
      optionGroupIds: [gid], scheduleIds: [sid],
    }));
    return { gid, sid, cat, pid };
  }

  it("duplicar produto copia tudo, nomeia '(cópia)' e nasce arquivado", async () => {
    const { gid, sid, cat, pid } = await seed();
    const copy = id(await duplicateProduct(a, pid));
    expect(copy).not.toBe(pid);
    const p = (await listForPanel(a.tenantId, NOW, SP)).categories[0].products.find((x) => x.id === copy)!;
    expect(p).toMatchObject({ name: "Açaí 300 (cópia)", active: false, dietary: ["vegan"], optionGroupIds: [gid], scheduleIds: [sid], categoryId: cat });
    expect(p.variants.map((v) => v.priceCents)).toEqual([1500, 2200]);
  });

  it("duplicar produto de outra loja: not_found", async () => {
    const { pid } = await seed();
    expect(await duplicateProduct(b, pid)).toEqual({ ok: false, reason: "not_found" });
  });

  it("duplicar categoria copia seus produtos e horários e nasce arquivada", async () => {
    const { cat, sid } = await seed();
    const copy = id(await duplicateCategory(a, cat));
    const c = (await listForPanel(a.tenantId, NOW, SP)).categories.find((x) => x.id === copy)!;
    expect(c).toMatchObject({ name: "Açaí (cópia)", active: false, scheduleIds: [sid] });
    expect(c.products.map((p) => p.name)).toEqual(["Açaí 300"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/catalog/commands-library.test.ts`
Expected: FAIL (funções inexistentes).

- [ ] **Step 3: Acrescentar a `writers.ts`**

Imports adicionais no topo: `asc` de `drizzle-orm`; `optionGroups, optionItems, scheduleWindows, schedules` de `@/server/db/schema`; tipos `OptionGroupInput, ScheduleInput` de `./schemas`.

```ts
export async function insertOptionGroup(tx: Tx, tenantId: string, input: OptionGroupInput): Promise<string> {
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${optionGroups.position}), -1) + 1` })
    .from(optionGroups);
  const [row] = await tx
    .insert(optionGroups)
    .values({ tenantId, name: input.name, minSelect: input.minSelect, maxSelect: input.maxSelect, position: next })
    .returning({ id: optionGroups.id });
  await tx.insert(optionItems).values(
    input.items.map((i, position) => ({ tenantId, groupId: row.id, name: i.name, priceDeltaCents: i.priceDeltaCents, position })),
  );
  return row.id;
}

/** Itens com id são atualizados, sem id criados, omitidos arquivados. false se algum id não for do grupo. */
export async function syncOptionItems(tx: Tx, tenantId: string, groupId: string, input: OptionGroupInput): Promise<boolean> {
  const existing = await tx.select({ id: optionItems.id }).from(optionItems).where(eq(optionItems.groupId, groupId));
  const existingIds = new Set(existing.map((i) => i.id));
  if (input.items.some((i) => i.id && !existingIds.has(i.id))) return false;
  const kept = new Set<string>();
  for (const [position, i] of input.items.entries()) {
    if (i.id) {
      kept.add(i.id);
      await tx.update(optionItems)
        .set({ name: i.name, priceDeltaCents: i.priceDeltaCents, position, active: true })
        .where(eq(optionItems.id, i.id));
    } else {
      await tx.insert(optionItems).values({ tenantId, groupId, name: i.name, priceDeltaCents: i.priceDeltaCents, position });
    }
  }
  for (const id of existingIds) {
    if (!kept.has(id)) await tx.update(optionItems).set({ active: false }).where(eq(optionItems.id, id));
  }
  return true;
}

export async function insertSchedule(tx: Tx, tenantId: string, input: ScheduleInput): Promise<string> {
  const [row] = await tx.insert(schedules).values({ tenantId, name: input.name }).returning({ id: schedules.id });
  await tx.insert(scheduleWindows).values(
    input.windows.map((w) => ({ tenantId, scheduleId: row.id, weekday: w.weekday, opensMin: w.opensMin, closesMin: w.closesMin })),
  );
  return row.id;
}

/** Copia produto + variações ativas + ligações. null se o produto não existir na loja. */
export async function cloneProduct(
  tx: Tx, tenantId: string, productId: string,
  to: { categoryId: string; name: string; active: boolean },
): Promise<string | null> {
  const [src] = await tx.select().from(catalogProducts).where(eq(catalogProducts.id, productId));
  if (!src) return null;
  const variants = await tx.select().from(catalogVariants)
    .where(and(eq(catalogVariants.productId, productId), eq(catalogVariants.active, true)))
    .orderBy(asc(catalogVariants.position));
  const groups = await tx.select().from(productOptionGroups).where(eq(productOptionGroups.productId, productId));
  const scheds = await tx.select().from(productSchedules).where(eq(productSchedules.productId, productId));
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${catalogProducts.position}), -1) + 1` })
    .from(catalogProducts)
    .where(eq(catalogProducts.categoryId, to.categoryId));
  const [row] = await tx.insert(catalogProducts).values({
    tenantId, categoryId: to.categoryId, name: to.name.slice(0, 120), description: src.description,
    imageUrl: src.imageUrl, dietary: src.dietary, position: next, active: to.active,
  }).returning({ id: catalogProducts.id });
  if (variants.length > 0) {
    await tx.insert(catalogVariants).values(
      variants.map((v, position) => ({ tenantId, productId: row.id, name: v.name, priceCents: v.priceCents, position })),
    );
  }
  if (groups.length > 0) {
    await tx.insert(productOptionGroups).values(
      groups.map((g) => ({ tenantId, productId: row.id, groupId: g.groupId, position: g.position })),
    );
  }
  if (scheds.length > 0) {
    await tx.insert(productSchedules).values(scheds.map((s) => ({ tenantId, productId: row.id, scheduleId: s.scheduleId })));
  }
  return row.id;
}
```

(`and` de `drizzle-orm` já está importado em `writers.ts` desde a Task 5.)

- [ ] **Step 4: Acrescentar a `commands.ts`**

Imports adicionais: `and, asc` de `drizzle-orm`; `optionGroups, scheduleWindows, schedules` de `@/server/db/schema`; `optionGroupInputSchema, scheduleInputSchema` de `./schemas`; `cloneProduct, insertOptionGroup, insertSchedule, syncOptionItems` de `./writers`.

```ts
export async function createOptionGroup(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = optionGroupInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  return run(ctx, "catalog.group.create", async (tx) => ({ ok: true, id: await insertOptionGroup(tx, ctx.tenantId, parsed.data) }));
}

export async function updateOptionGroup(ctx: Ctx, id: string, raw: unknown): Promise<Result> {
  const parsed = optionGroupInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  return run(ctx, "catalog.group.update", async (tx) => {
    if ((await countExisting(tx, "option_groups", [id])) !== 1) return NOT_FOUND;
    const owned = await tx.select({ id: optionItems.id }).from(optionItems).where(eq(optionItems.groupId, id));
    const ownedIds = new Set(owned.map((i) => i.id));
    if (parsed.data.items.some((i) => i.id && !ownedIds.has(i.id))) return INVALID;
    await tx.update(optionGroups)
      .set({ name: parsed.data.name, minSelect: parsed.data.minSelect, maxSelect: parsed.data.maxSelect })
      .where(eq(optionGroups.id, id));
    await syncOptionItems(tx, ctx.tenantId, id, parsed.data);
    return { ok: true, id };
  });
}

export async function createSchedule(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = scheduleInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  return run(ctx, "catalog.schedule.create", async (tx) => ({ ok: true, id: await insertSchedule(tx, ctx.tenantId, parsed.data) }));
}

export async function updateSchedule(ctx: Ctx, id: string, raw: unknown): Promise<Result> {
  const parsed = scheduleInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  return run(ctx, "catalog.schedule.update", async (tx) => {
    if ((await countExisting(tx, "schedules", [id])) !== 1) return NOT_FOUND;
    await tx.update(schedules).set({ name: parsed.data.name }).where(eq(schedules.id, id));
    await tx.delete(scheduleWindows).where(eq(scheduleWindows.scheduleId, id));
    await tx.insert(scheduleWindows).values(
      parsed.data.windows.map((w) => ({ tenantId: ctx.tenantId, scheduleId: id, weekday: w.weekday, opensMin: w.opensMin, closesMin: w.closesMin })),
    );
    return { ok: true, id };
  });
}

export async function duplicateProduct(ctx: Ctx, id: string): Promise<Result> {
  return run(ctx, "catalog.product.duplicate", async (tx) => {
    const [src] = await tx.select({ name: catalogProducts.name, categoryId: catalogProducts.categoryId })
      .from(catalogProducts).where(eq(catalogProducts.id, id));
    if (!src) return NOT_FOUND;
    const copy = await cloneProduct(tx, ctx.tenantId, id, { categoryId: src.categoryId, name: `${src.name} (cópia)`, active: false });
    return copy ? { ok: true, id: copy } : NOT_FOUND;
  });
}

export async function duplicateCategory(ctx: Ctx, id: string): Promise<Result> {
  return run(ctx, "catalog.category.duplicate", async (tx) => {
    const [src] = await tx.select().from(catalogCategories).where(eq(catalogCategories.id, id));
    if (!src) return NOT_FOUND;
    const scheds = await tx.select().from(categorySchedules).where(eq(categorySchedules.categoryId, id));
    const copyId = await insertCategory(tx, ctx.tenantId, {
      name: `${src.name} (cópia)`.slice(0, 80),
      scheduleIds: scheds.map((s) => s.scheduleId),
    });
    await tx.update(catalogCategories).set({ active: false }).where(eq(catalogCategories.id, copyId));
    const products = await tx.select({ id: catalogProducts.id, name: catalogProducts.name })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.categoryId, id), eq(catalogProducts.active, true)))
      .orderBy(asc(catalogProducts.position));
    for (const p of products) {
      await cloneProduct(tx, ctx.tenantId, p.id, { categoryId: copyId, name: p.name, active: true });
    }
    return { ok: true, id: copyId };
  });
}
```

Acrescente também `optionItems` ao import de `@/server/db/schema` em `commands.ts`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/catalog`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint
git add src/server/catalog tests/catalog/commands-library.test.ts
git commit -m "feat(catalog): grupos de opções, horários e duplicação"
```

---

### Task 7: Modelos iniciais por tipo de loja

**Files:**
- Create: `src/server/catalog/templates.ts`
- Test: `tests/catalog/templates.test.ts`

**Interfaces:**
- Consumes: `insertCategory`, `insertOptionGroup`, `insertProduct` (Task 5/6), `run`, `Ctx` (Task 5), `listForPanel` (testes).
- Produces: `type Vertical = "restaurante" | "lanchonete" | "acaiteria" | "quiosque"`; `TEMPLATES: Record<Vertical, Template>`; `applyTemplate(ctx: Ctx, vertical: Vertical): Promise<{ ok: true } | { ok: false; reason: "not_empty" }>`. Auditoria: `catalog.template.apply` com `resource` = vertical.

- [ ] **Step 1: Teste que falha** — `tests/catalog/templates.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { createCategory } from "@/server/catalog/commands";
import { listForPanel } from "@/server/catalog/queries";
import { applyTemplate, TEMPLATES, type Vertical } from "@/server/catalog/templates";
import { productInputSchema } from "@/server/catalog/schemas";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

const NOW = new Date("2026-10-06T21:00:00Z");
const SP = "America/Sao_Paulo";
const VERTICALS: Vertical[] = ["restaurante", "lanchonete", "acaiteria", "quiosque"];
let ctx: { tenantId: string; actor: string };

beforeEach(async () => {
  await resetDb();
  ctx = { tenantId: await createTenant("loja"), actor: "staff:x" };
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("modelos iniciais", () => {
  it.each(VERTICALS)("%s: todo produto do modelo passa no schema e referencia grupo existente", (v) => {
    const t = TEMPLATES[v];
    const keys = new Set(t.groups.map((g) => g.key));
    for (const c of t.categories) {
      for (const p of c.products) {
        for (const g of p.groups ?? []) expect(keys.has(g), `${v}/${p.name}: grupo ${g}`).toBe(true);
        const parsed = productInputSchema.safeParse({
          categoryId: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b", name: p.name, description: p.description,
          dietary: p.dietary ?? [], variants: p.variants.map(([name, priceCents]) => ({ name, priceCents })),
        });
        expect(parsed.success, `${v}/${p.name}`).toBe(true);
      }
    }
  });

  it.each(VERTICALS)("%s: aplica em catálogo vazio e o painel mostra tudo", async (v) => {
    expect(await applyTemplate(ctx, v)).toEqual({ ok: true });
    const panel = await listForPanel(ctx.tenantId, NOW, SP);
    expect(panel.categories).toHaveLength(TEMPLATES[v].categories.length);
    expect(panel.groups).toHaveLength(TEMPLATES[v].groups.length);
    expect(panel.categories.every((c) => c.active && c.products.every((p) => p.active))).toBe(true);
  });

  it("não aplica duas vezes nem sobre catálogo existente", async () => {
    expect(await applyTemplate(ctx, "acaiteria")).toEqual({ ok: true });
    expect(await applyTemplate(ctx, "acaiteria")).toEqual({ ok: false, reason: "not_empty" });
    const [{ n }] = await adminSql`select count(*)::int as n from catalog_categories where tenant_id = ${ctx.tenantId}`;
    expect(n).toBe(TEMPLATES.acaiteria.categories.length);
  });

  it("recusa quando já existe uma categoria, mesmo arquivada", async () => {
    await createCategory(ctx, { name: "Minha" });
    expect(await applyTemplate(ctx, "lanchonete")).toEqual({ ok: false, reason: "not_empty" });
  });

  it("grava auditoria", async () => {
    await applyTemplate(ctx, "quiosque");
    const [row] = await adminSql`select action, resource from audit_log where tenant_id = ${ctx.tenantId}`;
    expect(row).toEqual({ action: "catalog.template.apply", resource: "quiosque" });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/catalog/templates.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `src/server/catalog/templates.ts`**

```ts
import { writeAudit } from "@/server/audit";
import { withTenant } from "@/server/db/tenant";
import type { Ctx } from "./commands";
import type { Dietary } from "./schemas";
import { insertCategory, insertOptionGroup, insertProduct } from "./writers";

export type Vertical = "restaurante" | "lanchonete" | "acaiteria" | "quiosque";

interface TemplateGroup {
  key: string;
  name: string;
  min: number;
  max: number;
  /** [nome, acréscimo em centavos] */
  items: [string, number][];
}
interface TemplateProduct {
  name: string;
  description: string;
  dietary?: Dietary[];
  /** [nome, preço em centavos] */
  variants: [string, number][];
  groups?: string[];
}
interface Template {
  groups: TemplateGroup[];
  categories: { name: string; products: TemplateProduct[] }[];
}

export const TEMPLATES: Record<Vertical, Template> = {
  acaiteria: {
    groups: [
      {
        key: "adicionais", name: "Adicionais", min: 0, max: 3,
        items: [["Granola", 200], ["Leite em pó", 300], ["Banana", 200], ["Morango", 400]],
      },
      { key: "calda", name: "Calda", min: 0, max: 1, items: [["Chocolate", 0], ["Morango", 0], ["Mel", 0]] },
    ],
    categories: [
      {
        name: "🍧 Açaí",
        products: [
          {
            name: "Açaí tradicional", description: "Açaí batido na hora, com banana.", dietary: ["vegan"],
            variants: [["300ml", 1500], ["500ml", 2200], ["700ml", 2900]], groups: ["adicionais", "calda"],
          },
          {
            name: "Açaí com leite ninho", description: "Açaí cremoso com leite em pó.",
            variants: [["300ml", 1800], ["500ml", 2500]], groups: ["adicionais", "calda"],
          },
        ],
      },
      {
        name: "🥤 Bebidas",
        products: [
          { name: "Água mineral", description: "", variants: [["500ml", 400]] },
          { name: "Suco natural", description: "Sabor do dia.", dietary: ["vegan"], variants: [["400ml", 900]] },
        ],
      },
    ],
  },
  lanchonete: {
    groups: [
      {
        key: "ponto", name: "Ponto da carne", min: 1, max: 1,
        items: [["Mal passado", 0], ["Ao ponto", 0], ["Bem passado", 0]],
      },
      {
        key: "adicionais", name: "Adicionais", min: 0, max: 4,
        items: [["Bacon", 500], ["Queijo extra", 400], ["Ovo", 300], ["Cebola caramelizada", 300]],
      },
      { key: "molhos", name: "Molhos", min: 0, max: 2, items: [["Maionese da casa", 0], ["Barbecue", 0], ["Picante", 0]] },
    ],
    categories: [
      {
        name: "🍔 Lanches",
        products: [
          {
            name: "X-Burger", description: "Pão, hambúrguer, queijo e salada.",
            variants: [["Simples", 1800], ["Duplo", 2800]], groups: ["ponto", "adicionais", "molhos"],
          },
          {
            name: "X-Frango", description: "Frango grelhado, queijo e salada.",
            variants: [["Único", 2000]], groups: ["adicionais", "molhos"],
          },
        ],
      },
      {
        name: "🍟 Porções",
        products: [
          { name: "Batata frita", description: "Porção crocante.", dietary: ["vegetarian"], variants: [["Média", 1800], ["Grande", 2600]], groups: ["molhos"] },
        ],
      },
      { name: "🥤 Bebidas", products: [{ name: "Refrigerante lata", description: "", variants: [["350ml", 600]] }] },
    ],
  },
  restaurante: {
    groups: [
      { key: "acompanhamento", name: "Acompanhamento", min: 1, max: 2, items: [["Arroz", 0], ["Feijão", 0], ["Farofa", 0], ["Salada", 0]] },
      { key: "extras", name: "Extras", min: 0, max: 2, items: [["Ovo frito", 400], ["Batata frita", 800]] },
    ],
    categories: [
      {
        name: "🍽️ Pratos do dia",
        products: [
          { name: "Prato executivo", description: "Carne do dia com acompanhamentos.", variants: [["Único", 3200]], groups: ["acompanhamento", "extras"] },
          { name: "Filé de frango grelhado", description: "Com legumes.", variants: [["Único", 3000]], groups: ["acompanhamento"] },
        ],
      },
      {
        name: "🥗 Saladas",
        products: [{ name: "Salada completa", description: "Folhas, tomate, cenoura e queijo.", dietary: ["vegetarian"], variants: [["Única", 2200]] }],
      },
      { name: "🥤 Bebidas", products: [{ name: "Suco natural", description: "", dietary: ["vegan"], variants: [["400ml", 900]] }] },
    ],
  },
  quiosque: {
    groups: [{ key: "gelo", name: "Gelo", min: 0, max: 1, items: [["Sem gelo", 0], ["Gelo extra", 0]] }],
    categories: [
      {
        name: "🥥 Bebidas geladas",
        products: [
          { name: "Água de coco", description: "Gelada, na hora.", dietary: ["vegan"], variants: [["Copo", 800], ["Coco inteiro", 1200]], groups: ["gelo"] },
          { name: "Limonada", description: "", dietary: ["vegan"], variants: [["500ml", 1000]], groups: ["gelo"] },
        ],
      },
      {
        name: "🍬 Petiscos",
        products: [
          { name: "Pastel", description: "Carne ou queijo.", variants: [["Unidade", 900]] },
          { name: "Tapioca", description: "Queijo e coco.", dietary: ["gluten_free", "vegetarian"], variants: [["Unidade", 1000]] },
        ],
      },
    ],
  },
};

export type ApplyResult = { ok: true } | { ok: false; reason: "not_empty" };

/** Cria o modelo só se a loja não tem nenhuma categoria (nem arquivada). Uma transação. */
export async function applyTemplate(ctx: Ctx, vertical: Vertical): Promise<ApplyResult> {
  const template = TEMPLATES[vertical];
  const result = await withTenant(ctx.tenantId, async (tx): Promise<ApplyResult> => {
    const existing = await tx.execute(sql`select 1 from catalog_categories limit 1`);
    if (existing.length > 0) return { ok: false, reason: "not_empty" };

    const groupIds = new Map<string, string>();
    for (const g of template.groups) {
      groupIds.set(
        g.key,
        await insertOptionGroup(tx, ctx.tenantId, {
          name: g.name, minSelect: g.min, maxSelect: g.max,
          items: g.items.map(([name, priceDeltaCents]) => ({ name, priceDeltaCents })),
        }),
      );
    }
    for (const c of template.categories) {
      const categoryId = await insertCategory(tx, ctx.tenantId, { name: c.name, scheduleIds: [] });
      for (const p of c.products) {
        await insertProduct(tx, ctx.tenantId, {
          categoryId, name: p.name, description: p.description, imageUrl: null,
          dietary: p.dietary ?? [],
          variants: p.variants.map(([name, priceCents]) => ({ name, priceCents })),
          optionGroupIds: (p.groups ?? []).map((k) => groupIds.get(k)!),
          scheduleIds: [],
        });
      }
    }
    return { ok: true };
  });
  if (result.ok) await writeAudit(ctx.tenantId, { actor: ctx.actor, action: "catalog.template.apply", resource: vertical });
  return result;
}
```

Adicione `import { sql } from "drizzle-orm";` no topo do arquivo. O `!` em `groupIds.get(k)!` é seguro porque o primeiro teste do Step 1 prova que toda chave referenciada existe; se o linter bloquear non-null assertion, troque por um `throw new Error("grupo de modelo inexistente")` explícito.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/catalog/templates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/server/catalog/templates.ts tests/catalog/templates.test.ts
git commit -m "feat(catalog): modelos iniciais por tipo de loja"
```

---

### Task 8: Fechamento

**Files:**
- Modify: `docs/superpowers/specs/2026-10-03-bora-catalogo-design.md` (correções de fato)
- Modify: `tests/security/csp.test.ts` (acrescentar caso de imagem)

- [ ] **Step 1: Teste do CSP** — o CSP já libera `img-src 'self' data: https:` (`src/server/security/csp.ts`). Acrescentar em `tests/security/csp.test.ts`, dentro do `describe`:

```ts
  it("imagens: só https e data:, nunca http", () => {
    const csp = buildCsp("n", false);
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).not.toMatch(/img-src[^;]*\bhttp:/);
  });
```

- [ ] **Step 2: Corrigir a spec**
  - Seção 7: trocar "O CSP ... precisa liberar `img-src https:`, com teste." por "O CSP já libera `img-src https:`; um teste passa a travar esse comportamento."
  - Seção 5: trocar `reason: "not_found" | "invalid" | "conflict"` por `reason: "not_found" | "invalid"` (não há restrição de unicidade que gere conflito neste sub-projeto); `applyTemplate` devolve `reason: "not_empty"`.

- [ ] **Step 3: Verificação completa**

Run: `npm run lint && npm run typecheck && npm test`
Expected: tudo verde (os 181 testes anteriores mais os novos de `tests/catalog`).

Run: `npm run e2e:prod`
Expected: 11/11 (nenhuma rota mudou neste plano).

- [ ] **Step 4: Commit e handoff**

```bash
git add docs tests
git commit -m "docs: ajustes na spec do catálogo e teste de CSP para imagens"
```

Em seguida, usar `superpowers:finishing-a-development-branch`. O plano da UI (`2026-10-03-bora-catalogo-ui.md`: move das rotas do painel para `(auth)`/`(shell)`, telas do painel, vitrine, seed e e2e) é escrito depois do merge deste, para partir do código real.

---

## Self-Review

- **Cobertura da spec:** seção 3 → Task 1; seção 4 → Task 2; seção 5 (schemas, queries, commands, templates, auditoria, resultado tipado, duplicar, reordenar, pausa) → Tasks 3–7; testes da seção 8 que são de servidor → Tasks 1–7. Painel (seção 6), vitrine (seção 7) e e2e ficam no plano de UI, declarado no cabeçalho.
- **Permissões** (`catalog:edit` vs `stock:edit` na pausa) são aplicadas nas Server Actions do plano de UI; os comandos aqui recebem `Ctx` já autorizado. Isso é deliberado: a camada de comandos não conhece o papel.
- **Consistência de tipos:** `Ctx`, `Result`, `run`, `NOT_FOUND`, `INVALID` definidos na Task 5 e reutilizados nas Tasks 6 e 7; `ProductInput`/`OptionGroupInput`/`ScheduleInput`/`CategoryInput` definidos na Task 3 e usados nos writers; `RawCatalog`, `buildMenu`, `buildPanel` definidos na Task 4.
- **Ponto de atenção na execução:** `updateProduct` valida os ids de variação antes de escrever (sem `tx.rollback()`), para manter erro de negócio como valor.
