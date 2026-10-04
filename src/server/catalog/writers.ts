import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/server/db/client";
import {
  catalogCategories, catalogProducts, catalogVariants, categorySchedules,
  productOptionGroups, productSchedules,
} from "@/server/db/schema";
import type { CategoryInput, ProductInput } from "./schemas";

export type CountableTable =
  | "catalog_categories" | "catalog_products" | "option_groups" | "schedules";

/** Quantos dos ids existem na loja atual (a RLS já filtra por tenant). */
export async function countExisting(tx: Tx, table: CountableTable, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const rows = await tx.execute(sql`select count(*)::int as n from ${sql.identifier(table)} where id in (${list})`);
  return (rows[0] as unknown as { n: number }).n;
}

export async function insertCategory(tx: Tx, tenantId: string, input: CategoryInput): Promise<string> {
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${catalogCategories.position}), -1) + 1` })
    .from(catalogCategories);
  const [row] = await tx
    .insert(catalogCategories)
    .values({ tenantId, name: input.name, position: next })
    .returning({ id: catalogCategories.id });
  if (input.scheduleIds.length > 0) {
    await tx.insert(categorySchedules).values(
      input.scheduleIds.map((scheduleId) => ({ tenantId, categoryId: row.id, scheduleId })),
    );
  }
  return row.id;
}

export async function insertProduct(tx: Tx, tenantId: string, input: ProductInput): Promise<string> {
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${catalogProducts.position}), -1) + 1` })
    .from(catalogProducts)
    .where(eq(catalogProducts.categoryId, input.categoryId));
  const [row] = await tx
    .insert(catalogProducts)
    .values({
      tenantId, categoryId: input.categoryId, name: input.name, description: input.description,
      imageUrl: input.imageUrl, dietary: input.dietary, position: next,
    })
    .returning({ id: catalogProducts.id });
  await syncProductChildren(tx, tenantId, row.id, input);
  return row.id;
}

/**
 * Variações: as com id são atualizadas, as sem id são criadas e as omitidas são arquivadas (nunca apagadas).
 * Grupos e horários são configuração, não histórico: substituídos por inteiro.
 * Devolve false se algum variant.id não pertencer ao produto.
 */
export async function syncProductChildren(tx: Tx, tenantId: string, productId: string, input: ProductInput): Promise<boolean> {
  const existing = await tx.select({ id: catalogVariants.id }).from(catalogVariants).where(eq(catalogVariants.productId, productId));
  const existingIds = new Set(existing.map((v) => v.id));
  const sent = input.variants.flatMap((v) => (v.id ? [v.id] : []));
  if (new Set(sent).size !== sent.length) return false; // id repetido no payload
  if (sent.some((id) => !existingIds.has(id))) return false;

  const kept = new Set<string>();
  for (const [position, v] of input.variants.entries()) {
    if (v.id) {
      kept.add(v.id);
      await tx.update(catalogVariants)
        .set({ name: v.name, priceCents: v.priceCents, position, active: true })
        .where(eq(catalogVariants.id, v.id));
    } else {
      await tx.insert(catalogVariants).values({ tenantId, productId, name: v.name, priceCents: v.priceCents, position });
    }
  }
  for (const id of existingIds) {
    if (!kept.has(id)) await tx.update(catalogVariants).set({ active: false }).where(eq(catalogVariants.id, id));
  }

  await tx.delete(productOptionGroups).where(eq(productOptionGroups.productId, productId));
  if (input.optionGroupIds.length > 0) {
    await tx.insert(productOptionGroups).values(
      input.optionGroupIds.map((groupId, position) => ({ tenantId, productId, groupId, position })),
    );
  }
  await tx.delete(productSchedules).where(eq(productSchedules.productId, productId));
  if (input.scheduleIds.length > 0) {
    await tx.insert(productSchedules).values(
      input.scheduleIds.map((scheduleId) => ({ tenantId, productId, scheduleId })),
    );
  }
  return true;
}
