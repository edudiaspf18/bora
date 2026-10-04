# Catálogo — Painel e Vitrine (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar as telas do Catálogo: cadastro no painel (`/catalogo/*`) e cardápio somente leitura na vitrine, sobre a camada de servidor já em `main`.

**Architecture:** O painel ganha dois route groups (`(auth)` estreito, `(shell)` largo com cabeçalho). Páginas são Server Components; todo formulário é um `<form action>` de Server Action que chama `authorizeCatalog` (único ponto de permissão), converte `FormData` com funções puras (`forms.ts`) e delega aos comandos de `src/server/catalog/commands.ts`. Erro volta por redirect com `?erro=codigo`, igual ao login. `'use client'` só nos dois editores de linhas (variações/itens e janelas de horário). A vitrine lê `listMenu` por request (sem cache) e mostra estado de disponibilidade com rótulos puros e testados.

**Tech Stack:** Next.js 15 (App Router, Server Actions), React 19, Tailwind 4, Shadcn (padrão do repo, `cn` de `"cn"`), lucide-react, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-03-bora-catalogo-design.md` (seções 6, 7 e 8; a seção 5 já foi entregue pelo plano `2026-10-03-bora-catalogo-servidor.md`)

## Global Constraints

- Server Components por padrão. `'use client'` só com estado/evento do navegador. **Nunca `useEffect`.** Nunca `any`.
- Somente classes Tailwind (sem CSS puro/`.module.css`); componentes de UI via `@/components/ui/*`; ícones só de `lucide-react`; `cn` vem de `"cn"` (já faz merge de classes Tailwind).
- Toda interação com `hover:`, `focus-visible:` (nunca `focus:` simples) e `transition-all duration-200`.
- Design: zinc, bordas de 1px (`border-zinc-200 dark:border-zinc-800`), sem gradiente/glassmorphism/sombra pesada, `text-zinc-500` para texto secundário, `tracking-tight` em títulos, uma cor de destaque só na ação primária. Mobile primeiro: alvos de toque de no mínimo `h-10`/`h-11`.
- Textos de interface em PT-BR, curtos e amigáveis. Código, comentários e commits em PT-BR. Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Links internos do painel são relativos à raiz do host (`/catalogo`, nunca `/panel/catalogo`): o middleware reescreve `app.<domínio>/x` para `/panel/x`. Na vitrine, `/p/<id>` vira `/s/<slug>/p/<id>`.
- **Toda** página e Server Action de catálogo começa com `authorizeCatalog(...)` (Task 3). Editar = `"catalog:edit"` (dono e gerente). Só **pausar/retomar** e **ver a lista** usam `"stock:edit"` (atendente também tem).
- Erro de negócio como valor: os comandos já devolvem `{ ok: false, reason }`; a UI converte em `?erro=<código>` e nunca deixa exceção chegar ao usuário. Id de URL que não existe → `notFound()` (404), nunca 500.
- `image_url` só `https:` (já imposto por Zod e CHECK). `<img>` com `loading="lazy"`, `width` e `height`.
- Sem rotas `/api`. Server Action exporta só funções `async` (helpers ficam em arquivos sem `"use server"`).
- Baseline antes de cada commit: `npm run lint`, `npm run typecheck` e `npm test` verdes.

## Review Focus

- Atendente abrindo à mão `/catalogo/produtos/novo`, `/catalogo/produtos/<id>`, `/catalogo/opcoes`, `/catalogo/horarios`: vai para `/`, sem editar nada; e na lista só enxerga a pausa (Task 9).
- Id inválido ou de outra loja na URL (`/catalogo/produtos/nao-e-uuid`): 404, não 500 (Task 9).
- Preço digitado como `32,50`, `1.234,50`, `R$ 9`: vira centavos certos; `abc` mostra "Preço inválido" e não grava (Task 2).
- Horário fechando `00:00` vale meia-noite (1440) e fechar antes de abrir avisa "fecha na madrugada do dia seguinte" (Tasks 2 e 7).
- `?dieta=xyz` (etiqueta que não existe) é ignorado, não quebra a vitrine (Task 2).
- Remover linha de variação/item no formulário arquiva (não apaga) e não quebra ids existentes: o texto de ajuda avisa (Tasks 5 e 6).
- Produto fora do horário e pausado aparecem esmaecidos na vitrine com o texto certo; categoria sem item visível some (Tasks 2, 8, 9).

## Decisões deste plano (rulings sobre a spec)

- **Erros por redirect** `?erro=` em vez de `useActionState` (spec §6): é o padrão do login no repo, não exige cliente, e o `required`/`maxLength` do HTML evita a maioria dos erros antes de chegar ao servidor. A Task 9 corrige o texto da spec.
- **"Adicionar opções" dentro do produto** vira link para `/catalogo/opcoes/novo` (formulário dentro de formulário é HTML inválido). A Task 9 corrige a spec.
- **Rotas de categoria** (`/catalogo/categorias/nova`, `/catalogo/categorias/[id]`) não estavam na lista de rotas da spec §6, mas o escopo pede categorias; entram aqui e a Task 9 acrescenta à spec.
- **`Ctx` com marca** (opcional no follow-up) **não** entra: `authorizeCatalog` é a única porta e a revisão confere; YAGNI.

## File Structure

```
src/app/panel/
  layout.tsx                      passthrough
  actions.ts                      (existente) login/seleção/logout
  (auth)/layout.tsx               layout estreito (movido)
  (auth)/login|esqueci-senha|redefinir-senha/   (movidos)
  (shell)/layout.tsx              cabeçalho + largura total
  (shell)/page.tsx                início (movido)
  (shell)/catalogo/
    layout.tsx                    sub-navegação
    page.tsx                      lista (categorias/produtos)
    categorias/nova/page.tsx, categorias/[id]/page.tsx
    produtos/novo/page.tsx, produtos/[id]/page.tsx
    opcoes/page.tsx, opcoes/novo/page.tsx, opcoes/[id]/page.tsx
    horarios/page.tsx, horarios/novo/page.tsx, horarios/[id]/page.tsx
    _actions/shared.ts            helpers sem "use server"
    _actions/list.ts | product.ts | group.ts | schedule.ts   ("use server")
    _components/flash.tsx field.tsx action-button.tsx product-row.tsx
                category-form.tsx product-form.tsx price-rows.tsx(client)
                group-form.tsx schedule-form.tsx window-rows.tsx(client)
src/app/s/[slug]/
  page.tsx                        vitrine (cardápio)
  p/[id]/page.tsx                 detalhe do produto
  _components/menu.tsx
src/components/ui/  textarea.tsx select.tsx checkbox.tsx badge.tsx
src/lib/catalog-view.ts           rótulos e filtros puros
src/lib/money.ts                  (+ centsToInput)
src/server/catalog/ authz.ts forms.ts order.ts
scripts/seed.ts                   (+ catálogo demo)
tests/catalog/ view.test.ts forms.test.ts order.test.ts  tests/e2e/catalog.spec.ts
```

---

### Task 1: Route groups do painel e shell

**Files:**
- Move: `src/app/panel/login`, `esqueci-senha`, `redefinir-senha`, `layout.tsx` → `src/app/panel/(auth)/`; `src/app/panel/page.tsx` → `src/app/panel/(shell)/page.tsx`
- Create: `src/app/panel/layout.tsx` (novo, passthrough), `src/app/panel/(shell)/layout.tsx`
- Modify: `src/app/panel/(auth)/login/page.tsx` (import), `src/app/panel/(shell)/page.tsx`

**Interfaces:**
- Produces: shell com cabeçalho (marca, links "Início" e "Catálogo", nome da loja, botão "Sair") para toda rota em `(shell)`. Sem loja ativa, o shell renderiza a coluna estreita (tela "Escolha a loja"). URLs não mudam (route groups não entram na URL).

- [ ] **Step 1: Baseline do e2e de staff antes de mover**

Run: `npm run e2e -- tests/e2e/staff.spec.ts`
Expected: `4 passed`.

- [ ] **Step 2: Mover arquivos com git**

```bash
cd src/app/panel
mkdir "(auth)" "(shell)"
git mv login esqueci-senha redefinir-senha "(auth)/"
git mv layout.tsx "(auth)/layout.tsx"
git mv page.tsx "(shell)/page.tsx"
cd ../../..
```

- [ ] **Step 3: Layout raiz passthrough** — criar `src/app/panel/layout.tsx`:

```tsx
export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return children;
}
```

- [ ] **Step 4: Corrigir imports relativos**

Em `src/app/panel/(auth)/login/page.tsx` trocar `from "../actions"` por `from "../../actions"`. Em `src/app/panel/(shell)/page.tsx` trocar `from "./actions"` por `from "../actions"`. (`esqueci-senha` e `redefinir-senha` importam `./actions` da própria pasta: não mudam.)

- [ ] **Step 5: Shell** — criar `src/app/panel/(shell)/layout.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStaffContext } from "@/server/auth/staff";
import { logoutAction } from "../actions";

const NAV_LINK =
  "text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function Brand() {
  return (
    <p className="text-lg font-bold tracking-tight">
      bora<span className="text-[#EA580C]">.</span>
    </p>
  );
}

export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/login");

  // Sem loja ativa: tela estreita de escolha, como era antes.
  if (!ctx.active) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
        <div className="mb-12 text-2xl">
          <Brand />
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <Brand />
            <nav aria-label="Principal" className="flex items-center gap-5">
              <Link href="/" className={NAV_LINK}>
                Início
              </Link>
              <Link href="/catalogo" className={NAV_LINK}>
                Catálogo
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-zinc-500 sm:inline">{ctx.active.name}</span>
            <form action={logoutAction}>
              <Button type="submit" variant="outline" className="h-10 transition-all duration-200">
                <LogOut className="size-4" />
                Sair
              </Button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-12">{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: Início sem o botão Sair e com link para o catálogo** — em `src/app/panel/(shell)/page.tsx`: importar `Link from "next/link"` e `ArrowRight` (trocar `LogOut` por `ArrowRight` no import de `lucide-react`), remover `logoutAction` do import de `../actions` (fica só `selectTenantAction`) e substituir o bloco final (`return (<main> ... Painel em construção ... Sair ... </main>)`) por:

```tsx
  return (
    <main>
      <p className="text-sm text-zinc-500">{ROLE_LABEL[ctx.active.role]}</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">{ctx.active.name}</h1>
      <p className="mt-3 max-w-lg leading-relaxed text-zinc-500">
        Cadastre o que sua loja vende e confira o cardápio. Pedidos e estoque chegam nos próximos módulos.
      </p>
      <Button asChild className="mt-10 h-10 transition-all duration-200">
        <Link href="/catalogo">
          Abrir catálogo
          <ArrowRight className="size-4" />
        </Link>
      </Button>
    </main>
  );
```

- [ ] **Step 7: Verificar**

Run: `npm run typecheck && npm run lint && npm run e2e -- tests/e2e/staff.spec.ts`
Expected: tudo verde; `4 passed` (mesmos 4 testes de antes). O link `/catalogo` ainda dá 404: as rotas chegam na Task 4.

- [ ] **Step 8: Commit**

```bash
git add -A src/app/panel
git commit -m "feat(panel): route groups (auth)/(shell) e cabeçalho do painel"
```

---

### Task 2: Helpers puros (dinheiro, rótulos, ordem, formulários)

**Files:**
- Modify: `src/lib/money.ts` (acrescentar `centsToInput`)
- Create: `src/lib/catalog-view.ts`, `src/server/catalog/order.ts`, `src/server/catalog/forms.ts`
- Test: `tests/catalog/money.test.ts` (acrescentar), `tests/catalog/view.test.ts`, `tests/catalog/order.test.ts`, `tests/catalog/forms.test.ts`

**Interfaces:**
- Produces (`money.ts`): `centsToInput(cents: number): string` ("12,50", sem símbolo).
- Produces (`catalog-view.ts`): `DIETARY_LABEL: Record<Dietary, string>`; `WEEKDAY_LABEL: readonly string[]` (Domingo…Sábado); `clock(min: number): string` ("18:00", 1440→"00:00"); `shortClock(min: number): string` ("18h", "18h30"); `storefrontNote(av: Availability, now: Date, tz: string): string | null`; `panelBadge(p: { active: boolean; availability: Availability }, now: Date, tz: string): string | null`; `groupRule(min: number, max: number): string`; `crossesMidnight(opens: string, closes: string): boolean`; `parseDietaryParam(v: string | undefined): Dietary | undefined`; `dietaryTagsIn(menu: MenuCategory[]): Dietary[]`; `filterMenuByDietary(menu: MenuCategory[], tag: Dietary | undefined): MenuCategory[]`.
- Produces (`order.ts`): `moveId(ids: string[], id: string, dir: "up" | "down"): string[] | null` (null = id ausente ou já no limite).
- Produces (`forms.ts`): `formText(fd: FormData, key: string): string`; `timeToMinutes(raw: string, closing: boolean): number | null`; `type FormFail = { ok: false; reason: "preco" | "horario" }`; `parseProductForm(fd): { ok: true; input: unknown } | FormFail`; `parseGroupForm(fd)` e `parseScheduleForm(fd)` idem; `parseCategoryForm(fd): { name: string; scheduleIds: string[] }`. Campos do `FormData` (contrato com as Tasks 4–7): produto = `categoryId name description imageUrl dietary[] optionGroupIds[] scheduleIds[]` + linhas `variantId[] variantName[] variantPrice[]`; grupo = `name minSelect maxSelect` + linhas `itemId[] itemName[] itemPrice[]`; horário = `name` + linhas `winDay[] winOpens[] winCloses[]`; categoria = `name scheduleIds[]`.

- [ ] **Step 1: Testes que falham** — acrescentar ao fim de `tests/catalog/money.test.ts` (e no import do topo trazer `centsToInput`):

```ts
describe("centsToInput", () => {
  it.each([
    [1250, "12,50"],
    [0, "0,00"],
    [5, "0,05"],
    [123450, "1234,50"],
  ])("%i → %j", (cents, text) => expect(centsToInput(cents)).toBe(text));

  it("ida e volta com parseBRL", () => {
    for (const c of [0, 5, 99, 1250, 123450, 99_999_999]) {
      expect(parseBRL(centsToInput(c))).toBe(c);
    }
  });
});
```

`tests/catalog/order.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { moveId } from "@/server/catalog/order";

describe("moveId", () => {
  const ids = ["a", "b", "c"];
  it("sobe e desce trocando com o vizinho, sem mutar a entrada", () => {
    expect(moveId(ids, "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveId(ids, "b", "down")).toEqual(["a", "c", "b"]);
    expect(ids).toEqual(["a", "b", "c"]);
  });
  it("null no limite ou com id estranho", () => {
    expect(moveId(ids, "a", "up")).toBeNull();
    expect(moveId(ids, "c", "down")).toBeNull();
    expect(moveId(ids, "x", "up")).toBeNull();
  });
});
```

`tests/catalog/view.test.ts` (referência de instantes: `2026-10-06` é terça; 18:00 BRT = 21:00Z; `startOfNextLocalDay` = `2026-10-07T03:00Z`):

```ts
import { describe, expect, it } from "vitest";
import {
  clock, crossesMidnight, dietaryTagsIn, filterMenuByDietary, groupRule, panelBadge,
  parseDietaryParam, shortClock, storefrontNote,
} from "@/lib/catalog-view";
import type { MenuCategory } from "@/server/catalog/queries";

const SP = "America/Sao_Paulo";
const NOW = new Date("2026-10-06T21:00:00Z"); // ter 18:00
const at = (iso: string) => new Date(iso);

describe("relógio", () => {
  it("clock e shortClock", () => {
    expect(clock(1080)).toBe("18:00");
    expect(clock(1440)).toBe("00:00");
    expect(clock(65)).toBe("01:05");
    expect(shortClock(1080)).toBe("18h");
    expect(shortClock(1110)).toBe("18h30");
  });
});

describe("storefrontNote", () => {
  it("disponível não tem nota", () => {
    expect(storefrontNote({ state: "available" }, NOW, SP)).toBeNull();
  });
  it("pausa até a meia-noite = Esgotado hoje; mais longa = Esgotado", () => {
    expect(storefrontNote({ state: "paused", until: at("2026-10-07T03:00:00Z") }, NOW, SP)).toBe("Esgotado hoje");
    expect(storefrontNote({ state: "paused", until: at("2026-10-09T03:00:00Z") }, NOW, SP)).toBe("Esgotado");
  });
  it("fora do horário: mesmo dia, outro dia e sem retorno", () => {
    expect(storefrontNote({ state: "out_of_hours", nextOpensAt: at("2026-10-06T22:00:00Z") }, NOW, SP)).toBe(
      "Disponível a partir das 19:00",
    );
    expect(storefrontNote({ state: "out_of_hours", nextOpensAt: at("2026-10-13T21:00:00Z") }, NOW, SP)).toBe(
      "Disponível às terças, 18:00",
    );
    expect(storefrontNote({ state: "out_of_hours", nextOpensAt: null }, NOW, SP)).toBe("Indisponível no momento");
  });
});

describe("panelBadge", () => {
  const base = { active: true, availability: { state: "available" } as const };
  it("arquivado vence tudo; disponível não tem selo", () => {
    expect(panelBadge({ active: false, availability: { state: "paused", until: at("2026-10-07T03:00:00Z") } }, NOW, SP)).toBe("Arquivado");
    expect(panelBadge(base, NOW, SP)).toBeNull();
  });
  it("pausado e fora do horário", () => {
    expect(panelBadge({ active: true, availability: { state: "paused", until: at("2026-10-07T03:00:00Z") } }, NOW, SP)).toBe("Pausado até 00:00");
    expect(panelBadge({ active: true, availability: { state: "paused", until: at("2026-10-09T03:00:00Z") } }, NOW, SP)).toBe("Pausado");
    expect(panelBadge({ active: true, availability: { state: "out_of_hours", nextOpensAt: at("2026-10-06T22:00:00Z") } }, NOW, SP)).toBe(
      "Fora do horário · volta às 19h",
    );
    expect(panelBadge({ active: true, availability: { state: "out_of_hours", nextOpensAt: null } }, NOW, SP)).toBe("Fora do horário");
  });
});

describe("groupRule", () => {
  it("texto em linguagem normal", () => {
    expect(groupRule(1, 1)).toBe("Obrigatório, escolha 1");
    expect(groupRule(2, 2)).toBe("Obrigatório, escolha 2");
    expect(groupRule(1, 3)).toBe("Obrigatório, escolha de 1 a 3");
    expect(groupRule(0, 3)).toBe("Opcional, até 3");
  });
});

describe("crossesMidnight", () => {
  it("fechar antes ou na hora de abrir cruza; 00:00 ao fechar é meia-noite do mesmo dia", () => {
    expect(crossesMidnight("22:00", "02:00")).toBe(true);
    expect(crossesMidnight("11:00", "15:00")).toBe(false);
    expect(crossesMidnight("18:00", "00:00")).toBe(false);
    expect(crossesMidnight("", "02:00")).toBe(false);
  });
});

describe("dieta", () => {
  const product = (id: string, dietary: string[]) => ({
    id, categoryId: "c", name: id, description: "", imageUrl: null, dietary,
    variants: [], fromPriceCents: 0, multiplePrices: false, optionGroups: [],
    availability: { state: "available" } as const,
  });
  const menu: MenuCategory[] = [
    { id: "c1", name: "A", products: [product("p1", ["vegan", "spicy"]), product("p2", [])] },
    { id: "c2", name: "B", products: [product("p3", ["gluten_free"])] },
  ];
  it("parseDietaryParam ignora lixo", () => {
    expect(parseDietaryParam("vegan")).toBe("vegan");
    expect(parseDietaryParam("xyz")).toBeUndefined();
    expect(parseDietaryParam(undefined)).toBeUndefined();
  });
  it("só lista etiquetas existentes, na ordem fixa", () => {
    expect(dietaryTagsIn(menu)).toEqual(["vegan", "gluten_free", "spicy"]);
  });
  it("filtra e remove categoria que ficou vazia", () => {
    const out = filterMenuByDietary(menu, "gluten_free");
    expect(out.map((c) => c.id)).toEqual(["c2"]);
    expect(filterMenuByDietary(menu, undefined)).toBe(menu);
  });
});
```

`tests/catalog/forms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCategoryForm, parseGroupForm, parseProductForm, parseScheduleForm, timeToMinutes } from "@/server/catalog/forms";

function form(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

describe("timeToMinutes", () => {
  it("converte HH:MM; 00:00 ao fechar é 1440", () => {
    expect(timeToMinutes("11:30", false)).toBe(690);
    expect(timeToMinutes("00:00", false)).toBe(0);
    expect(timeToMinutes("00:00", true)).toBe(1440);
    expect(timeToMinutes("02:00", true)).toBe(120);
  });
  it.each(["", "24:00", "9:00", "10:60", "abc"])("%j → null", (raw) => expect(timeToMinutes(raw, false)).toBeNull());
});

describe("parseProductForm", () => {
  const base: [string, string][] = [
    ["categoryId", "cat"], ["name", " Açaí "], ["description", ""], ["imageUrl", "  "],
    ["variantId", ""], ["variantName", "300ml"], ["variantPrice", "R$ 15,5"],
    ["variantId", "v2"], ["variantName", "500ml"], ["variantPrice", "1.234,50"],
    ["dietary", "vegan"], ["optionGroupIds", "g1"], ["scheduleIds", "s1"],
  ];
  it("monta o produto com centavos, ids opcionais e imagem vazia = null", () => {
    expect(parseProductForm(form(base))).toEqual({
      ok: true,
      input: {
        categoryId: "cat", name: " Açaí ", description: "", imageUrl: null,
        dietary: ["vegan"], optionGroupIds: ["g1"], scheduleIds: ["s1"],
        variants: [
          { name: "300ml", priceCents: 1550 },
          { id: "v2", name: "500ml", priceCents: 123450 },
        ],
      },
    });
  });
  it("ignora linha totalmente em branco", () => {
    const fd = form([...base, ["variantId", ""], ["variantName", ""], ["variantPrice", " "]]);
    const out = parseProductForm(fd);
    expect(out.ok && (out.input as { variants: unknown[] }).variants).toHaveLength(2);
  });
  it("preço inválido ou vazio devolve preco", () => {
    expect(parseProductForm(form([["variantId", ""], ["variantName", "x"], ["variantPrice", "abc"]]))).toEqual({ ok: false, reason: "preco" });
    expect(parseProductForm(form([["variantId", ""], ["variantName", "x"], ["variantPrice", ""]]))).toEqual({ ok: false, reason: "preco" });
  });
});

describe("parseGroupForm", () => {
  it("acréscimo em branco vale 0; números viram number", () => {
    const out = parseGroupForm(
      form([
        ["name", "Adicionais"], ["minSelect", "0"], ["maxSelect", "2"],
        ["itemId", ""], ["itemName", "Granola"], ["itemPrice", "2,00"],
        ["itemId", "i2"], ["itemName", "Banana"], ["itemPrice", ""],
      ]),
    );
    expect(out).toEqual({
      ok: true,
      input: {
        name: "Adicionais", minSelect: 0, maxSelect: 2,
        items: [{ name: "Granola", priceDeltaCents: 200 }, { id: "i2", name: "Banana", priceDeltaCents: 0 }],
      },
    });
  });
  it("acréscimo inválido devolve preco", () => {
    expect(parseGroupForm(form([["name", "x"], ["minSelect", "0"], ["maxSelect", "1"], ["itemId", ""], ["itemName", "a"], ["itemPrice", "x"]]))).toEqual({ ok: false, reason: "preco" });
  });
});

describe("parseScheduleForm", () => {
  it("converte janelas em minutos, com 00:00 ao fechar = 1440", () => {
    const out = parseScheduleForm(
      form([
        ["name", "Jantar"],
        ["winDay", "1"], ["winOpens", "18:00"], ["winCloses", "00:00"],
        ["winDay", "5"], ["winOpens", "22:00"], ["winCloses", "02:00"],
      ]),
    );
    expect(out).toEqual({
      ok: true,
      input: {
        name: "Jantar",
        windows: [
          { weekday: 1, opensMin: 1080, closesMin: 1440 },
          { weekday: 5, opensMin: 1320, closesMin: 120 },
        ],
      },
    });
  });
  it("hora inválida devolve horario", () => {
    expect(parseScheduleForm(form([["name", "x"], ["winDay", "1"], ["winOpens", "25:00"], ["winCloses", "02:00"]]))).toEqual({ ok: false, reason: "horario" });
  });
});

describe("parseCategoryForm", () => {
  it("nome e horários", () => {
    expect(parseCategoryForm(form([["name", "Lanches"], ["scheduleIds", "s1"], ["scheduleIds", "s2"]]))).toEqual({
      name: "Lanches",
      scheduleIds: ["s1", "s2"],
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/catalog/money.test.ts tests/catalog/order.test.ts tests/catalog/view.test.ts tests/catalog/forms.test.ts`
Expected: FAIL (`centsToInput`/módulos inexistentes).

- [ ] **Step 3: Implementar** — acrescentar a `src/lib/money.ts`:

```ts
/** Centavos → texto editável em reais, sem símbolo: 1250 → "12,50". */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
```

`src/server/catalog/order.ts`:

```ts
/** Troca `id` com o vizinho. `null` se o id não existe ou já está no limite. */
export function moveId(ids: string[], id: string, dir: "up" | "down"): string[] | null {
  const i = ids.indexOf(id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i === -1 || j < 0 || j >= ids.length) return null;
  const next = ids.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
```

`src/lib/catalog-view.ts`:

```ts
import type { Availability } from "@/server/catalog/availability";
import type { MenuCategory } from "@/server/catalog/queries";
import { DIETARY, type Dietary } from "@/server/catalog/schemas";
import { localParts, startOfNextLocalDay } from "@/server/catalog/time";

export const DIETARY_LABEL: Record<Dietary, string> = {
  vegan: "Vegano",
  vegetarian: "Vegetariano",
  gluten_free: "Sem glúten",
  lactose_free: "Sem lactose",
  contains_peanut: "Contém amendoim",
  contains_nuts: "Contém castanhas",
  contains_egg: "Contém ovo",
  contains_shellfish: "Contém frutos do mar",
  spicy: "Picante",
};

export const WEEKDAY_LABEL = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;
const WEEKDAY_AT = ["aos domingos", "às segundas", "às terças", "às quartas", "às quintas", "às sextas", "aos sábados"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** 1080 → "18:00"; 1440 → "00:00". */
export function clock(min: number): string {
  return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
}

/** 1080 → "18h"; 1110 → "18h30". */
export function shortClock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h${pad(m)}`;
}

function sameLocalDay(a: Date, b: Date, tz: string): boolean {
  const x = localParts(a, tz);
  const y = localParts(b, tz);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

function pausedUntilTonight(until: Date, now: Date, tz: string): boolean {
  return until <= startOfNextLocalDay(now, tz);
}

/** Nota sob o item esmaecido na vitrine. `null` = disponível. */
export function storefrontNote(av: Availability, now: Date, tz: string): string | null {
  if (av.state === "available") return null;
  if (av.state === "paused") return pausedUntilTonight(av.until, now, tz) ? "Esgotado hoje" : "Esgotado";
  if (!av.nextOpensAt) return "Indisponível no momento";
  const p = localParts(av.nextOpensAt, tz);
  if (sameLocalDay(av.nextOpensAt, now, tz)) return `Disponível a partir das ${clock(p.minute)}`;
  return `Disponível ${WEEKDAY_AT[p.weekday]}, ${clock(p.minute)}`;
}

/** Selo de estado na linha do painel. `null` = sem selo. */
export function panelBadge(
  p: { active: boolean; availability: Availability },
  now: Date,
  tz: string,
): string | null {
  if (!p.active) return "Arquivado";
  const av = p.availability;
  if (av.state === "available") return null;
  if (av.state === "paused") {
    return pausedUntilTonight(av.until, now, tz) ? `Pausado até ${clock(localParts(av.until, tz).minute)}` : "Pausado";
  }
  if (!av.nextOpensAt) return "Fora do horário";
  const parts = localParts(av.nextOpensAt, tz);
  const when = sameLocalDay(av.nextOpensAt, now, tz)
    ? `às ${shortClock(parts.minute)}`
    : `${WEEKDAY_AT[parts.weekday]}, ${shortClock(parts.minute)}`;
  return `Fora do horário · volta ${when}`;
}

/** Regra de um grupo de opções em linguagem normal. */
export function groupRule(min: number, max: number): string {
  if (min >= 1) return min === max ? `Obrigatório, escolha ${min}` : `Obrigatório, escolha de ${min} a ${max}`;
  return `Opcional, até ${max}`;
}

/** Janela que fecha antes (ou na hora) de abrir termina no dia seguinte. "00:00" ao fechar é a meia-noite do mesmo dia. */
export function crossesMidnight(opens: string, closes: string): boolean {
  return opens !== "" && closes !== "" && closes !== "00:00" && closes <= opens;
}

export function parseDietaryParam(value: string | undefined): Dietary | undefined {
  return value !== undefined && (DIETARY as readonly string[]).includes(value) ? (value as Dietary) : undefined;
}

/** Etiquetas que existem no cardápio, na ordem fixa de DIETARY. */
export function dietaryTagsIn(menu: MenuCategory[]): Dietary[] {
  const present = new Set(menu.flatMap((c) => c.products.flatMap((p) => p.dietary)));
  return DIETARY.filter((tag) => present.has(tag));
}

export function filterMenuByDietary(menu: MenuCategory[], tag: Dietary | undefined): MenuCategory[] {
  if (!tag) return menu;
  return menu
    .map((c) => ({ ...c, products: c.products.filter((p) => p.dietary.includes(tag)) }))
    .filter((c) => c.products.length > 0);
}
```

`src/server/catalog/forms.ts`:

```ts
import { parseBRL } from "@/lib/money";

export type FormFail = { ok: false; reason: "preco" | "horario" };
export type Parsed = { ok: true; input: unknown } | FormFail;

export function formText(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

function formTexts(fd: FormData, key: string): string[] {
  return fd.getAll(key).filter((v): v is string => typeof v === "string");
}

interface PriceRow {
  id?: string;
  name: string;
  cents: number;
}

/** Linhas paralelas `${p}Id[]`, `${p}Name[]`, `${p}Price[]`. Linha toda em branco é ignorada. */
function priceRows(fd: FormData, p: "variant" | "item", blankPriceIsZero: boolean): PriceRow[] | null {
  const ids = formTexts(fd, `${p}Id`);
  const names = formTexts(fd, `${p}Name`);
  const prices = formTexts(fd, `${p}Price`);
  const rows: PriceRow[] = [];
  for (const [i, rawName] of names.entries()) {
    const name = rawName.trim();
    const price = (prices[i] ?? "").trim();
    if (name === "" && price === "") continue;
    const cents = price === "" ? (blankPriceIsZero ? 0 : null) : parseBRL(price);
    if (cents === null) return null;
    rows.push({ id: ids[i] || undefined, name, cents });
  }
  return rows;
}

export function parseProductForm(fd: FormData): Parsed {
  const rows = priceRows(fd, "variant", false);
  if (!rows) return { ok: false, reason: "preco" };
  return {
    ok: true,
    input: {
      categoryId: formText(fd, "categoryId"),
      name: formText(fd, "name"),
      description: formText(fd, "description"),
      imageUrl: formText(fd, "imageUrl").trim() || null,
      dietary: formTexts(fd, "dietary"),
      optionGroupIds: formTexts(fd, "optionGroupIds"),
      scheduleIds: formTexts(fd, "scheduleIds"),
      variants: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name, priceCents: r.cents })),
    },
  };
}

export function parseGroupForm(fd: FormData): Parsed {
  const rows = priceRows(fd, "item", true);
  if (!rows) return { ok: false, reason: "preco" };
  return {
    ok: true,
    input: {
      name: formText(fd, "name"),
      minSelect: Number(formText(fd, "minSelect")),
      maxSelect: Number(formText(fd, "maxSelect")),
      items: rows.map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name, priceDeltaCents: r.cents })),
    },
  };
}

/** "HH:MM" → minutos desde a meia-noite. Ao fechar, "00:00" vale 1440 (fim do dia). */
export function timeToMinutes(raw: string, closing: boolean): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return closing && min === 0 ? 1440 : min;
}

export function parseScheduleForm(fd: FormData): Parsed {
  const days = formTexts(fd, "winDay");
  const opens = formTexts(fd, "winOpens");
  const closes = formTexts(fd, "winCloses");
  const windows: { weekday: number; opensMin: number; closesMin: number }[] = [];
  for (const [i, day] of days.entries()) {
    const o = (opens[i] ?? "").trim();
    const c = (closes[i] ?? "").trim();
    if (o === "" && c === "") continue;
    const opensMin = timeToMinutes(o, false);
    const closesMin = timeToMinutes(c, true);
    if (opensMin === null || closesMin === null) return { ok: false, reason: "horario" };
    windows.push({ weekday: Number(day), opensMin, closesMin });
  }
  return { ok: true, input: { name: formText(fd, "name"), windows } };
}

export function parseCategoryForm(fd: FormData): { name: string; scheduleIds: string[] } {
  return { name: formText(fd, "name"), scheduleIds: formTexts(fd, "scheduleIds") };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/catalog/money.test.ts tests/catalog/order.test.ts tests/catalog/view.test.ts tests/catalog/forms.test.ts`
Expected: PASS. (Se algum caso de fuso falhar, depure `catalog-view.ts`; não ajuste o teste.)

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint
git add src/lib src/server/catalog/order.ts src/server/catalog/forms.ts tests/catalog
git commit -m "feat(catalog): helpers puros de rótulos, ordem e formulários"
```

---

### Task 3: Autorização, primitivos de UI e casca do catálogo

**Files:**
- Create: `src/server/catalog/authz.ts`, `src/components/ui/textarea.tsx`, `src/components/ui/select.tsx`, `src/components/ui/checkbox.tsx`, `src/components/ui/badge.tsx`
- Create: `src/app/panel/(shell)/catalogo/layout.tsx`, `catalogo/_actions/shared.ts`, `catalogo/_components/flash.tsx`, `catalogo/_components/field.tsx`, `catalogo/_components/action-button.tsx`

**Interfaces:**
- Produces (`authz.ts`): `interface CatalogAuth { ctx: Ctx; role: Role; timezone: string; vertical: Vertical; slug: string }`; `authorizeCatalog(action: "catalog:edit" | "stock:edit"): Promise<CatalogAuth>` (redireciona para `/login` sem sessão e para `/` sem permissão — via `requireAction`).
- Produces (`_actions/shared.ts`): `failCode(r: Result | FormFail): string` (`nao_encontrado` | `invalido` | `preco` | `horario`); `seg(id: string): string` (`encodeURIComponent`).
- Produces (componentes): `Flash({ erro, salvo })`, `Field({ id, label, hint, children })`, `ActionButton({ action, fields, label, children, variant?, className?, disabled? })`; `Textarea`, `Select` (nativo estilizado), `Checkbox` (nativo), `Badge({ variant: "default" | "outline" | "accent" })`.

Sem teste unitário próprio: `authorizeCatalog` e os componentes são exercitados pelo e2e da Task 9; aqui o gate é `typecheck` + `lint`.

- [ ] **Step 1: `authz.ts`**

```ts
import { redirect } from "next/navigation";
import type { Role } from "@/server/auth/can";
import { requireAction } from "@/server/auth/staff";
import { findTenantBySegment } from "@/server/tenancy/lookup";
import type { Ctx } from "./commands";
import { TEMPLATES, type Vertical } from "./templates";

export interface CatalogAuth {
  ctx: Ctx;
  role: Role;
  timezone: string;
  vertical: Vertical;
  slug: string;
}

/**
 * Única porta de entrada de páginas e Server Actions do catálogo.
 * Papel e loja vêm do banco a cada request (requireAction), nunca do formulário.
 */
export async function authorizeCatalog(action: "catalog:edit" | "stock:edit"): Promise<CatalogAuth> {
  const staff = await requireAction(action);
  const tenant = await findTenantBySegment(staff.active.slug);
  if (!tenant || tenant.id !== staff.active.tenantId) redirect("/");
  return {
    ctx: { tenantId: tenant.id, actor: `staff:${staff.staffId}` },
    role: staff.active.role,
    timezone: tenant.timezone,
    vertical: Object.hasOwn(TEMPLATES, tenant.vertical) ? (tenant.vertical as Vertical) : "restaurante",
    slug: tenant.slug,
  };
}
```

- [ ] **Step 2: Primitivos Shadcn** (mesmo estilo de `input.tsx`)

`src/components/ui/textarea.tsx`:

```tsx
import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-all duration-200 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
```

`src/components/ui/select.tsx` (select nativo: acessível, sem JS, ótimo no celular):

```tsx
import * as React from "react"
import { cn } from "cn"

function Select({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-base transition-all duration-200 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 dark:[&>option]:bg-zinc-900",
        className
      )}
      {...props}
    />
  )
}

