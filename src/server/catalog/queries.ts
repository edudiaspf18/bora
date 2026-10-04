import { itemAvailability, type Availability, type ScheduleRef, type Window } from "./availability";
import type { Tx } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import {
  catalogCategories,
  catalogProducts,
  catalogVariants,
  categorySchedules,
  optionGroups,
  optionItems,
  productOptionGroups,
  productSchedules,
  scheduleWindows,
  schedules,
} from "@/server/db/schema";

export interface RawCatalog {
  categories: { id: string; name: string; position: number; active: boolean }[];
  products: {
    id: string; categoryId: string; name: string; description: string; imageUrl: string | null;
    position: number; active: boolean; pausedUntil: Date | null; dietary: string[];
  }[];
  variants: { id: string; productId: string; name: string; priceCents: number; position: number; active: boolean }[];
  groups: { id: string; name: string; minSelect: number; maxSelect: number; position: number }[];
  items: { id: string; groupId: string; name: string; priceDeltaCents: number; position: number; active: boolean }[];
  productGroups: { productId: string; groupId: string; position: number }[];
  schedules: { id: string; name: string }[];
  windows: { scheduleId: string; weekday: number; opensMin: number; closesMin: number }[];
  categorySchedules: { categoryId: string; scheduleId: string }[];
  productSchedules: { productId: string; scheduleId: string }[];
}

export async function loadCatalog(tx: Tx): Promise<RawCatalog> {
  const [categories, products, variants, groups, items, productGroups, scheds, windows, catScheds, prodScheds] =
    await Promise.all([
      tx.select({ id: catalogCategories.id, name: catalogCategories.name, position: catalogCategories.position, active: catalogCategories.active }).from(catalogCategories),
      tx.select({
        id: catalogProducts.id, categoryId: catalogProducts.categoryId, name: catalogProducts.name,
        description: catalogProducts.description, imageUrl: catalogProducts.imageUrl,
        position: catalogProducts.position, active: catalogProducts.active,
        pausedUntil: catalogProducts.pausedUntil, dietary: catalogProducts.dietary,
      }).from(catalogProducts),
      tx.select({ id: catalogVariants.id, productId: catalogVariants.productId, name: catalogVariants.name, priceCents: catalogVariants.priceCents, position: catalogVariants.position, active: catalogVariants.active }).from(catalogVariants),
      tx.select({ id: optionGroups.id, name: optionGroups.name, minSelect: optionGroups.minSelect, maxSelect: optionGroups.maxSelect, position: optionGroups.position }).from(optionGroups),
      tx.select({ id: optionItems.id, groupId: optionItems.groupId, name: optionItems.name, priceDeltaCents: optionItems.priceDeltaCents, position: optionItems.position, active: optionItems.active }).from(optionItems),
      tx.select({ productId: productOptionGroups.productId, groupId: productOptionGroups.groupId, position: productOptionGroups.position }).from(productOptionGroups),
      tx.select({ id: schedules.id, name: schedules.name }).from(schedules),
      tx.select({ scheduleId: scheduleWindows.scheduleId, weekday: scheduleWindows.weekday, opensMin: scheduleWindows.opensMin, closesMin: scheduleWindows.closesMin }).from(scheduleWindows),
      tx.select({ categoryId: categorySchedules.categoryId, scheduleId: categorySchedules.scheduleId }).from(categorySchedules),
      tx.select({ productId: productSchedules.productId, scheduleId: productSchedules.scheduleId }).from(productSchedules),
    ]);
  return {
    categories, products, variants, groups, items, productGroups,
    schedules: scheds, windows, categorySchedules: catScheds, productSchedules: prodScheds,
  };
}

export interface MenuOptionGroup {
  id: string; name: string; minSelect: number; maxSelect: number;
  items: { id: string; name: string; priceDeltaCents: number }[];
}
export interface MenuProduct {
  id: string; categoryId: string; name: string; description: string; imageUrl: string | null;
  dietary: string[];
  variants: { id: string; name: string; priceCents: number }[];
  fromPriceCents: number;
  multiplePrices: boolean;
  optionGroups: MenuOptionGroup[];
  availability: Availability;
}
export interface MenuCategory { id: string; name: string; products: MenuProduct[] }

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

function indexSchedules(raw: RawCatalog): Map<string, ScheduleRef> {
  const byId = new Map<string, Window[]>();
  for (const s of raw.schedules) byId.set(s.id, []);
  for (const w of raw.windows) {
    byId.get(w.scheduleId)?.push({ weekday: w.weekday, opensMin: w.opensMin, closesMin: w.closesMin });
  }
  return new Map([...byId].map(([id, windows]) => [id, { windows }]));
}

function refs(ids: string[], index: Map<string, ScheduleRef>): ScheduleRef[] {
  return ids.flatMap((id) => {
    const ref = index.get(id);
    return ref ? [ref] : [];
  });
}

