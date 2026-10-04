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

  it("id de item repetido no payload: invalid (sem exceção de banco)", async () => {
    const gid = id(await createOptionGroup(a, group()));
    const { groups } = await listForPanel(a.tenantId, NOW, SP);
    const keep = groups[0].items[0];
    expect(
      await updateOptionGroup(a, gid, group({
        items: [{ id: keep.id, name: "x", priceDeltaCents: 0 }, { id: keep.id, name: "y", priceDeltaCents: 0 }],
      })),
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
    const cat = id(await createCategory(a, { name: "Açaí", scheduleIds: [sid] }));
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
