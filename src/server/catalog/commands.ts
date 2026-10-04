import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import type { Tx } from "@/server/db/client";
import {
  catalogCategories, catalogProducts, catalogVariants, categorySchedules, optionGroups, scheduleWindows, schedules,
} from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { categoryInputSchema, optionGroupInputSchema, productInputSchema, scheduleInputSchema } from "./schemas";
import {
  cloneProduct, countExisting, insertCategory, insertOptionGroup, insertProduct, insertSchedule,
  syncOptionItems, syncProductChildren,
} from "./writers";

export interface Ctx {
  tenantId: string;
  actor: string;
}
export type Result = { ok: true; id: string } | { ok: false; reason: "not_found" | "invalid" };

export const NOT_FOUND: Result = { ok: false, reason: "not_found" };
export const INVALID: Result = { ok: false, reason: "invalid" };

const uuidSchema = z.string().uuid();
/** Id que não é UUID nunca existe; evita o erro 22P02 do Postgres e vira `not_found`. */
const isUuid = (id: string): boolean => uuidSchema.safeParse(id).success;

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
  if (!isUuid(id)) return NOT_FOUND;
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
  if (!isUuid(id)) return NOT_FOUND;
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
  if (!isUuid(id)) return NOT_FOUND;
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
  if (!isUuid(id)) return NOT_FOUND;
  return run(ctx, active ? "catalog.product.restore" : "catalog.product.archive", async (tx) => {
    const rows = await tx.update(catalogProducts).set({ active }).where(eq(catalogProducts.id, id)).returning({ id: catalogProducts.id });
    return rows.length === 1 ? { ok: true, id } : NOT_FOUND;
  });
}

export async function pauseProduct(ctx: Ctx, id: string, until: Date | null): Promise<Result> {
  if (!isUuid(id)) return NOT_FOUND;
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
  if (!isUuid(categoryId)) return NOT_FOUND;
  return run(ctx, "catalog.product.reorder", async (tx) => {
    if ((await countExisting(tx, "catalog_categories", [categoryId])) !== 1) return NOT_FOUND;
    const current = (await tx.select({ id: catalogProducts.id }).from(catalogProducts).where(eq(catalogProducts.categoryId, categoryId))).map((r) => r.id);
    if (current.length === 0 || !sameSet(current, ids)) return INVALID;
    await applyOrder(tx, catalogProducts, ids);
    return { ok: true, id: categoryId };
  });
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && new Set(b).size === b.length && a.every((id) => b.includes(id));
}

export async function createOptionGroup(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = optionGroupInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  return run(ctx, "catalog.group.create", async (tx) => ({ ok: true, id: await insertOptionGroup(tx, ctx.tenantId, parsed.data) }));
}

export async function updateOptionGroup(ctx: Ctx, id: string, raw: unknown): Promise<Result> {
  if (!isUuid(id)) return NOT_FOUND;
  const parsed = optionGroupInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  return run(ctx, "catalog.group.update", async (tx) => {
    if ((await countExisting(tx, "option_groups", [id])) !== 1) return NOT_FOUND;
    // sync valida ids (repetidos/de outro grupo) antes de escrever; só então mexe no grupo
    if (!(await syncOptionItems(tx, ctx.tenantId, id, parsed.data))) return INVALID;
    await tx.update(optionGroups)
      .set({ name: parsed.data.name, minSelect: parsed.data.minSelect, maxSelect: parsed.data.maxSelect })
      .where(eq(optionGroups.id, id));
    return { ok: true, id };
  });
}

export async function createSchedule(ctx: Ctx, raw: unknown): Promise<Result> {
  const parsed = scheduleInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  return run(ctx, "catalog.schedule.create", async (tx) => ({ ok: true, id: await insertSchedule(tx, ctx.tenantId, parsed.data) }));
}

export async function updateSchedule(ctx: Ctx, id: string, raw: unknown): Promise<Result> {
  if (!isUuid(id)) return NOT_FOUND;
  const parsed = scheduleInputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  return run(ctx, "catalog.schedule.update", async (tx) => {
    if ((await countExisting(tx, "schedules", [id])) !== 1) return NOT_FOUND;
    await tx.update(schedules).set({ name: parsed.data.name }).where(eq(schedules.id, id));
    await tx.delete(scheduleWindows).where(eq(scheduleWindows.scheduleId, id));
    await tx.insert(scheduleWindows).values(
      parsed.data.windows.map((w) => ({ tenantId: ctx.tenantId, scheduleId: id, weekday: w.weekday, opensMin: w.opensMin, closesMin: w.closesMin })),
    );
    return { ok: true, id };
  });
}

export async function duplicateProduct(ctx: Ctx, id: string): Promise<Result> {
  if (!isUuid(id)) return NOT_FOUND;
  return run(ctx, "catalog.product.duplicate", async (tx) => {
    const [src] = await tx.select({ name: catalogProducts.name, categoryId: catalogProducts.categoryId })
      .from(catalogProducts).where(eq(catalogProducts.id, id));
    if (!src) return NOT_FOUND;
    const copy = await cloneProduct(tx, ctx.tenantId, id, { categoryId: src.categoryId, name: `${src.name} (cópia)`, active: false });
    return copy ? { ok: true, id: copy } : NOT_FOUND;
  });
}

export async function duplicateCategory(ctx: Ctx, id: string): Promise<Result> {
  if (!isUuid(id)) return NOT_FOUND;
  return run(ctx, "catalog.category.duplicate", async (tx) => {
    const [src] = await tx.select().from(catalogCategories).where(eq(catalogCategories.id, id));
    if (!src) return NOT_FOUND;
    const scheds = await tx.select().from(categorySchedules).where(eq(categorySchedules.categoryId, id));
    const copyId = await insertCategory(tx, ctx.tenantId, {
      name: `${src.name} (cópia)`.slice(0, 80),
      scheduleIds: scheds.map((s) => s.scheduleId),
    });
    await tx.update(catalogCategories).set({ active: false }).where(eq(catalogCategories.id, copyId));
    const products = await tx.select({ id: catalogProducts.id, name: catalogProducts.name })
      .from(catalogProducts)
      .where(and(eq(catalogProducts.categoryId, id), eq(catalogProducts.active, true)))
      .orderBy(asc(catalogProducts.position));
    for (const p of products) {
      await cloneProduct(tx, ctx.tenantId, p.id, { categoryId: copyId, name: p.name, active: true });
    }
    return { ok: true, id: copyId };
  });
}
