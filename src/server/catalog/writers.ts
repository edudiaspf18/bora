import { and, asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/server/db/client";
import {
  catalogCategories, catalogProducts, catalogVariants, categorySchedules,
  optionGroups, optionItems, productOptionGroups, productSchedules, scheduleWindows, schedules,
} from "@/server/db/schema";
import type { CategoryInput, OptionGroupInput, ProductInput, ScheduleInput } from "./schemas";

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

export async function insertOptionGroup(tx: Tx, tenantId: string, input: OptionGroupInput): Promise<string> {
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${optionGroups.position}), -1) + 1` })
    .from(optionGroups);
  const [row] = await tx
    .insert(optionGroups)
    .values({ tenantId, name: input.name, minSelect: input.minSelect, maxSelect: input.maxSelect, position: next })
    .returning({ id: optionGroups.id });
  await tx.insert(optionItems).values(
    input.items.map((i, position) => ({ tenantId, groupId: row.id, name: i.name, priceDeltaCents: i.priceDeltaCents, position })),
  );
  return row.id;
}

/**
 * Itens com id são atualizados, sem id criados, omitidos arquivados.
 * false (antes de qualquer escrita) se id repetido ou se algum id não for do grupo.
 */
export async function syncOptionItems(tx: Tx, tenantId: string, groupId: string, input: OptionGroupInput): Promise<boolean> {
  const existing = await tx.select({ id: optionItems.id }).from(optionItems).where(eq(optionItems.groupId, groupId));
  const existingIds = new Set(existing.map((i) => i.id));
  const sent = input.items.flatMap((i) => (i.id ? [i.id] : []));
  if (new Set(sent).size !== sent.length) return false; // id repetido no payload
  if (sent.some((id) => !existingIds.has(id))) return false;
  const kept = new Set<string>();
  for (const [position, i] of input.items.entries()) {
    if (i.id) {
      kept.add(i.id);
      await tx.update(optionItems)
        .set({ name: i.name, priceDeltaCents: i.priceDeltaCents, position, active: true })
        .where(eq(optionItems.id, i.id));
    } else {
      await tx.insert(optionItems).values({ tenantId, groupId, name: i.name, priceDeltaCents: i.priceDeltaCents, position });
    }
  }
  for (const id of existingIds) {
    if (!kept.has(id)) await tx.update(optionItems).set({ active: false }).where(eq(optionItems.id, id));
  }
  return true;
}

export async function insertSchedule(tx: Tx, tenantId: string, input: ScheduleInput): Promise<string> {
  const [row] = await tx.insert(schedules).values({ tenantId, name: input.name }).returning({ id: schedules.id });
  await tx.insert(scheduleWindows).values(
    input.windows.map((w) => ({ tenantId, scheduleId: row.id, weekday: w.weekday, opensMin: w.opensMin, closesMin: w.closesMin })),
  );
  return row.id;
}

/** Copia produto + variações ativas + ligações. null se o produto não existir na loja. */
export async function cloneProduct(
  tx: Tx, tenantId: string, productId: string,
  to: { categoryId: string; name: string; active: boolean },
): Promise<string | null> {
  const [src] = await tx.select().from(catalogProducts).where(eq(catalogProducts.id, productId));
  if (!src) return null;
  const variants = await tx.select().from(catalogVariants)
    .where(and(eq(catalogVariants.productId, productId), eq(catalogVariants.active, true)))
    .orderBy(asc(catalogVariants.position));
  const groups = await tx.select().from(productOptionGroups).where(eq(productOptionGroups.productId, productId));
  const scheds = await tx.select().from(productSchedules).where(eq(productSchedules.productId, productId));
  const [{ next }] = await tx
    .select({ next: sql<number>`coalesce(max(${catalogProducts.position}), -1) + 1` })
    .from(catalogProducts)
    .where(eq(catalogProducts.categoryId, to.categoryId));
  const [row] = await tx.insert(catalogProducts).values({
    tenantId, categoryId: to.categoryId, name: to.name.slice(0, 120), description: src.description,
    imageUrl: src.imageUrl, dietary: src.dietary, position: next, active: to.active,
  }).returning({ id: catalogProducts.id });
  if (variants.length > 0) {
    await tx.insert(catalogVariants).values(
      variants.map((v, position) => ({ tenantId, productId: row.id, name: v.name, priceCents: v.priceCents, position })),
    );
  }
  if (groups.length > 0) {
    await tx.insert(productOptionGroups).values(
      groups.map((g) => ({ tenantId, productId: row.id, groupId: g.groupId, position: g.position })),
    );
  }
  if (scheds.length > 0) {
    await tx.insert(productSchedules).values(scheds.map((s) => ({ tenantId, productId: row.id, scheduleId: s.scheduleId })));
  }
  return row.id;
}
