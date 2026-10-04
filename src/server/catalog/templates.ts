import { sql } from "drizzle-orm";
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
    // Serializa aplicações concorrentes na mesma loja: a checagem de vazio abaixo fica segura.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('catalog.template'), hashtext(current_tenant()::text))`);
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
          optionGroupIds: (p.groups ?? []).map((k) => requireGroup(groupIds, k)),
          scheduleIds: [],
        });
      }
    }
    return { ok: true };
  });
  if (result.ok) await writeAudit(ctx.tenantId, { actor: ctx.actor, action: "catalog.template.apply", resource: vertical });
  return result;
}

function requireGroup(ids: Map<string, string>, key: string): string {
  const id = ids.get(key);
  if (!id) throw new Error("grupo de modelo inexistente");
  return id;
}
