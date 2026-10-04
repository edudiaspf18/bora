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