export { Select }
```

`src/components/ui/checkbox.tsx`:

```tsx
import * as React from "react"
import { cn } from "cn"

function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "size-5 shrink-0 rounded border border-input accent-primary transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Checkbox }
```

`src/components/ui/badge.tsx`:

```tsx
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all duration-200",
  {
    variants: {
      variant: {
        default:
          "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
        outline: "border-zinc-200 text-zinc-500 dark:border-zinc-800",
        accent: "border-transparent bg-primary text-primary-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
```

- [ ] **Step 3: Helpers e componentes do catálogo**

`src/app/panel/(shell)/catalogo/_actions/shared.ts`:

```ts
import type { Result } from "@/server/catalog/commands";
import type { FormFail } from "@/server/catalog/forms";

/** Código curto de erro que viaja em `?erro=` (a página traduz em texto). */
export function failCode(r: Result | FormFail): string {
  if (r.ok) return "";
  if (r.reason === "not_found") return "nao_encontrado";
  if (r.reason === "invalid") return "invalido";
  return r.reason;
}

/** Id vindo de formulário entra em URL sempre codificado. */
export function seg(id: string): string {
  return encodeURIComponent(id);
}
```

`catalogo/_components/flash.tsx`:

```tsx
const ERRORS = {
  invalido: "Confira os campos e tente de novo.",
  nao_encontrado: "Esse item não existe mais.",
  preco: "Preço inválido. Use o formato 12,50.",
  horario: "Horário inválido. Use HH:MM.",
  nao_vazio: "O catálogo já tem categorias, então o modelo não foi aplicado.",
} as const;

export function Flash({ erro, salvo }: { erro?: string; salvo?: boolean }) {
  const message = erro && Object.hasOwn(ERRORS, erro) ? ERRORS[erro as keyof typeof ERRORS] : undefined;
  if (message) {
    return (
      <p role="alert" className="mb-6 text-sm text-red-600 dark:text-red-400">
        {message}
      </p>
    );
  }
  if (salvo) {
    return (
      <p role="status" className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Salvo.
      </p>
    );
  }
  return null;
}
```

`catalogo/_components/field.tsx`:

```tsx
import { Label } from "@/components/ui/label";

export function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-sm text-zinc-500">{hint}</p> : null}
    </div>
  );
}
```

`catalogo/_components/action-button.tsx`:

```tsx
import { Button } from "@/components/ui/button";

type Variant = "default" | "outline" | "ghost" | "destructive";

/** Formulário de um botão só: Server Action + campos ocultos. Funciona sem JS. */
export function ActionButton({
  action,
  fields,
  label,
  children,
  variant = "ghost",
  className,
  disabled,
}: {
  action: (formData: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: string;
  children: React.ReactNode;
  variant?: Variant;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <form action={action}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button
        type="submit"
        variant={variant}
        aria-label={label}
        title={label}
        disabled={disabled}
        className={`h-10 min-w-10 transition-all duration-200 ${className ?? ""}`}
      >
        {children}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Sub-navegação do catálogo** — `catalogo/layout.tsx`:

```tsx
import Link from "next/link";
import { can } from "@/server/auth/can";
import { authorizeCatalog } from "@/server/catalog/authz";

const TAB =
  "text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default async function CatalogLayout({ children }: { children: React.ReactNode }) {
  const { role } = await authorizeCatalog("stock:edit");
  const canEdit = can(role, "catalog:edit");
  return (
    <div>
      <nav aria-label="Catálogo" className="mb-10 flex items-center gap-6 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <Link href="/catalogo" className={TAB}>
          Produtos
        </Link>
        {canEdit ? (
          <>
            <Link href="/catalogo/opcoes" className={TAB}>
              Opções
            </Link>
            <Link href="/catalogo/horarios" className={TAB}>
              Horários
            </Link>
          </>
        ) : null}
      </nav>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Verificar e commitar**

Run: `npm run typecheck && npm run lint`
Expected: limpo (nenhuma rota usa os componentes ainda).

```bash
git add src/server/catalog/authz.ts src/components/ui "src/app/panel/(shell)/catalogo"
git commit -m "feat(catalog): authorizeCatalog, primitivos de UI e casca do catálogo"
```

---

### Task 4: Lista do catálogo, categorias e ações de linha

**Files:**
- Create: `src/app/panel/(shell)/catalogo/page.tsx`, `catalogo/_actions/list.ts`, `catalogo/_components/product-row.tsx`, `catalogo/_components/category-form.tsx`, `catalogo/categorias/nova/page.tsx`, `catalogo/categorias/[id]/page.tsx`

**Interfaces:**
- Consumes: `authorizeCatalog`, `Flash`, `Field`, `ActionButton`, `Badge`, `Select`, `Checkbox` (Task 3); `listForPanel`, `PanelCategory`, `PanelProduct`, `PanelSchedule` (`@/server/catalog/queries`); `panelBadge`, `DIETARY_LABEL` (Task 2); `moveId` (Task 2); `parseCategoryForm`, `formText` (Task 2); comandos `createCategory`, `updateCategory`, `setCategoryActive`, `duplicateCategory`, `setProductActive`, `duplicateProduct`, `pauseProduct`, `reorderCategories`, `reorderProducts`, `applyTemplate`; `startOfNextLocalDay`.
- Produces (`_actions/list.ts`, `"use server"`, todas `(fd: FormData) => Promise<void>` salvo indicado): `applyTemplateAction()`, `pauseProductAction` (`id`, `mode` = `pause|resume`; **`stock:edit`**), `moveProductAction` (`categoryId`, `id`, `dir`), `moveCategoryAction` (`id`, `dir`), `setProductActiveAction` (`id`, `active` = `1|0`), `duplicateProductAction` (`id`), `setCategoryActiveAction` (`id`, `active`), `duplicateCategoryAction` (`id`), `createCategoryAction` (campos de `parseCategoryForm`), `updateCategoryAction` (+ `id`).
- Produces: componentes `ProductRow`, `CategoryForm` (props em `Step 3`/`Step 5`).

- [ ] **Step 1: Ações** — `catalogo/_actions/list.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { authorizeCatalog } from "@/server/catalog/authz";
import {
  createCategory, duplicateCategory, duplicateProduct, pauseProduct, reorderCategories,
  reorderProducts, setCategoryActive, setProductActive, updateCategory,
} from "@/server/catalog/commands";
import { formText, parseCategoryForm } from "@/server/catalog/forms";
import { moveId } from "@/server/catalog/order";
import { listForPanel } from "@/server/catalog/queries";
import { applyTemplate } from "@/server/catalog/templates";
import { startOfNextLocalDay } from "@/server/catalog/time";
import { failCode, seg } from "./shared";

const LIST = "/catalogo";

function listResult(r: { ok: boolean }, code: string): never {
  return redirect(r.ok ? LIST : `${LIST}?erro=${code}`);
}

const dirOf = (fd: FormData): "up" | "down" => (formText(fd, "dir") === "up" ? "up" : "down");

export async function applyTemplateAction(): Promise<void> {
  const { ctx, vertical } = await authorizeCatalog("catalog:edit");
  const r = await applyTemplate(ctx, vertical);
  redirect(r.ok ? LIST : `${LIST}?erro=nao_vazio`);
}

/** Pausar/retomar só exige stock:edit: o atendente no balcão pausa sem poder editar preço. */
export async function pauseProductAction(fd: FormData): Promise<void> {
  const { ctx, timezone } = await authorizeCatalog("stock:edit");
  const until = formText(fd, "mode") === "resume" ? null : startOfNextLocalDay(new Date(), timezone);
  const r = await pauseProduct(ctx, formText(fd, "id"), until);
  listResult(r, failCode(r));
}

export async function moveProductAction(fd: FormData): Promise<void> {
  const { ctx, timezone } = await authorizeCatalog("catalog:edit");
  const categoryId = formText(fd, "categoryId");
  const { categories } = await listForPanel(ctx.tenantId, new Date(), timezone);
  const category = categories.find((c) => c.id === categoryId);
  const next = category ? moveId(category.products.map((p) => p.id), formText(fd, "id"), dirOf(fd)) : null;
  if (!next) redirect(LIST); // já no limite: nada a fazer
  const r = await reorderProducts(ctx, categoryId, next);
  listResult(r, failCode(r));
}

export async function moveCategoryAction(fd: FormData): Promise<void> {
  const { ctx, timezone } = await authorizeCatalog("catalog:edit");
  const { categories } = await listForPanel(ctx.tenantId, new Date(), timezone);
  const next = moveId(categories.map((c) => c.id), formText(fd, "id"), dirOf(fd));
  if (!next) redirect(LIST);
  const r = await reorderCategories(ctx, next);
  listResult(r, failCode(r));
}

export async function setProductActiveAction(fd: FormData): Promise<void> {
  const { ctx } = await authorizeCatalog("catalog:edit");
  const r = await setProductActive(ctx, formText(fd, "id"), formText(fd, "active") === "1");
  listResult(r, failCode(r));
}

export async function duplicateProductAction(fd: FormData): Promise<void> {
  const { ctx } = await authorizeCatalog("catalog:edit");
  const r = await duplicateProduct(ctx, formText(fd, "id"));
  redirect(r.ok ? `${LIST}/produtos/${seg(r.id)}?salvo=1` : `${LIST}?erro=${failCode(r)}`);
}

export async function setCategoryActiveAction(fd: FormData): Promise<void> {
  const { ctx } = await authorizeCatalog("catalog:edit");
  const r = await setCategoryActive(ctx, formText(fd, "id"), formText(fd, "active") === "1");
  listResult(r, failCode(r));
}

export async function duplicateCategoryAction(fd: FormData): Promise<void> {
  const { ctx } = await authorizeCatalog("catalog:edit");
  const r = await duplicateCategory(ctx, formText(fd, "id"));
  listResult(r, failCode(r));
}

export async function createCategoryAction(fd: FormData): Promise<void> {
  const { ctx } = await authorizeCatalog("catalog:edit");
  const r = await createCategory(ctx, parseCategoryForm(fd));
  redirect(r.ok ? LIST : `${LIST}/categorias/nova?erro=${failCode(r)}`);
}

export async function updateCategoryAction(fd: FormData): Promise<void> {
  const { ctx } = await authorizeCatalog("catalog:edit");
  const id = formText(fd, "id");
  const r = await updateCategory(ctx, id, parseCategoryForm(fd));
  redirect(`${LIST}/categorias/${seg(id)}?${r.ok ? "salvo=1" : `erro=${failCode(r)}`}`);
}
```

- [ ] **Step 2: Formulário de categoria** — `catalogo/_components/category-form.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { PanelSchedule } from "@/server/catalog/queries";
import { Field } from "./field";

export function CategoryForm({
  action,
  schedules,
  category,
}: {
  action: (formData: FormData) => Promise<void>;
  schedules: PanelSchedule[];
  category?: { id: string; name: string; scheduleIds: string[] };
}) {
  return (
    <form action={action} className="max-w-xl space-y-8">
      {category ? <input type="hidden" name="id" value={category.id} /> : null}
      <Field id="name" label="Nome da categoria">
        <Input id="name" name="name" required maxLength={80} defaultValue={category?.name} className="h-11" />
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Horários</legend>
        <p className="text-sm text-zinc-500">
          Nenhum marcado: a categoria fica sempre disponível. Produtos com horário próprio ignoram este.
        </p>
        {schedules.length === 0 ? <p className="text-sm text-zinc-500">Você ainda não criou horários.</p> : null}
        {schedules.map((s) => (
          <label key={s.id} className="flex min-h-10 items-center gap-3 text-sm">
            <Checkbox name="scheduleIds" value={s.id} defaultChecked={category?.scheduleIds.includes(s.id)} />
            {s.name}
          </label>
        ))}
      </fieldset>

      <Button type="submit" className="h-11 transition-all duration-200">
        Salvar categoria
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Linha de produto** — `catalogo/_components/product-row.tsx`:

```tsx
import Link from "next/link";
import { ArrowDown, ArrowUp, Copy, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DIETARY_LABEL, panelBadge } from "@/lib/catalog-view";
import { formatBRL } from "@/lib/money";
import type { PanelProduct } from "@/server/catalog/queries";
import type { Dietary } from "@/server/catalog/schemas";
import { duplicateProductAction, moveProductAction, pauseProductAction } from "../_actions/list";
import { ActionButton } from "./action-button";

const EDIT_LINK =
  "inline-flex h-10 min-w-10 items-center justify-center rounded-lg px-2.5 text-sm transition-all duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function ProductRow({
  product,
  canEdit,
  now,
  timezone,
}: {
  product: PanelProduct;
  canEdit: boolean;
  now: Date;
  timezone: string;
}) {
  const badge = panelBadge(product, now, timezone);
  const paused = product.availability.state === "paused";
  const price = product.multiplePrices
    ? `a partir de ${formatBRL(product.fromPriceCents)}`
    : formatBRL(product.fromPriceCents);

  return (
    <li className="flex flex-col gap-4 border-b border-zinc-200 py-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
      <div className="min-w-0 space-y-2">
        <p className={`font-medium ${product.active ? "" : "text-zinc-500"}`}>{product.name}</p>
        <p className="text-sm text-zinc-500">{price}</p>
        <div className="flex flex-wrap gap-2">
          {badge ? <Badge variant="accent">{badge}</Badge> : null}
          {product.dietary.map((tag) => (
            <Badge key={tag} variant="outline">
              {DIETARY_LABEL[tag as Dietary] ?? tag}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {product.active ? (
          <ActionButton
            action={pauseProductAction}
            fields={{ id: product.id, mode: paused ? "resume" : "pause" }}
            label={paused ? "Voltar a vender" : "Esgotado hoje"}
            variant={paused ? "default" : "outline"}
            className="px-3"
          >
            {paused ? "Voltar a vender" : "Esgotado hoje"}
          </ActionButton>
        ) : null}
        {canEdit ? (
          <>
            <Link href={`/catalogo/produtos/${encodeURIComponent(product.id)}`} className={EDIT_LINK} aria-label="Editar">
              <Pencil className="size-4" />
            </Link>
            <ActionButton action={duplicateProductAction} fields={{ id: product.id }} label="Duplicar">
              <Copy className="size-4" />
            </ActionButton>
            <ActionButton action={moveProductAction} fields={{ categoryId: product.categoryId, id: product.id, dir: "up" }} label="Subir">
              <ArrowUp className="size-4" />
            </ActionButton>
            <ActionButton action={moveProductAction} fields={{ categoryId: product.categoryId, id: product.id, dir: "down" }} label="Descer">
              <ArrowDown className="size-4" />
            </ActionButton>
          </>
        ) : null}
      </div>
    </li>
  );
}
```

- [ ] **Step 4: Página da lista** — `catalogo/page.tsx`:

```tsx
import Link from "next/link";
import { ArrowDown, ArrowUp, Copy, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { first } from "@/lib/search-params";
import { can } from "@/server/auth/can";
import { authorizeCatalog } from "@/server/catalog/authz";
import { listForPanel } from "@/server/catalog/queries";
import { applyTemplateAction, duplicateCategoryAction, moveCategoryAction, setCategoryActiveAction } from "./_actions/list";
import { ActionButton } from "./_components/action-button";
import { Flash } from "./_components/flash";
import { ProductRow } from "./_components/product-row";

const VERTICAL_NAME = {
  restaurante: "restaurante",
  lanchonete: "lanchonete",
  acaiteria: "açaíteria",
  quiosque: "quiosque",
} as const;

const LINK =
  "inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm transition-all duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string | string[] }>;
}) {
  const { ctx, role, timezone, vertical } = await authorizeCatalog("stock:edit");
  const canEdit = can(role, "catalog:edit");
  const now = new Date();
  const { categories } = await listForPanel(ctx.tenantId, now, timezone);
  const erro = first((await searchParams).erro);

  if (categories.length === 0) {
    return (
      <main>
        <Flash erro={erro} />
        <h1 className="text-4xl font-bold tracking-tight">Seu cardápio começa aqui</h1>
        {canEdit ? (
          <>
            <p className="mt-3 max-w-lg leading-relaxed text-zinc-500">
              Comece com um modelo de {VERTICAL_NAME[vertical]} e ajuste do seu jeito, ou cadastre tudo do zero.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3">
              <form action={applyTemplateAction}>
                <Button type="submit" className="h-11 transition-all duration-200">
                  Começar com um modelo
                </Button>
              </form>
              <Link href="/catalogo/categorias/nova" className={LINK}>
                <Plus className="size-4" />
                Criar categoria do zero
              </Link>
            </div>
          </>
        ) : (
          <p className="mt-3 leading-relaxed text-zinc-500">Nenhum item cadastrado ainda.</p>
        )}
      </main>
    );
  }

  return (
    <main>
      <Flash erro={erro} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-4xl font-bold tracking-tight">Produtos</h1>
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Link href="/catalogo/categorias/nova" className={LINK}>
              <Plus className="size-4" />
              Nova categoria
            </Link>
            <Button asChild className="h-10 transition-all duration-200">
              <Link href="/catalogo/produtos/novo">Novo produto</Link>
            </Button>
          </div>
        ) : null}
      </div>
      {!canEdit ? (
        <p className="mt-3 text-sm text-zinc-500">Você pode pausar itens que acabaram. Edição é com o dono ou gerente.</p>
      ) : null}

      <div className="mt-12 space-y-16">
        {categories.map((category) => (
          <section key={category.id} aria-labelledby={`cat-${category.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
              <div className="flex items-center gap-3">
                <h2 id={`cat-${category.id}`} className="text-xl font-bold tracking-tight">
                  {category.name}
                </h2>
                {!category.active ? <Badge variant="outline">Arquivada</Badge> : null}
              </div>
              {canEdit ? (
                <div className="flex flex-wrap items-center gap-1">
                  <Link href={`/catalogo/produtos/novo?categoria=${encodeURIComponent(category.id)}`} className={LINK}>
                    <Plus className="size-4" />
                    Produto
                  </Link>
                  <Link href={`/catalogo/categorias/${encodeURIComponent(category.id)}`} className={LINK} aria-label="Editar categoria">
                    <Pencil className="size-4" />
                  </Link>
                  <ActionButton action={duplicateCategoryAction} fields={{ id: category.id }} label="Duplicar categoria">
                    <Copy className="size-4" />
                  </ActionButton>
                  <ActionButton action={moveCategoryAction} fields={{ id: category.id, dir: "up" }} label="Subir categoria">
                    <ArrowUp className="size-4" />
                  </ActionButton>
                  <ActionButton action={moveCategoryAction} fields={{ id: category.id, dir: "down" }} label="Descer categoria">
                    <ArrowDown className="size-4" />
                  </ActionButton>
                  <ActionButton
                    action={setCategoryActiveAction}
                    fields={{ id: category.id, active: category.active ? "0" : "1" }}
                    label={category.active ? "Arquivar categoria" : "Restaurar categoria"}
                    className="px-3"
                  >
                    {category.active ? "Arquivar" : "Restaurar"}
                  </ActionButton>
                </div>
              ) : null}
            </div>
            {category.products.length === 0 ? (
              <p className="py-6 text-sm text-zinc-500">Nenhum produto nesta categoria.</p>
            ) : (
              <ul>
                {category.products.map((product) => (
                  <ProductRow key={product.id} product={product} canEdit={canEdit} now={now} timezone={timezone} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Páginas de categoria**

`catalogo/categorias/nova/page.tsx`:

```tsx
import { first } from "@/lib/search-params";
import { authorizeCatalog } from "@/server/catalog/authz";
import { listForPanel } from "@/server/catalog/queries";
import { createCategoryAction } from "../../_actions/list";
import { CategoryForm } from "../../_components/category-form";
import { Flash } from "../../_components/flash";

export default async function NewCategoryPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string | string[] }>;
}) {
  const { ctx, timezone } = await authorizeCatalog("catalog:edit");
  const { schedules } = await listForPanel(ctx.tenantId, new Date(), timezone);
  return (
    <main>
      <h1 className="mb-10 text-4xl font-bold tracking-tight">Nova categoria</h1>
      <Flash erro={first((await searchParams).erro)} />
      <CategoryForm action={createCategoryAction} schedules={schedules} />
    </main>
  );
}
```

`catalogo/categorias/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { first } from "@/lib/search-params";
import { authorizeCatalog } from "@/server/catalog/authz";
import { listForPanel } from "@/server/catalog/queries";
import { updateCategoryAction } from "../../_actions/list";
import { CategoryForm } from "../../_components/category-form";
import { Flash } from "../../_components/flash";

export default async function EditCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string | string[]; salvo?: string | string[] }>;
}) {
  const { id } = await params;
  const { ctx, timezone } = await authorizeCatalog("catalog:edit");
  const { categories, schedules } = await listForPanel(ctx.tenantId, new Date(), timezone);
  const category = categories.find((c) => c.id === id);
  if (!category) notFound();
  const sp = await searchParams;
  return (
    <main>
      <h1 className="mb-10 text-4xl font-bold tracking-tight">Editar categoria</h1>
      <Flash erro={first(sp.erro)} salvo={first(sp.salvo) === "1"} />
      <CategoryForm action={updateCategoryAction} schedules={schedules} category={category} />
    </main>
  );
}
```

- [ ] **Step 6: Verificar e commitar**

Run: `npm run typecheck && npm run lint`
Expected: limpo. Conferir manualmente com o dev server (`npm run dev`, login `dono@demo.test` / `Demo@12345678` em `http://app.localhost:3000/login`): `/catalogo` mostra o estado vazio em Demo Açaí e a lista (vazia de itens) em Demo Lanche após a Task 9 popular o seed; "Começar com um modelo" cria o cardápio e a lista mostra categorias e produtos.

```bash
git add "src/app/panel/(shell)/catalogo"
git commit -m "feat(panel): lista do catálogo, categorias, pausa e reordenação"
```

---

### Task 5: Formulário de produto

**Files:**
- Create: `catalogo/_components/price-rows.tsx` (client), `catalogo/_components/product-form.tsx`, `catalogo/_actions/product.ts`, `catalogo/produtos/novo/page.tsx`, `catalogo/produtos/[id]/page.tsx`

**Interfaces:**
- Consumes: Tasks 2–4 (`parseProductForm`, `createProduct`, `updateProduct`, `centsToInput`, `groupRule`, `DIETARY_LABEL`, `DIETARY`, `ActionButton`, `Flash`, `Field`, `setProductActiveAction`, `duplicateProductAction`, `listForPanel`).
- Produces: `PriceRows({ prefix: "variant" | "item", initial: { id: string; name: string; price: string }[], labels: { name: string; price: string; add: string; remove: string } })` (client; nomes de campo `${prefix}Id|Name|Price`); `ProductForm`; `createProductAction`, `updateProductAction` (campo `id` no edit).

- [ ] **Step 1: Editor de linhas (único trecho cliente do produto)** — `catalogo/_components/price-rows.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface PriceRowInitial {
  id: string;
  name: string;
  price: string;
}
interface Row extends PriceRowInitial {
  key: number;
}

/** Linhas nome + preço. Campos: `${prefix}Id[]`, `${prefix}Name[]`, `${prefix}Price[]` (texto em reais; o servidor converte). */
export function PriceRows({
  prefix,
  initial,
  labels,
}: {
  prefix: "variant" | "item";
  initial: PriceRowInitial[];
  labels: { name: string; price: string; add: string; remove: string };
}) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((r, i) => ({ ...r, key: i })));
  const [seq, setSeq] = useState(initial.length);

  return (
    <div className="space-y-3">
      {rows.map((row, i) => (
        <div key={row.key} className="flex items-center gap-2">
          <input type="hidden" name={`${prefix}Id`} defaultValue={row.id} />
          <Input
            name={`${prefix}Name`}
            defaultValue={row.name}
            maxLength={80}
            placeholder={labels.name}
            aria-label={`${labels.name} ${i + 1}`}
            className="h-11 flex-1"
          />
          <Input
            name={`${prefix}Price`}
            defaultValue={row.price}
            inputMode="decimal"
            placeholder="0,00"
            aria-label={`${labels.price} ${i + 1}`}
            className="h-11 w-28"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${labels.remove} ${i + 1}`}
            className="size-11 transition-all duration-200"
            onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-10 transition-all duration-200"
        onClick={() => {
          setRows((rs) => [...rs, { key: seq, id: "", name: "", price: "" }]);
          setSeq((s) => s + 1);
        }}
      >
        <Plus className="size-4" />
        {labels.add}
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Ações** — `catalogo/_actions/product.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { authorizeCatalog } from "@/server/catalog/authz";
import { createProduct, updateProduct } from "@/server/catalog/commands";
import { formText, parseProductForm } from "@/server/catalog/forms";
import { failCode, seg } from "./shared";

export async function createProductAction(fd: FormData): Promise<void> {
  const { ctx } = await authorizeCatalog("catalog:edit");
  const parsed = parseProductForm(fd);
  if (!parsed.ok) redirect(`/catalogo/produtos/novo?erro=${parsed.reason}`);
  const r = await createProduct(ctx, parsed.input);
  redirect(r.ok ? "/catalogo" : `/catalogo/produtos/novo?erro=${failCode(r)}`);
}

export async function updateProductAction(fd: FormData): Promise<void> {
  const { ctx } = await authorizeCatalog("catalog:edit");
  const id = formText(fd, "id");
  const here = `/catalogo/produtos/${seg(id)}`;
  const parsed = parseProductForm(fd);
  if (!parsed.ok) redirect(`${here}?erro=${parsed.reason}`);
  const r = await updateProduct(ctx, id, parsed.input);
  redirect(r.ok ? `${here}?salvo=1` : `${here}?erro=${failCode(r)}`);
}
```

- [ ] **Step 3: Formulário** — `catalogo/_components/product-form.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DIETARY_LABEL, groupRule } from "@/lib/catalog-view";
import { centsToInput } from "@/lib/money";
import type { PanelGroup, PanelProduct, PanelSchedule } from "@/server/catalog/queries";
import { DIETARY } from "@/server/catalog/schemas";
import { Field } from "./field";
import { PriceRows } from "./price-rows";

interface Props {
  action: (formData: FormData) => Promise<void>;
  categories: { id: string; name: string }[];
  groups: PanelGroup[];
  schedules: PanelSchedule[];
  product?: PanelProduct;
  /** Categoria pré-selecionada em produto novo (vem de `?categoria=`). */
  categoryId?: string;
}

const LINK = "text-sm underline underline-offset-4 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** Blocos 2–5 do formulário (variações extras, etiquetas, grupos e horários). */
function Details({ groups, schedules, product, children }: Pick<Props, "groups" | "schedules" | "product"> & { children?: React.ReactNode }) {
  return (
    <div className="space-y-10">
      {children}

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Etiquetas</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {DIETARY.map((tag) => (
            <label key={tag} className="flex min-h-10 items-center gap-3 text-sm">
              <Checkbox name="dietary" value={tag} defaultChecked={product?.dietary.includes(tag)} />
              {DIETARY_LABEL[tag]}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Opções (adicionais, pontos, molhos)</legend>
        {groups.length === 0 ? <p className="text-sm text-zinc-500">Você ainda não criou grupos de opções.</p> : null}
        {groups.map((g) => (
          <label key={g.id} className="flex min-h-10 items-start gap-3 text-sm">
            <Checkbox name="optionGroupIds" value={g.id} defaultChecked={product?.optionGroupIds.includes(g.id)} className="mt-0.5" />
            <span>
              {g.name}
              <span className="block text-zinc-500">{groupRule(g.minSelect, g.maxSelect)}</span>
            </span>
          </label>
        ))}
        <Link href="/catalogo/opcoes/novo" className={LINK}>
          Adicionar opções
        </Link>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Horários</legend>
        <p className="text-sm text-zinc-500">Nenhum marcado: usa o horário da categoria (ou fica sempre disponível).</p>
        {schedules.map((s) => (
          <label key={s.id} className="flex min-h-10 items-center gap-3 text-sm">
            <Checkbox name="scheduleIds" value={s.id} defaultChecked={product?.scheduleIds.includes(s.id)} />
            {s.name}
          </label>
        ))}
        <Link href="/catalogo/horarios/novo" className={LINK}>
          Criar horário
        </Link>
      </fieldset>
    </div>
  );
}

export function ProductForm({ action, categories, groups, schedules, product, categoryId }: Props) {
  const imageAndText = (
    <>
      <Field id="description" label="Descrição" hint="Até 500 caracteres.">
        <Textarea id="description" name="description" maxLength={500} defaultValue={product?.description} />
      </Field>
      <Field id="imageUrl" label="Endereço da imagem" hint="Link https:// de uma imagem. Deixe vazio para ficar sem foto.">
        <Input id="imageUrl" name="imageUrl" type="url" maxLength={500} defaultValue={product?.imageUrl ?? ""} className="h-11" />
      </Field>
      {product?.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- https externo liberado no CSP; next/image exigiria allowlist de hosts
        <img src={product.imageUrl} alt="" width={96} height={96} loading="lazy" className="size-24 rounded-lg border border-zinc-200 object-cover dark:border-zinc-800" />
      ) : null}
    </>
  );

  return (
    <form action={action} className="max-w-xl space-y-10">
      {product ? <input type="hidden" name="id" value={product.id} /> : null}

      <div className="space-y-6">
        <Field id="name" label="Nome do produto">
          <Input id="name" name="name" required maxLength={120} defaultValue={product?.name} className="h-11" />
        </Field>

        {product ? null : (
          <>
            {/* Produto novo: preço único. A variação "Único" nasce aqui; mais tamanhos ficam em "Mais opções". */}
            <input type="hidden" name="variantId" value="" />
            <input type="hidden" name="variantName" value="Único" />
            <Field id="variantPrice" label="Preço (R$)">
              <Input id="variantPrice" name="variantPrice" required inputMode="decimal" placeholder="0,00" className="h-11 w-40" />
            </Field>
          </>
        )}

        <Field id="categoryId" label="Categoria">
          <Select id="categoryId" name="categoryId" required defaultValue={product?.categoryId ?? categoryId} className="h-11">
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {product ? (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium">Variações e preços</h2>
            <p className="text-sm text-zinc-500">Tamanhos ou versões, cada um com seu preço. Variação removida fica arquivada.</p>
            <PriceRows
              prefix="variant"
              initial={product.variants.map((v) => ({ id: v.id, name: v.name, price: centsToInput(v.priceCents) }))}
              labels={{ name: "Variação", price: "Preço", add: "Adicionar variação", remove: "Remover variação" }}
            />
          </section>
          {imageAndText}
          <Details groups={groups} schedules={schedules} product={product} />
        </>
      ) : (
        <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800">
          <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-medium transition-all duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Mais opções
          </summary>
          <div className="space-y-10 border-t border-zinc-200 p-4 dark:border-zinc-800">
            {imageAndText}
            <Details groups={groups} schedules={schedules}>
              <section className="space-y-3">
                <h2 className="text-sm font-medium">Outros tamanhos</h2>
                <p className="text-sm text-zinc-500">Só se o produto tiver mais de um tamanho ou versão.</p>
                <PriceRows
                  prefix="variant"
                  initial={[]}
                  labels={{ name: "Variação", price: "Preço", add: "Adicionar tamanho", remove: "Remover tamanho" }}
                />
              </section>
            </Details>
          </div>
        </details>
      )}

      <Button type="submit" className="h-11 transition-all duration-200">
        Salvar produto
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Páginas**

`catalogo/produtos/novo/page.tsx`:

```tsx
import Link from "next/link";
import { first } from "@/lib/search-params";
import { authorizeCatalog } from "@/server/catalog/authz";
import { listForPanel } from "@/server/catalog/queries";
import { createProductAction } from "../../_actions/product";
import { Flash } from "../../_components/flash";
import { ProductForm } from "../../_components/product-form";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string | string[]; categoria?: string | string[] }>;
}) {
  const { ctx, timezone } = await authorizeCatalog("catalog:edit");
  const { categories, groups, schedules } = await listForPanel(ctx.tenantId, new Date(), timezone);
  const sp = await searchParams;
  const active = categories.filter((c) => c.active);

  if (active.length === 0) {
    return (
      <main>
        <h1 className="text-4xl font-bold tracking-tight">Novo produto</h1>
        <p className="mt-3 leading-relaxed text-zinc-500">Crie uma categoria antes de cadastrar produtos.</p>
        <Link href="/catalogo/categorias/nova" className="mt-6 inline-block text-sm underline underline-offset-4">
          Criar categoria
        </Link>
      </main>
    );
  }

  return (
    <main>
      <h1 className="mb-10 text-4xl font-bold tracking-tight">Novo produto</h1>
      <Flash erro={first(sp.erro)} />
      <ProductForm
        action={createProductAction}
        categories={active.map((c) => ({ id: c.id, name: c.name }))}
        groups={groups}
        schedules={schedules}
        categoryId={first(sp.categoria)}
      />
    </main>
  );
}
```

`catalogo/produtos/[id]/page.tsx` (404 para id desconhecido/inválido; categoria arquivada atual entra no select):

```tsx
import { notFound } from "next/navigation";
import { Copy } from "lucide-react";
import { first } from "@/lib/search-params";
import { authorizeCatalog } from "@/server/catalog/authz";
import { listForPanel } from "@/server/catalog/queries";
import { duplicateProductAction, setProductActiveAction } from "../../_actions/list";
import { updateProductAction } from "../../_actions/product";
import { ActionButton } from "../../_components/action-button";
import { Flash } from "../../_components/flash";
import { ProductForm } from "../../_components/product-form";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string | string[]; salvo?: string | string[] }>;
}) {
  const { id } = await params;
  const { ctx, timezone } = await authorizeCatalog("catalog:edit");
  const { categories, groups, schedules } = await listForPanel(ctx.tenantId, new Date(), timezone);
  const product = categories.flatMap((c) => c.products).find((p) => p.id === id);
  if (!product) notFound();
  const sp = await searchParams;
  const options = categories
    .filter((c) => c.active || c.id === product.categoryId)
    .map((c) => ({ id: c.id, name: c.active ? c.name : `${c.name} (arquivada)` }));

  return (
    <main>
      <h1 className="mb-10 text-4xl font-bold tracking-tight">Editar produto</h1>
      <Flash erro={first(sp.erro)} salvo={first(sp.salvo) === "1"} />
      <ProductForm action={updateProductAction} categories={options} groups={groups} schedules={schedules} product={product} />

      <div className="mt-16 flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-8 dark:border-zinc-800">
        <ActionButton action={duplicateProductAction} fields={{ id: product.id }} label="Duplicar produto" variant="outline" className="px-3">
          <Copy className="size-4" />
          Duplicar
        </ActionButton>
        <ActionButton
          action={setProductActiveAction}
          fields={{ id: product.id, active: product.active ? "0" : "1" }}
          label={product.active ? "Arquivar produto" : "Restaurar produto"}
          variant={product.active ? "destructive" : "outline"}
          className="px-3"
        >
          {product.active ? "Arquivar" : "Restaurar"}
        </ActionButton>
      </div>
    </main>
  );
}
```

Observação: `setProductActiveAction` redireciona para a lista (`/catalogo`), o que é o comportamento desejado após arquivar/restaurar.

- [ ] **Step 5: Verificar e commitar**

Run: `npm run typecheck && npm run lint`
Expected: limpo. Conferência manual (dev server): criar produto só com nome/preço/categoria; abrir "Mais opções"; editar um produto com 2 variações, remover uma e salvar (a outra mantém o id; a removida some do formulário — fica arquivada no banco).

```bash
git add "src/app/panel/(shell)/catalogo"
git commit -m "feat(panel): formulário de produto com variações, etiquetas, opções e horários"
```

---

### Task 6: Grupos de opções

**Files:**
- Create: `catalogo/_components/group-form.tsx`, `catalogo/_actions/group.ts`, `catalogo/opcoes/page.tsx`, `catalogo/opcoes/novo/page.tsx`, `catalogo/opcoes/[id]/page.tsx`

**Interfaces:**
- Consumes: `PriceRows` (prefix `item`), `parseGroupForm`, `createOptionGroup`, `updateOptionGroup`, `groupRule`, `centsToInput`, `PanelGroup`, `Flash`, `Field`.
- Produces: `createGroupAction`, `updateGroupAction` (campo `id` no edit).

- [ ] **Step 1: Ações** — `catalogo/_actions/group.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { authorizeCatalog } from "@/server/catalog/authz";
import { createOptionGroup, updateOptionGroup } from "@/server/catalog/commands";
import { formText, parseGroupForm } from "@/server/catalog/forms";
import { failCode, seg } from "./shared";

export async function createGroupAction(fd: FormData): Promise<void> {
  const { ctx } = await authorizeCatalog("catalog:edit");
  const parsed = parseGroupForm(fd);
  if (!parsed.ok) redirect(`/catalogo/opcoes/novo?erro=${parsed.reason}`);
  const r = await createOptionGroup(ctx, parsed.input);
  redirect(r.ok ? "/catalogo/opcoes" : `/catalogo/opcoes/novo?erro=${failCode(r)}`);
}

export async function updateGroupAction(fd: FormData): Promise<void> {
  const { ctx } = await authorizeCatalog("catalog:edit");
  const id = formText(fd, "id");
  const here = `/catalogo/opcoes/${seg(id)}`;
  const parsed = parseGroupForm(fd);
  if (!parsed.ok) redirect(`${here}?erro=${parsed.reason}`);
  const r = await updateOptionGroup(ctx, id, parsed.input);
  redirect(r.ok ? `${here}?salvo=1` : `${here}?erro=${failCode(r)}`);
}
```

- [ ] **Step 2: Formulário** — `catalogo/_components/group-form.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { centsToInput } from "@/lib/money";
import type { PanelGroup } from "@/server/catalog/queries";
import { Field } from "./field";
import { PriceRows } from "./price-rows";

const BLANK = [
  { id: "", name: "", price: "" },
  { id: "", name: "", price: "" },
];

export function GroupForm({
  action,
  group,
}: {
  action: (formData: FormData) => Promise<void>;
  group?: PanelGroup;
}) {
  const items = group
    ? group.items.map((i) => ({ id: i.id, name: i.name, price: centsToInput(i.priceDeltaCents) }))
    : BLANK;

  return (
    <form action={action} className="max-w-xl space-y-8">
      {group ? <input type="hidden" name="id" value={group.id} /> : null}
      <Field id="name" label="Nome do grupo" hint='Ex.: "Adicionais", "Ponto da carne", "Molhos".'>
        <Input id="name" name="name" required maxLength={80} defaultValue={group?.name} className="h-11" />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field id="minSelect" label="Mínimo" hint="0 = opcional. 1 ou mais = obrigatório.">
          <Input id="minSelect" name="minSelect" type="number" min={0} max={50} required defaultValue={group?.minSelect ?? 0} className="h-11" />
        </Field>
        <Field id="maxSelect" label="Máximo" hint="Quantos o cliente pode escolher.">
          <Input id="maxSelect" name="maxSelect" type="number" min={1} max={50} required defaultValue={group?.maxSelect ?? 1} className="h-11" />
        </Field>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Itens</h2>
        <p className="text-sm text-zinc-500">Acréscimo em branco = sem custo. Item removido fica arquivado.</p>
        <PriceRows
          prefix="item"
          initial={items}
          labels={{ name: "Nome do item", price: "Acréscimo do item", add: "Adicionar item", remove: "Remover item" }}
        />
      </section>

      <Button type="submit" className="h-11 transition-all duration-200">
        Salvar grupo
      </Button>
    </form>
  );
}
```

(Os rótulos acessíveis ficam `Nome do item 1`, `Acréscimo do item 1`, `Remover item 1`: o e2e da Task 9 usa esses nomes.)

- [ ] **Step 3: Páginas**

`catalogo/opcoes/page.tsx`:

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { groupRule } from "@/lib/catalog-view";
import { authorizeCatalog } from "@/server/catalog/authz";
import { listForPanel } from "@/server/catalog/queries";

export default async function OptionGroupsPage() {
  const { ctx, timezone } = await authorizeCatalog("catalog:edit");
  const { groups } = await listForPanel(ctx.tenantId, new Date(), timezone);
  return (
    <main>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-4xl font-bold tracking-tight">Opções</h1>
        <Button asChild className="h-10 transition-all duration-200">
          <Link href="/catalogo/opcoes/novo">
            <Plus className="size-4" />
            Novo grupo
          </Link>
        </Button>
      </div>
      <p className="mt-3 max-w-lg leading-relaxed text-zinc-500">
        Grupos reutilizáveis (adicionais, ponto da carne, molhos) que você liga aos produtos.
      </p>
      {groups.length === 0 ? (
        <p className="mt-12 text-sm text-zinc-500">Nenhum grupo ainda.</p>
      ) : (
        <ul className="mt-12">
          {groups.map((g) => (
            <li key={g.id} className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
              <Link
                href={`/catalogo/opcoes/${encodeURIComponent(g.id)}`}
                className="flex flex-col gap-1 py-5 transition-all duration-200 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-medium">{g.name}</span>
                <span className="text-sm text-zinc-500">
                  {groupRule(g.minSelect, g.maxSelect)} · {g.items.length} {g.items.length === 1 ? "item" : "itens"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

`catalogo/opcoes/novo/page.tsx`:

```tsx
import { first } from "@/lib/search-params";
import { authorizeCatalog } from "@/server/catalog/authz";
import { createGroupAction } from "../../_actions/group";
import { Flash } from "../../_components/flash";
import { GroupForm } from "../../_components/group-form";

export default async function NewGroupPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string | string[] }>;
}) {
  await authorizeCatalog("catalog:edit");
  return (
    <main>
      <h1 className="mb-10 text-4xl font-bold tracking-tight">Novo grupo de opções</h1>
      <Flash erro={first((await searchParams).erro)} />
      <GroupForm action={createGroupAction} />
    </main>
  );
}
```

`catalogo/opcoes/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { first } from "@/lib/search-params";
import { authorizeCatalog } from "@/server/catalog/authz";
import { listForPanel } from "@/server/catalog/queries";
import { updateGroupAction } from "../../_actions/group";
import { Flash } from "../../_components/flash";
import { GroupForm } from "../../_components/group-form";

export default async function EditGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string | string[]; salvo?: string | string[] }>;
}) {
  const { id } = await params;
  const { ctx, timezone } = await authorizeCatalog("catalog:edit");
  const { groups } = await listForPanel(ctx.tenantId, new Date(), timezone);
  const group = groups.find((g) => g.id === id);
  if (!group) notFound();
  const sp = await searchParams;
  return (
    <main>
      <h1 className="mb-10 text-4xl font-bold tracking-tight">Editar grupo</h1>
      <Flash erro={first(sp.erro)} salvo={first(sp.salvo) === "1"} />
      <GroupForm action={updateGroupAction} group={group} />
    </main>
  );
}
```

- [ ] **Step 4: Verificar e commitar**

Run: `npm run typecheck && npm run lint`
Expected: limpo.

```bash
git add "src/app/panel/(shell)/catalogo"
git commit -m "feat(panel): grupos de opções (lista, criar, editar)"
```

---

### Task 7: Horários

**Files:**
- Create: `catalogo/_components/window-rows.tsx` (client), `catalogo/_components/schedule-form.tsx`, `catalogo/_actions/schedule.ts`, `catalogo/horarios/page.tsx`, `catalogo/horarios/novo/page.tsx`, `catalogo/horarios/[id]/page.tsx`

**Interfaces:**
- Consumes: `parseScheduleForm`, `createSchedule`, `updateSchedule`, `clock`, `WEEKDAY_LABEL`, `crossesMidnight` (Task 2), `PanelSchedule`.
- Produces: `WindowRows({ initial: { day: number; opens: string; closes: string }[] })` (client; campos `winDay[]`, `winOpens[]`, `winCloses[]`; `<input type="time">` com `required`); `createScheduleAction`, `updateScheduleAction`.

- [ ] **Step 1: Editor de janelas (cliente)** — `catalogo/_components/window-rows.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { WEEKDAY_LABEL, crossesMidnight } from "@/lib/catalog-view";

