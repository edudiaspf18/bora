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
