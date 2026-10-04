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
