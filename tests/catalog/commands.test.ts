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

  it("id de variação repetido no payload: invalid e nada muda", async () => {
    const cat = mustId(await createCategory(a, { name: "Lanches" }));
    const id = mustId(await createProduct(a, prodInput(cat)));
    const [first] = (await listForPanel(a.tenantId, NOW, SP)).categories[0].products[0].variants;
    const dup = { id: first.id, name: "Simples", priceCents: 1 };
    expect(await updateProduct(a, id, prodInput(cat, { variants: [dup, dup] }))).toEqual({ ok: false, reason: "invalid" });
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