function groupsFor(raw: RawCatalog, productId: string): MenuOptionGroup[] {
  return raw.productGroups
    .filter((pg) => pg.productId === productId)
    .sort(byPosition)
    .flatMap((pg) => {
      const g = raw.groups.find((x) => x.id === pg.groupId);
      if (!g) return [];
      return [{
        id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect,
        items: raw.items.filter((i) => i.groupId === g.id && i.active).sort(byPosition)
          .map((i) => ({ id: i.id, name: i.name, priceDeltaCents: i.priceDeltaCents })),
      }];
    });
}

function toMenuProduct(raw: RawCatalog, p: RawCatalog["products"][number], now: Date, tz: string, idx: Map<string, ScheduleRef>): MenuProduct | null {
  const variants = raw.variants.filter((v) => v.productId === p.id && v.active).sort(byPosition)
    .map((v) => ({ id: v.id, name: v.name, priceCents: v.priceCents }));
  if (variants.length === 0) return null;
  const prices = variants.map((v) => v.priceCents);
  const catIds = raw.categorySchedules.filter((c) => c.categoryId === p.categoryId).map((c) => c.scheduleId);
  const prodIds = raw.productSchedules.filter((s) => s.productId === p.id).map((s) => s.scheduleId);
  return {
    id: p.id, categoryId: p.categoryId, name: p.name, description: p.description, imageUrl: p.imageUrl,
    dietary: p.dietary, variants,
    fromPriceCents: Math.min(...prices),
    multiplePrices: new Set(prices).size > 1,
    optionGroups: groupsFor(raw, p.id),
    availability: itemAvailability(
      { pausedUntil: p.pausedUntil, productSchedules: refs(prodIds, idx), categorySchedules: refs(catIds, idx) },
      now, tz,
    ),
  };
}

export function buildMenu(raw: RawCatalog, now: Date, tz: string, opts: { dietary?: string } = {}): MenuCategory[] {
  const idx = indexSchedules(raw);
  return raw.categories.filter((c) => c.active).sort(byPosition).flatMap((c) => {
    const products = raw.products
      .filter((p) => p.categoryId === c.id && p.active && (!opts.dietary || p.dietary.includes(opts.dietary)))
      .sort(byPosition)
      .flatMap((p) => {
        const m = toMenuProduct(raw, p, now, tz, idx);
        return m ? [m] : [];
      });
    return products.length > 0 ? [{ id: c.id, name: c.name, products }] : [];
  });
}

export async function listMenu(tenantId: string, now: Date, tz: string, opts: { dietary?: string } = {}): Promise<MenuCategory[]> {
  return buildMenu(await withTenant(tenantId, loadCatalog), now, tz, opts);
}

export async function getMenuProduct(tenantId: string, productId: string, now: Date, tz: string): Promise<(MenuProduct & { categoryName: string }) | null> {
  for (const c of await listMenu(tenantId, now, tz)) {
    const p = c.products.find((x) => x.id === productId);
    if (p) return { ...p, categoryName: c.name };
  }
  return null;
}

export interface PanelProduct extends MenuProduct {
  active: boolean; pausedUntil: Date | null; optionGroupIds: string[]; scheduleIds: string[];
}
export interface PanelCategory { id: string; name: string; active: boolean; scheduleIds: string[]; products: PanelProduct[] }
export interface PanelGroup { id: string; name: string; minSelect: number; maxSelect: number; items: { id: string; name: string; priceDeltaCents: number }[] }
export interface PanelSchedule { id: string; name: string; windows: Window[] }

export function buildPanel(raw: RawCatalog, now: Date, tz: string): { categories: PanelCategory[]; groups: PanelGroup[]; schedules: PanelSchedule[] } {
  const idx = indexSchedules(raw);
  const categories = raw.categories.slice().sort(byPosition).map((c) => ({
    id: c.id, name: c.name, active: c.active,
    scheduleIds: raw.categorySchedules.filter((x) => x.categoryId === c.id).map((x) => x.scheduleId),
    products: raw.products.filter((p) => p.categoryId === c.id).sort(byPosition).flatMap((p) => {
      const m = toMenuProduct(raw, p, now, tz, idx);
      if (!m) return [];
      return [{
        ...m, active: p.active, pausedUntil: p.pausedUntil,
        optionGroupIds: raw.productGroups.filter((g) => g.productId === p.id).sort(byPosition).map((g) => g.groupId),
        scheduleIds: raw.productSchedules.filter((s) => s.productId === p.id).map((s) => s.scheduleId),
      }];
    }),
  }));
  const groups = raw.groups.slice().sort(byPosition).map((g) => ({
    id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect,
    items: raw.items.filter((i) => i.groupId === g.id && i.active).sort(byPosition)
      .map((i) => ({ id: i.id, name: i.name, priceDeltaCents: i.priceDeltaCents })),
  }));
  const scheds = raw.schedules.map((s) => ({ id: s.id, name: s.name, windows: idx.get(s.id)?.windows ?? [] }));
  return { categories, groups, schedules: scheds };
}

export async function listForPanel(tenantId: string, now: Date, tz: string) {
  return buildPanel(await withTenant(tenantId, loadCatalog), now, tz);
}
