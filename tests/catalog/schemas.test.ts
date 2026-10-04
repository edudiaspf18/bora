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

describe("imageUrl espelha o CHECK do banco (^https://, <= 500)", () => {
  const parse = (imageUrl: string) => productInputSchema.safeParse(product({ imageUrl }));
  it.each([
    [" https://x.com/a.png", "https://x.com/a.png"],
    ["\thttps://x.com/a.png", "https://x.com/a.png"],
    ["HTTPS://x.com/a.png", "https://x.com/a.png"],
  ])("normaliza %j", (input, esperado) => {
    const r = parse(input);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.imageUrl).toBe(esperado);
  });
  it.each([
    ["https:x.com/a.png"],
    ["https://"],
    ["http://x.com/a.png"],
    [`https://x.com/${"a".repeat(500)}`],
  ])("recusa %j", (input) => {
    expect(parse(input).success).toBe(false);
  });
  it("todo valor aceito satisfaz ^https:// e <= 500", () => {
    for (const v of [" https://x.com/a b.png ", "HTTPS://X.com/Ü", "https://x.com:443/a"]) {
      const r = parse(v);
      if (r.success) {
        expect(r.data.imageUrl).toMatch(/^https:\/\//);
        expect(r.data.imageUrl?.length).toBeLessThanOrEqual(500);
      }
    }
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