export interface WindowInitial {
  day: number;
  opens: string;
  closes: string;
}
interface Row {
  key: number;
  day: string;
  opens: string;
  closes: string;
}

/** Janelas semanais. Campos: `winDay[]`, `winOpens[]`, `winCloses[]` ("HH:MM"; o servidor converte em minutos). */
export function WindowRows({ initial }: { initial: WindowInitial[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((w, i) => ({ key: i, day: String(w.day), opens: w.opens, closes: w.closes })),
  );
  const [seq, setSeq] = useState(initial.length);
  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      {rows.map((row, i) => (
        <div key={row.key} className="space-y-1">
          <div className="flex items-center gap-2">
            <Select
              name="winDay"
              aria-label={`Dia ${i + 1}`}
              value={row.day}
              onChange={(e) => update(row.key, { day: e.target.value })}
              className="h-11 min-w-0 flex-1"
            >
              {WEEKDAY_LABEL.map((label, d) => (
                <option key={label} value={d}>
                  {label}
                </option>
              ))}
            </Select>
            <Input
              name="winOpens"
              type="time"
              required
              aria-label={`Abre ${i + 1}`}
              value={row.opens}
              onChange={(e) => update(row.key, { opens: e.target.value })}
              className="h-11 w-28"
            />
            <Input
              name="winCloses"
              type="time"
              required
              aria-label={`Fecha ${i + 1}`}
              value={row.closes}
              onChange={(e) => update(row.key, { closes: e.target.value })}
              className="h-11 w-28"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remover horário ${i + 1}`}
              className="size-11 transition-all duration-200"
              onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
            >
              <X className="size-4" />
            </Button>
          </div>
          {crossesMidnight(row.opens, row.closes) ? (
            <p className="text-sm text-zinc-500">Fecha na madrugada do dia seguinte.</p>
          ) : null}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="h-10 transition-all duration-200"
        onClick={() => {
          setRows((rs) => [...rs, { key: seq, day: "1", opens: "", closes: "" }]);
          setSeq((s) => s + 1);
        }}
      >
        <Plus className="size-4" />
        Adicionar horário
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Ações** — `catalogo/_actions/schedule.ts`:

```ts
"use server";

import { redirect } from "next/navigation";
import { authorizeCatalog } from "@/server/catalog/authz";
import { createSchedule, updateSchedule } from "@/server/catalog/commands";
import { formText, parseScheduleForm } from "@/server/catalog/forms";
import { failCode, seg } from "./shared";

export async function createScheduleAction(fd: FormData): Promise<void> {
  const { ctx } = await authorizeCatalog("catalog:edit");
  const parsed = parseScheduleForm(fd);
  if (!parsed.ok) redirect(`/catalogo/horarios/novo?erro=${parsed.reason}`);
  const r = await createSchedule(ctx, parsed.input);
  redirect(r.ok ? "/catalogo/horarios" : `/catalogo/horarios/novo?erro=${failCode(r)}`);
}

export async function updateScheduleAction(fd: FormData): Promise<void> {
  const { ctx } = await authorizeCatalog("catalog:edit");
  const id = formText(fd, "id");
  const here = `/catalogo/horarios/${seg(id)}`;
  const parsed = parseScheduleForm(fd);
  if (!parsed.ok) redirect(`${here}?erro=${parsed.reason}`);
  const r = await updateSchedule(ctx, id, parsed.input);
  redirect(r.ok ? `${here}?salvo=1` : `${here}?erro=${failCode(r)}`);
}
```

- [ ] **Step 3: Formulário** — `catalogo/_components/schedule-form.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clock } from "@/lib/catalog-view";
import type { PanelSchedule } from "@/server/catalog/queries";
import { Field } from "./field";
import { WindowRows } from "./window-rows";

export function ScheduleForm({
  action,
  schedule,
}: {
  action: (formData: FormData) => Promise<void>;
  schedule?: PanelSchedule;
}) {
  const initial = schedule
    ? schedule.windows.map((w) => ({ day: w.weekday, opens: clock(w.opensMin), closes: clock(w.closesMin) }))
    : [{ day: 1, opens: "", closes: "" }];

  return (
    <form action={action} className="max-w-xl space-y-8">
      {schedule ? <input type="hidden" name="id" value={schedule.id} /> : null}
      <Field id="name" label="Nome do horário" hint='Ex.: "Almoço", "Jantar", "Fim de semana".'>
        <Input id="name" name="name" required maxLength={80} defaultValue={schedule?.name} className="h-11" />
      </Field>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Quando está disponível</h2>
        <p className="text-sm text-zinc-500">
          Um horário pode ter várias faixas. Fechar às 00:00 vale até o fim do dia; fechar antes de abrir vale até a
          madrugada seguinte.
        </p>
        <WindowRows initial={initial} />
      </section>

      <Button type="submit" className="h-11 transition-all duration-200">
        Salvar horário
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Páginas**

`catalogo/horarios/page.tsx`:

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WEEKDAY_LABEL, clock } from "@/lib/catalog-view";
import { authorizeCatalog } from "@/server/catalog/authz";
import { listForPanel } from "@/server/catalog/queries";

export default async function SchedulesPage() {
  const { ctx, timezone } = await authorizeCatalog("catalog:edit");
  const { schedules } = await listForPanel(ctx.tenantId, new Date(), timezone);
  return (
    <main>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-4xl font-bold tracking-tight">Horários</h1>
        <Button asChild className="h-10 transition-all duration-200">
          <Link href="/catalogo/horarios/novo">
            <Plus className="size-4" />
            Novo horário
          </Link>
        </Button>
      </div>
      <p className="mt-3 max-w-lg leading-relaxed text-zinc-500">
        Horários nomeados que você liga a categorias e produtos. Sem horário, o item fica sempre disponível.
      </p>
      {schedules.length === 0 ? (
        <p className="mt-12 text-sm text-zinc-500">Nenhum horário ainda.</p>
      ) : (
        <ul className="mt-12">
          {schedules.map((s) => (
            <li key={s.id} className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
              <Link
                href={`/catalogo/horarios/${encodeURIComponent(s.id)}`}
                className="flex flex-col gap-1 py-5 transition-all duration-200 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-sm text-zinc-500">
                  {s.windows.length === 0
                    ? "Sem faixas (item fica indisponível)"
                    : s.windows
                        .map((w) => `${WEEKDAY_LABEL[w.weekday]} ${clock(w.opensMin)}–${clock(w.closesMin)}`)
                        .join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

`catalogo/horarios/novo/page.tsx`:

```tsx
import { first } from "@/lib/search-params";
import { authorizeCatalog } from "@/server/catalog/authz";
import { createScheduleAction } from "../../_actions/schedule";
import { Flash } from "../../_components/flash";
import { ScheduleForm } from "../../_components/schedule-form";

export default async function NewSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string | string[] }>;
}) {
  await authorizeCatalog("catalog:edit");
  return (
    <main>
      <h1 className="mb-10 text-4xl font-bold tracking-tight">Novo horário</h1>
      <Flash erro={first((await searchParams).erro)} />
      <ScheduleForm action={createScheduleAction} />
    </main>
  );
}
```

`catalogo/horarios/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { first } from "@/lib/search-params";
import { authorizeCatalog } from "@/server/catalog/authz";
import { listForPanel } from "@/server/catalog/queries";
import { updateScheduleAction } from "../../_actions/schedule";
import { Flash } from "../../_components/flash";
import { ScheduleForm } from "../../_components/schedule-form";

export default async function EditSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string | string[]; salvo?: string | string[] }>;
}) {
  const { id } = await params;
  const { ctx, timezone } = await authorizeCatalog("catalog:edit");
  const { schedules } = await listForPanel(ctx.tenantId, new Date(), timezone);
  const schedule = schedules.find((s) => s.id === id);
  if (!schedule) notFound();
  const sp = await searchParams;
  return (
    <main>
      <h1 className="mb-10 text-4xl font-bold tracking-tight">Editar horário</h1>
      <Flash erro={first(sp.erro)} salvo={first(sp.salvo) === "1"} />
      <ScheduleForm action={updateScheduleAction} schedule={schedule} />
    </main>
  );
}
```

- [ ] **Step 5: Verificar e commitar**

Run: `npm run typecheck && npm run lint`
Expected: limpo. Conferência manual: criar horário 22:00–02:00 mostra o aviso "Fecha na madrugada do dia seguinte"; 18:00–00:00 não mostra.

```bash
git add "src/app/panel/(shell)/catalogo"
git commit -m "feat(panel): horários nomeados com janelas semanais"
```

---

### Task 8: Vitrine (cardápio e detalhe)

**Files:**
- Modify: `src/app/s/[slug]/page.tsx`
- Create: `src/app/s/[slug]/_components/menu.tsx`, `src/app/s/[slug]/p/[id]/page.tsx`

**Interfaces:**
- Consumes: `listMenu`, `getMenuProduct`, `MenuCategory`, `MenuProduct` (`@/server/catalog/queries`); `storefrontNote`, `groupRule`, `DIETARY_LABEL`, `dietaryTagsIn`, `filterMenuByDietary`, `parseDietaryParam` (Task 2); `formatBRL`; `getTenantCached` (já existe; `TenantRef` tem `timezone`).
- Produces: home da loja com cardápio somente leitura; `/p/<id>` com variações, preços e grupos em texto.

- [ ] **Step 1: Componentes do cardápio** — `src/app/s/[slug]/_components/menu.tsx`:

```tsx
import Link from "next/link";
import { DIETARY_LABEL, storefrontNote } from "@/lib/catalog-view";
import { formatBRL } from "@/lib/money";
import type { MenuProduct } from "@/server/catalog/queries";
import type { Dietary } from "@/server/catalog/schemas";

export function priceText(p: Pick<MenuProduct, "fromPriceCents" | "multiplePrices">): string {
  return p.multiplePrices ? `a partir de ${formatBRL(p.fromPriceCents)}` : formatBRL(p.fromPriceCents);
}

export function MenuProductRow({ product, now, timezone }: { product: MenuProduct; now: Date; timezone: string }) {
  const note = storefrontNote(product.availability, now, timezone);
  return (
    <li className="border-b border-zinc-200 last:border-b-0 dark:border-zinc-800">
      <Link
        href={`/p/${encodeURIComponent(product.id)}`}
        className={`flex items-start justify-between gap-4 py-5 transition-all duration-200 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${note ? "opacity-60" : ""}`}
      >
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{product.name}</p>
          {product.description ? <p className="line-clamp-2 text-sm leading-relaxed text-zinc-500">{product.description}</p> : null}
          <p className="text-sm">{priceText(product)}</p>
          {product.dietary.length > 0 ? (
            <p className="text-xs text-zinc-500">{product.dietary.map((t) => DIETARY_LABEL[t as Dietary] ?? t).join(" · ")}</p>
          ) : null}
          {note ? <p className="text-sm font-medium">{note}</p> : null}
        </div>
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- https externo liberado no CSP; next/image exigiria allowlist de hosts
          <img src={product.imageUrl} alt="" width={64} height={64} loading="lazy" className="size-16 shrink-0 rounded-md border border-zinc-200 object-cover dark:border-zinc-800" />
        ) : null}
      </Link>
    </li>
  );
}
```

- [ ] **Step 2: Home da loja** — substituir `src/app/s/[slug]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { User } from "lucide-react";
import { DIETARY_LABEL, dietaryTagsIn, filterMenuByDietary, parseDietaryParam } from "@/lib/catalog-view";
import { first } from "@/lib/search-params";
import { listMenu } from "@/server/catalog/queries";
import { getTenantCached } from "@/server/tenancy/cached";
import { MenuProductRow } from "./_components/menu";

export const dynamic = "force-dynamic"; // a disponibilidade depende da hora: nada de cache de página

const VERTICAL_LABEL: Record<string, string> = {
  restaurante: "Restaurante",
  lanchonete: "Lanchonete",
  acaiteria: "Açaiteria",
  quiosque: "Quiosque",
};

const LINK =
  "inline-flex items-center gap-2 text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const tenant = await getTenantCached((await params).slug);
  if (!tenant) return {};
  return { title: tenant.name, description: `Cardápio de ${tenant.name}` };
}

export default async function StoreHome({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ dieta?: string | string[] }>;
}) {
  const { slug } = await params;
  const tenant = await getTenantCached(slug);
  if (!tenant) notFound();

  const now = new Date();
  const fullMenu = await listMenu(tenant.id, now, tenant.timezone);
  const tag = parseDietaryParam(first((await searchParams).dieta));
  const menu = filterMenuByDietary(fullMenu, tag);
  const tags = dietaryTagsIn(fullMenu);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-12">
      <header className="flex items-center justify-between">
        <span className="size-3 rounded-full bg-primary" aria-hidden />
        <Link href="/entrar" className={LINK}>
          <User className="size-4" />
          Entrar
        </Link>
      </header>

      <section className="py-12 md:py-16">
        <p className="text-sm text-zinc-500">{Object.hasOwn(VERTICAL_LABEL, tenant.vertical) ? VERTICAL_LABEL[tenant.vertical] : "Loja"}</p>
        <h1 className="mt-3 text-5xl font-bold leading-[1.05] tracking-tight md:text-6xl">{tenant.name}</h1>
        {fullMenu.length === 0 ? (
          <p className="mt-6 max-w-lg text-lg leading-relaxed text-zinc-500">
            O cardápio chega em breve. Por enquanto, entre com seu telefone para acompanhar seus pedidos.
          </p>
        ) : null}
      </section>

      {fullMenu.length > 0 ? (
        <>
          {tags.length > 0 ? (
            <nav aria-label="Filtrar por etiqueta" className="mb-6 flex flex-wrap gap-2">
              <Link
                href="/"
                aria-current={tag ? undefined : "true"}
                className={`inline-flex h-9 items-center rounded-md border px-3 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tag ? "border-zinc-200 text-zinc-500 hover:text-foreground dark:border-zinc-800" : "border-foreground"}`}
              >
                Todos
              </Link>
              {tags.map((t) => (
                <Link
                  key={t}
                  href={`/?dieta=${t}`}
                  aria-current={tag === t ? "true" : undefined}
                  className={`inline-flex h-9 items-center rounded-md border px-3 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tag === t ? "border-foreground" : "border-zinc-200 text-zinc-500 hover:text-foreground dark:border-zinc-800"}`}
                >
                  {DIETARY_LABEL[t]}
                </Link>
              ))}
            </nav>
          ) : null}

          <nav aria-label="Categorias" className="sticky top-0 z-10 -mx-6 flex gap-6 overflow-x-auto border-b border-zinc-200 bg-background px-6 py-3 dark:border-zinc-800">
            {menu.map((c) => (
              <a key={c.id} href={`#cat-${c.id}`} className={`${LINK} shrink-0`}>
                {c.name}
              </a>
            ))}
          </nav>

          {menu.length === 0 ? (
            <p className="py-12 text-sm text-zinc-500">Nenhum item com essa etiqueta.</p>
          ) : (
            <div className="space-y-12 py-8">
              {menu.map((c) => (
                <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`h-${c.id}`} className="scroll-mt-16">
                  <h2 id={`h-${c.id}`} className="text-2xl font-bold tracking-tight">
                    {c.name}
                  </h2>
                  <ul className="mt-2">
                    {c.products.map((p) => (
                      <MenuProductRow key={p.id} product={p} now={now} timezone={tenant.timezone} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 3: Detalhe do produto** — `src/app/s/[slug]/p/[id]/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DIETARY_LABEL, groupRule, storefrontNote } from "@/lib/catalog-view";
import { formatBRL } from "@/lib/money";
import { getMenuProduct } from "@/server/catalog/queries";
import type { Dietary } from "@/server/catalog/schemas";
import { getTenantCached } from "@/server/tenancy/cached";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; id: string }> }): Promise<Metadata> {
  const { slug, id } = await params;
  const tenant = await getTenantCached(slug);
  if (!tenant) return {};
  const product = await getMenuProduct(tenant.id, id, new Date(), tenant.timezone);
  return { title: product ? `${product.name} · ${tenant.name}` : tenant.name };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const tenant = await getTenantCached(slug);
  if (!tenant) notFound();
  const now = new Date();
  const product = await getMenuProduct(tenant.id, id, now, tenant.timezone);
  if (!product) notFound();
  const note = storefrontNote(product.availability, now, tenant.timezone);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-6 py-12 md:py-16">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-zinc-500 transition-all duration-200 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <ArrowLeft className="size-4" />
        Cardápio
      </Link>

      <p className="mt-12 text-sm text-zinc-500">{product.categoryName}</p>
      <h1 className="mt-2 text-4xl font-bold leading-tight tracking-tight">{product.name}</h1>
      {product.description ? <p className="mt-4 leading-relaxed text-zinc-500">{product.description}</p> : null}
      {note ? <p className="mt-4 text-sm font-medium">{note}</p> : null}
      {product.dietary.length > 0 ? (
        <p className="mt-4 text-sm text-zinc-500">{product.dietary.map((t) => DIETARY_LABEL[t as Dietary] ?? t).join(" · ")}</p>
      ) : null}
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- https externo liberado no CSP; next/image exigiria allowlist de hosts
        <img src={product.imageUrl} alt="" width={640} height={400} loading="lazy" className="mt-8 aspect-[8/5] w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800" />
      ) : null}

      <section className="mt-12" aria-labelledby="precos">
        <h2 id="precos" className="text-sm font-medium">
          {product.variants.length > 1 ? "Tamanhos e preços" : "Preço"}
        </h2>
        <ul className="mt-3">
          {product.variants.map((v) => (
            <li key={v.id} className="flex items-center justify-between border-b border-zinc-200 py-3 last:border-b-0 dark:border-zinc-800">
              <span>{v.name}</span>
              <span>{formatBRL(v.priceCents)}</span>
            </li>
          ))}
        </ul>
      </section>

      {product.optionGroups.map((g) => (
        <section key={g.id} className="mt-10" aria-label={g.name}>
          <h2 className="text-sm font-medium">{g.name}</h2>
          <p className="mt-1 text-sm text-zinc-500">{groupRule(g.minSelect, g.maxSelect)}</p>
          <ul className="mt-3">
            {g.items.map((i) => (
              <li key={i.id} className="flex items-center justify-between border-b border-zinc-200 py-3 last:border-b-0 dark:border-zinc-800">
                <span>{i.name}</span>
                <span className="text-zinc-500">{i.priceDeltaCents > 0 ? `+ ${formatBRL(i.priceDeltaCents)}` : "Grátis"}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Step 3b: Verificar e commitar**

Run: `npm run typecheck && npm run lint && npm test`
Expected: tudo verde. Conferência manual (dev server, `http://demo-lanche.localhost:3000`): sem catálogo mostra o texto "O cardápio chega em breve"; com catálogo (depois da Task 9, ou aplicando o modelo no painel) mostra barra de categorias fixa, chips de etiqueta e itens; `?dieta=xyz` é ignorado.

```bash
git add "src/app/s"
git commit -m "feat(vitrine): cardápio somente leitura, filtro por etiqueta e detalhe do produto"
```

---

### Task 9: Seed, e2e e fechamento

**Files:**
- Modify: `scripts/seed.ts`, `docs/superpowers/specs/2026-10-03-bora-catalogo-design.md`, `docs/superpowers/follow-ups-catalogo.md`
- Create: `tests/e2e/catalog.spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1–8. Dados do seed usados pelo e2e (loja **demo-lanche**): categoria "Lanches" com "X-Burger" (variações Simples R$ 18,00 e Duplo R$ 28,00, grupo "Ponto da carne" obrigatório, escolha 1) e "Salada Verde" (vegano); categoria "Ceia" ligada ao horário "Ceia" (sem nenhuma faixa ⇒ sempre fora do horário, determinístico) com "Caldo Verde". **demo-acai** fica sem catálogo (estado vazio para o teste do modelo).

- [ ] **Step 1: Seed do catálogo** — em `scripts/seed.ts`, depois do `truncate throttles`, limpar as tabelas do catálogo (o seed é só de dev/CI e já limpa `throttles`):

```ts
    await sql`truncate throttles`;
    await sql`truncate catalog_categories, catalog_products, catalog_variants, option_groups, option_items,
      product_option_groups, schedules, schedule_windows, category_schedules, product_schedules cascade`;
```

E, antes do `console.log("seed ok: ...")`, popular a loja `demo-lanche`:

```ts
    await seedCatalog(sql, tenantIds["demo-lanche"]);
```

Acrescentar a função (acima de `main`, usando o tipo do cliente `postgres.Sql`):

```ts
async function seedCatalog(sql: postgres.Sql, tenantId: string): Promise<void> {
  const [lanches] = await sql`
    insert into catalog_categories (tenant_id, name, position) values (${tenantId}, 'Lanches', 0) returning id`;
  const [ceia] = await sql`
    insert into catalog_categories (tenant_id, name, position) values (${tenantId}, 'Ceia', 1) returning id`;
  // Horário sem nenhuma faixa: o item nunca abre (estado "fora do horário" sem depender da hora do teste).
  const [noturno] = await sql`
    insert into schedules (tenant_id, name) values (${tenantId}, 'Ceia') returning id`;
  await sql`
    insert into category_schedules (tenant_id, category_id, schedule_id) values (${tenantId}, ${ceia.id}, ${noturno.id})`;

  const [burger] = await sql`
    insert into catalog_products (tenant_id, category_id, name, description, position)
    values (${tenantId}, ${lanches.id}, 'X-Burger', 'Pão, hambúrguer e queijo.', 0) returning id`;
  await sql`
    insert into catalog_variants (tenant_id, product_id, name, price_cents, position) values
      (${tenantId}, ${burger.id}, 'Simples', 1800, 0),
      (${tenantId}, ${burger.id}, 'Duplo', 2800, 1)`;
  const [salada] = await sql`
    insert into catalog_products (tenant_id, category_id, name, description, position, dietary)
    values (${tenantId}, ${lanches.id}, 'Salada Verde', 'Folhas, tomate e azeite.', 1, ${["vegan"]}) returning id`;
  await sql`
    insert into catalog_variants (tenant_id, product_id, name, price_cents) values (${tenantId}, ${salada.id}, 'Único', 1500)`;
  const [caldo] = await sql`
    insert into catalog_products (tenant_id, category_id, name, description, position)
    values (${tenantId}, ${ceia.id}, 'Caldo Verde', 'Servido quente.', 0) returning id`;
  await sql`
    insert into catalog_variants (tenant_id, product_id, name, price_cents) values (${tenantId}, ${caldo.id}, 'Único', 1200)`;

  const [ponto] = await sql`
    insert into option_groups (tenant_id, name, min_select, max_select) values (${tenantId}, 'Ponto da carne', 1, 1) returning id`;
  await sql`
    insert into option_items (tenant_id, group_id, name, position) values
      (${tenantId}, ${ponto.id}, 'Mal passado', 0),
      (${tenantId}, ${ponto.id}, 'Ao ponto', 1),
      (${tenantId}, ${ponto.id}, 'Bem passado', 2)`;
  await sql`
    insert into product_option_groups (tenant_id, product_id, group_id) values (${tenantId}, ${burger.id}, ${ponto.id})`;
}
```

Observações para o implementador: (1) `dietary` é `text[]`: se o driver recusar `${["vegan"]}`, use `${sql.array(["vegan"])}`; (2) `id` tem `default gen_random_uuid()` no banco, então o seed não precisa gerar UUID v7; (3) conferir que o import do topo `import postgres from "postgres"` fornece o tipo `postgres.Sql`.

Run: `npm run db:seed`
Expected: `seed ok: ...` sem erro; rodar duas vezes seguidas também passa (idempotente).

- [ ] **Step 2: E2E** — `tests/e2e/catalog.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";

const PORT = 3100;
const panel = (path = "/") => `http://app.localhost:${PORT}${path}`;
const store = (slug: string, path = "/") => `http://${slug}.localhost:${PORT}${path}`;

async function login(page: Page, email: string): Promise<void> {
  await page.goto(panel("/login"));
  await page.waitForLoadState("networkidle"); // espera hidratação (dev compila sob demanda)
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill("Demo@12345678");
  await page.getByRole("button", { name: "Entrar" }).click();
}

const row = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

test("dono aplica o modelo, pausa um item e a vitrine reflete", async ({ page }) => {
  await login(page, "dono@demo.test");
  await page.getByRole("button", { name: /Demo Açaí/ }).click();
  await page.goto(panel("/catalogo"));
  await page.getByRole("button", { name: "Começar com um modelo" }).click();
  await expect(page.getByText("Açaí tradicional", { exact: true })).toBeVisible();

  await row(page, "Açaí tradicional").getByRole("button", { name: "Esgotado hoje" }).click();
  await expect(row(page, "Açaí tradicional").getByText("Pausado até 00:00")).toBeVisible();
  await expect(row(page, "Açaí tradicional").getByRole("button", { name: "Voltar a vender" })).toBeVisible();

  await page.goto(store("demo-acai"));
  await expect(page.getByText("Esgotado hoje")).toBeVisible();

  // Filtro por etiqueta lido no servidor; etiqueta inexistente é ignorada.
  await page.goto(store("demo-acai", "/?dieta=vegan"));
  await expect(page.getByText("Açaí tradicional", { exact: true })).toBeVisible();
  await expect(page.getByText("Açaí com leite ninho")).toHaveCount(0);
  await page.goto(store("demo-acai", "/?dieta=xyz"));
  await expect(page.getByText("Açaí com leite ninho")).toBeVisible();
});

test("dono cadastra grupo, horário e produto, e a vitrine mostra", async ({ page }) => {
  await login(page, "dono@demo.test");
  await page.getByRole("button", { name: /Demo Lanche/ }).click();

  // Grupo de opções (opcional, até 2).
  await page.goto(panel("/catalogo/opcoes/novo"));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome do grupo").fill("Molhos");
  await page.getByLabel("Máximo").fill("2");
  await page.getByLabel("Nome do item 1").fill("Maionese");
  await page.getByLabel("Nome do item 2").fill("Barbecue");
  await page.getByLabel("Acréscimo do item 2").fill("1,50");
  await page.getByRole("button", { name: "Salvar grupo" }).click();
  await expect(page.getByText("Opcional, até 2")).toBeVisible();

  // Horário com uma faixa.
  await page.goto(panel("/catalogo/horarios/novo"));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome do horário").fill("Almoço e janta");
  await page.getByLabel("Abre 1").fill("11:00");
  await page.getByLabel("Fecha 1").fill("15:00");
  await page.getByRole("button", { name: "Salvar horário" }).click();
  await expect(page.getByText("Almoço e janta")).toBeVisible();

  // Produto com preço em formato pt-BR, grupo e horário.
  await page.goto(panel("/catalogo/produtos/novo"));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome do produto").fill("Smash Duplo");
  await page.getByLabel("Preço (R$)").fill("R$ 32,5");
  await page.getByLabel("Categoria").selectOption({ label: "Lanches" });
  await page.getByText("Mais opções").click();
  await page.getByLabel("Molhos").check();
  await page.getByLabel("Almoço e janta").check();
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(row(page, "Smash Duplo")).toBeVisible();
  await expect(row(page, "Smash Duplo").getByText("R$ 32,50")).toBeVisible();

  // Vitrine: o item aparece (disponível ou fora do horário, conforme a hora) e o detalhe mostra a regra.
  await page.goto(store("demo-lanche"));
  await page.getByRole("link", { name: /Smash Duplo/ }).click();
  await expect(page.getByRole("heading", { name: "Smash Duplo" })).toBeVisible();
  await expect(page.getByText("Opcional, até 2")).toBeVisible();
  await expect(page.getByText("R$ 32,50")).toBeVisible();

  // Preço inválido não grava e mostra o erro.
  await page.goto(panel("/catalogo/produtos/novo"));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nome do produto").fill("Produto ruim");
  await page.getByLabel("Preço (R$)").fill("abc");
  await page.getByLabel("Categoria").selectOption({ label: "Lanches" });
  await page.getByRole("button", { name: "Salvar produto" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Preço inválido" })).toBeVisible();

  // Id que não existe: 404, nunca 500.
  const res = await page.goto(panel("/catalogo/produtos/nao-e-um-uuid"));
  expect(res?.status()).toBe(404);
});

test("vitrine mostra preço inicial, regra do grupo e item fora do horário", async ({ page }) => {
  await page.goto(store("demo-lanche"));
  await expect(page.getByText("a partir de R$ 18,00")).toBeVisible();
  await expect(page.getByText("Indisponível no momento")).toBeVisible(); // Caldo Verde (Ceia sem faixas)
  await page.getByRole("link", { name: /X-Burger/ }).click();
  await expect(page.getByText("Obrigatório, escolha 1")).toBeVisible();
  await expect(page.getByText("Ao ponto")).toBeVisible();
});

test("atendente só pausa: sem editar e sem acesso às telas de edição", async ({ page }) => {
  await login(page, "atendente@demo.test");
  await expect(page.getByRole("heading", { name: "Demo Lanche" })).toBeVisible();
  await page.goto(panel("/catalogo"));

  await expect(page.getByRole("link", { name: "Novo produto" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Editar" })).toHaveCount(0);
  await row(page, "X-Burger").getByRole("button", { name: "Esgotado hoje" }).click();
  await expect(row(page, "X-Burger").getByText("Pausado até 00:00")).toBeVisible();
  await row(page, "X-Burger").getByRole("button", { name: "Voltar a vender" }).click();
  await expect(row(page, "X-Burger").getByRole("button", { name: "Esgotado hoje" })).toBeVisible();

  // Telas de edição à mão: redireciona para a página inicial.
  for (const path of ["/catalogo/produtos/novo", "/catalogo/opcoes", "/catalogo/horarios", "/catalogo/categorias/nova"]) {
    await page.goto(panel(path));
    await expect(page).toHaveURL(panel("/"));
  }
});
```

Observação: as duas primeiras fases do segundo teste dependem do select de categoria listar "Lanches" (existe no seed) e do `<details>` "Mais opções" estar fechado até o clique. Se `getByText("Mais opções")` casar com mais de um elemento, restringir a `getByText("Mais opções", { exact: true })`.

- [ ] **Step 3: Rodar o e2e do catálogo e o de staff**

Run: `npm run e2e -- tests/e2e/catalog.spec.ts tests/e2e/staff.spec.ts`
Expected: `8 passed` (4 do catálogo + 4 de staff). Falhou por seletor? Ajustar o seletor no teste ou o rótulo acessível no componente (sem enfraquecer a asserção).

- [ ] **Step 4: Corrigir a spec e os follow-ups**

Em `docs/superpowers/specs/2026-10-03-bora-catalogo-design.md`:
- Seção 6, "Rotas": acrescentar `/catalogo/categorias/nova` e `/catalogo/categorias/[id]` à lista; em "Formulário do produto" ponto 4, trocar "ou criar dentro do produto (\"Adicionar opções\"), que fica salvo na biblioteca" por "ou abrir \"Adicionar opções\", que leva ao cadastro de grupos (formulário dentro de formulário é HTML inválido)".
- Seção 6, "Regras de UI": trocar "Formulários são Server Actions com `useActionState`." por "Formulários são Server Actions; erro volta por redirect com `?erro=` (mesmo padrão do login) e o HTML (`required`, `maxLength`) evita a maioria dos erros antes do servidor."
- Seção 6, "Regras de UI": onde diz "Componentes Shadcn novos: `textarea`, `select`, `checkbox`, `badge`", acrescentar "(select e checkbox nativos estilizados)".
- Seção 7: onde diz "Detalhe do produto em `/p/[id]`", manter; `Status:` do cabeçalho passa de "aguardando revisão" para "implementado".

Em `docs/superpowers/follow-ups-catalogo.md`: marcar como resolvidos os itens "Toda Server Action chama `requireAction`" (via `authorizeCatalog`) e "teste do atendente" (e2e `catalog.spec.ts`); manter abertos "Ctx com marca" (decidido não fazer) e `buildPanel` sem variação ativa; acrescentar: "Criar grupo de opções a partir do formulário de produto novo perde o que foi digitado (hoje é um link); avaliar no polimento."

- [ ] **Step 5: Verificação completa**

Run: `npm run lint && npm run typecheck && npm test`
Expected: tudo verde.

Run: `npm run e2e:prod`
Expected: todos passam (11 anteriores + 4 do catálogo = 15).

- [ ] **Step 6: Commit e handoff**

```bash
git add scripts tests docs
git commit -m "test(catalog): seed e e2e do painel e da vitrine; docs ajustadas"
```

Em seguida, usar `superpowers:finishing-a-development-branch`. Escopo restante do sub-projeto 3 (carrinho, pedido e checkout) tem spec própria; a decisão sobre `/api` em hosts de loja fica para lá.

---

## Self-Review

- **Cobertura da spec (seções 6–8):** route groups `(auth)`/`(shell)` e passthrough → Task 1; lista com selos, pausa em destaque por linha, subir/descer, atendente somente leitura → Tasks 3–4; formulário de produto (dados, variações com `parseBRL` no servidor, etiquetas, grupos, horários, arquivar/duplicar, "Mais opções" recolhido, produto novo só nome/preço/categoria) → Task 5; grupos com texto de ajuda → Task 6; horários com `<input type="time">` e aviso de madrugada → Task 7; vitrine com barra de categorias fixa, linha com "a partir de", esmaecimento com texto de retorno, filtro `?dieta=`, detalhe `/p/[id]`, metadados, `force-dynamic`, imagens `loading="lazy"` com `width`/`height` → Task 8; CSP de `img-src https:` já travado por teste (plano do servidor, Task 8 dele); testes e2e da seção 8 (ciclo do dono, pausa, atendente, filtro, modelo inicial, staff continua verde) → Task 9. Alerta sonoro e JSON-LD ficam fora, como na spec.
- **Placeholders:** nenhum "TBD/TODO"; todo passo de código traz o código. As observações do implementador na Task 9 (array do driver, seletor) são contingências concretas, não lacunas.
- **Consistência de tipos/nomes:** contrato de campos de `FormData` definido na Task 2 e usado igual em `PriceRows` (Task 5/6: `variantId|Name|Price`, `itemId|Name|Price`), `WindowRows` (Task 7: `winDay|Opens|Closes`), `CategoryForm`/`ProductForm` (`scheduleIds`, `optionGroupIds`, `dietary`, `categoryId`, `imageUrl`, `description`, `name`); ações recebem `id` por campo oculto; `failCode`/`seg` (Task 3) usados nas Tasks 4–7; `authorizeCatalog` e `CatalogAuth` (Task 3) usados em todas; rótulos acessíveis do e2e (`Nome do item 1`, `Acréscimo do item 2`, `Abre 1`, `Fecha 1`, `Esgotado hoje`, `Voltar a vender`, `Novo produto`, `Editar`) batem com os componentes.
- **Review Focus:** atendente e id inválido (e2e Task 9), preço pt-BR e inválido (unit Task 2 + e2e), `00:00` ao fechar e aviso de madrugada (unit Tasks 2 e 7), `?dieta=xyz` (unit + e2e), arquivamento por remoção de linha (texto de ajuda nas Tasks 5 e 6; comportamento já provado no plano do servidor), item pausado/fora do horário (unit Task 2 + e2e).
- **Pontos de atenção na execução:** (1) `getStaffContext` roda no layout e na página (duas leituras por request); aceitável, otimizar com `cache()` só se medir custo. (2) `redirect()` lança: nunca chamar dentro de `try/catch`. (3) `page.getByRole("listitem")` no e2e depende de linhas de produto serem `<li>`; manter. (4) Em dev, a primeira visita a cada rota compila sob demanda: os testes usam `networkidle` antes de interagir com componentes cliente.
