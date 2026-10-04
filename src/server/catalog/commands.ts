import { eq } from "drizzle-orm";
import { writeAudit } from "@/server/audit";
import type { Tx } from "@/server/db/client";
import { catalogCategories, catalogProducts, catalogVariants, categorySchedules } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { categoryInputSchema, productInputSchema } from "./schemas";
import { countExisting, insertCategory, insertProduct, syncProductChildren } from "./writers";

export interface Ctx {
  tenantId: string;
  actor: string;
}
export type Result = { ok: true; id: string } | { ok: false; reason: "not_found" | "invalid" };

export const NOT_FOUND: Result = { ok: false, reason: "not_found" };
export const INVALID: Result = { ok: false, reason: "invalid" };

/** Roda o comando e, se deu certo, grava a auditoria. */
export async function run(ctx: Ctx, action: string, fn: (tx: Tx) => Promise<Result>): Promise<Result> {
  const result = await withTenant(ctx.tenantId, fn);
  if (result.ok) await writeAudit(ctx.tenantId, { actor: ctx.actor, action, resource: result.id });
  return result;
}

async function linksExist(tx: Tx, groupIds: string[], scheduleIds: string[]): Promise<boolean> {
  return (
    (await countExisting(tx, "option_groups", groupIds)) === groupIds.length &&
    (await countExisting(tx, "schedules", scheduleIds)) === scheduleIds.length
  );
}

export async function createCategory(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = categoryInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  return run(ctx, "catalog.category.create", async (tx) => {
    if ((await countExisting(tx, "schedules", parsed.data.scheduleIds)) !== parsed.data.scheduleIds.length) return NOT_FOUND;
    return { ok: true, id: await insertCategory(tx, ctx.tenantId, parsed.data) };
  });
}

export async function updateCategory(ctx: Ctx, id: string, raw: unknown): Promise<Result> {
  const parsed = categoryInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  return run(ctx, "catalog.category.update", async (tx) => {
    if ((await countExisting(tx, "catalog_categories", [id])) !== 1) return NOT_FOUND;
    if ((await countExisting(tx, "schedules", parsed.data.scheduleIds)) !== parsed.data.scheduleIds.length) return NOT_FOUND;
    await tx.update(catalogCategories).set({ name: parsed.data.name }).where(eq(catalogCategories.id, id));
    await tx.delete(categorySchedules).where(eq(categorySchedules.categoryId, id));
    if (parsed.data.scheduleIds.length > 0) {
      await tx.insert(categorySchedules).values(
        parsed.data.scheduleIds.map((scheduleId) => ({ tenantId: ctx.tenantId, categoryId: id, scheduleId })),
      );
    }
    return { ok: true, id };
  });
}

export async function setCategoryActive(ctx: Ctx, id: string, active: boolean): Promise<Result> {
  return run(ctx, active ? "catalog.category.restore" : "catalog.category.archive", async (tx) => {
    const rows = await tx.update(catalogCategories).set({ active }).where(eq(catalogCategories.id, id)).returning({ id: catalogCategories.id });
    return rows.length === 1 ? { ok: true, id } : NOT_FOUND;
  });
}

export async function createProduct(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const input = parsed.data;
  if (input.variants.some((v) => v.id)) return INVALID; // produto novo não tem variações existentes
  return run(ctx, "catalog.product.create", async (tx) => {
    if ((await countExisting(tx, "catalog_categories", [input.categoryId])) !== 1) return NOT_FOUND;
    if (!(await linksExist(tx, input.optionGroupIds, input.scheduleIds))) return NOT_FOUND;
    return { ok: true, id: await insertProduct(tx, ctx.tenantId, input) };
  });
}

export async function updateProduct(ctx: Ctx, id: string, raw: unknown): Promise<Result> {
  const parsed = productInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  const input = parsed.data;
  return run(ctx, "catalog.product.update", async (tx) => {
    if ((await countExisting(tx, "catalog_products", [id])) !== 1) return NOT_FOUND;
    if ((await countExisting(tx, "catalog_categories", [input.categoryId])) !== 1) return NOT_FOUND;
    if (!(await linksExist(tx, input.optionGroupIds, input.scheduleIds))) return NOT_FOUND;
    // Valida os ids de variação antes de qualquer escrita: erro de negócio vira valor, não exceção.
    const owned = await tx.select({ id: catalogVariants.id }).from(catalogVariants).where(eq(catalogVariants.productId, id));
    const ownedIds = new Set(owned.map((v) => v.id));
    const sent = input.variants.flatMap((v) => (v.id ? [v.id] : []));
    if (new Set(sent).size !== sent.length || sent.some((vid) => !ownedIds.has(vid))) return INVALID; // repetido ou alheio
    await syncProductChildren(tx, ctx.tenantId, id, input);
    await tx.update(catalogProducts).set({
      categoryId: input.categoryId, name: input.name, description: input.description,
      imageUrl: input.imageUrl, dietary: input.dietary,
    }).where(eq(catalogProducts.id, id));
    return { ok: true, id };
  });
}

export async function setProductActive(ctx: Ctx, id: string, active: boolean): Promise<Result> {
  return run(ctx, active ? "catalog.product.restore" : "catalog.product.archive", async (tx) => {
    const rows = await tx.update(catalogProducts).set({ active }).where(eq(catalogProducts.id, id)).returning({ id: catalogProducts.id });
    return rows.length === 1 ? { ok: true, id } : NOT_FOUND;
  });
}

export async function pauseProduct(ctx: Ctx, id: string, until: Date | null): Promise<Result> {
  return run(ctx, until ? "catalog.product.pause" : "catalog.product.resume", async (tx) => {
    const rows = await tx.update(catalogProducts).set({ pausedUntil: until }).where(eq(catalogProducts.id, id)).returning({ id: catalogProducts.id });
    return rows.length === 1 ? { ok: true, id } : NOT_FOUND;
  });
}

async function applyOrder(tx: Tx, table: typeof catalogCategories | typeof catalogProducts, ids: string[]): Promise<void> {
  for (const [position, id] of ids.entries()) {
    await tx.update(table).set({ position }).where(eq(table.id, id));
  }
}

export async function reorderCategories(ctx: Ctx, ids: string[]): Promise<Result> {
  return run(ctx, "catalog.category.reorder", async (tx) => {
    const current = (await tx.select({ id: catalogCategories.id }).from(catalogCategories)).map((r) => r.id);
    if (!sameSet(current, ids)) return INVALID;
    await applyOrder(tx, catalogCategories, ids);
    return { ok: true, id: ctx.tenantId };
  });
}

export async function reorderProducts(ctx: Ctx, categoryId: string, ids: string[]): Promise<Result> {
  return run(ctx, "catalog.product.reorder", async (tx) => {
    const current = (await tx.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.categoryId, categoryId))).map((r) => r.id);
    if (current.length === 0 || !sameSet(current, ids)) return INVALID;
    await applyOrder(tx, catalogProducts, ids);
    return { ok: true, id: categoryId };
  });
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && new Set(b).size === b.length && a.every((id) => b.includes(id));
}
