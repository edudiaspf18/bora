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
