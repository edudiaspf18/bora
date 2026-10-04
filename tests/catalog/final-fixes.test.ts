import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import {
  createCategory, createProduct, duplicateCategory, duplicateProduct, pauseProduct, reorderProducts,
  setCategoryActive, setProductActive, updateCategory, updateOptionGroup, updateProduct, updateSchedule,
  type Ctx,
} from "@/server/catalog/commands";
import { applyTemplate, TEMPLATES } from "@/server/catalog/templates";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

let a: Ctx;
let b: Ctx;
const RANDOM = "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b";

const mustId = (r: { ok: boolean; id?: string }) => {
  if (!r.ok || !r.id) throw new Error("esperava ok");
  return r.id;
};
const prod = (categoryId: string, over: Record<string, unknown> = {}) => ({
  categoryId, name: "X", variants: [{ name: "Un", priceCents: 1000 }], ...over,
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

describe("imageUrl com espaços não estoura o CHECK do banco", () => {
  it("createProduct com URL com padding normaliza e grava", async () => {
    const cat = mustId(await createCategory(a, { name: "C" }));
    const r = await createProduct(a, prod(cat, { imageUrl: "  HTTPS://x.com/a.png\t" }));
    expect(r.ok).toBe(true);
    const rows = await adminSql`select image_url from catalog_products where tenant_id = ${a.tenantId}`;
    expect(rows[0]?.image_url).toBe("https://x.com/a.png");
  });
});

describe("id que não é UUID vira not_found", () => {
  const NF = { ok: false, reason: "not_found" };
  it("todas as famílias de comando", async () => {
    const bad = "not-a-uuid";
    const cat = { name: "C" };
    const sched = { name: "S", windows: [{ weekday: 1, opensMin: 60, closesMin: 120 }] };
    const group = { name: "G", minSelect: 0, maxSelect: 1, items: [{ name: "i", priceDeltaCents: 0 }] };
    const cid = mustId(await createCategory(a, cat));
    expect(await updateCategory(a, bad, cat)).toEqual(NF);
    expect(await setCategoryActive(a, bad, false)).toEqual(NF);
    expect(await updateProduct(a, bad, prod(cid))).toEqual(NF);
    expect(await setProductActive(a, bad, false)).toEqual(NF);
    expect(await pauseProduct(a, bad, null)).toEqual(NF);
    expect(await reorderProducts(a, bad, [])).toEqual(NF);
    expect(await updateOptionGroup(a, bad, group)).toEqual(NF);
    expect(await updateSchedule(a, bad, sched)).toEqual(NF);
    expect(await duplicateProduct(a, bad)).toEqual(NF);
    expect(await duplicateCategory(a, bad)).toEqual(NF);
    expect(await createProduct(a, prod(bad))).toEqual({ ok: false, reason: "invalid" }); // schema já barra
  });
});

describe("reorderProducts com categoria inexistente/alheia", () => {
  it("not_found e nada muda", async () => {
    const catB = mustId(await createCategory(b, { name: "B" }));
    const p1 = mustId(await createProduct(b, prod(catB, { name: "p1" })));
    const p2 = mustId(await createProduct(b, prod(catB, { name: "p2" })));
    const before = await adminSql`select id, position from catalog_products order by id`;
    expect(await reorderProducts(a, catB, [p2, p1])).toEqual({ ok: false, reason: "not_found" });
    expect(await reorderProducts(a, RANDOM, [])).toEqual({ ok: false, reason: "not_found" });
    expect(await adminSql`select id, position from catalog_products order by id`).toEqual(before);
  });
  it("lista incompleta continua invalid", async () => {
    const cat = mustId(await createCategory(a, { name: "A" }));
    mustId(await createProduct(a, prod(cat, { name: "p1" })));
    expect(await reorderProducts(a, cat, [])).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("applyTemplate concorrente", () => {
  it("uma chamada ok, outra not_empty, sem duplicar", async () => {
    const results = await Promise.all([applyTemplate(a, "lanchonete"), applyTemplate(a, "lanchonete")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "not_empty")).toHaveLength(1);
    const [row] = await adminSql`select count(*)::int as n from catalog_categories where tenant_id = ${a.tenantId}`;
    expect(row?.n).toBe(TEMPLATES.lanchonete.categories.length);
  });
});
