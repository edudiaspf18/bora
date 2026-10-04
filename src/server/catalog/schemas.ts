import { z } from "zod";
import { MAX_CENTS } from "@/lib/money";

export const DIETARY = [
  "vegan",
  "vegetarian",
  "gluten_free",
  "lactose_free",
  "contains_peanut",
  "contains_nuts",
  "contains_egg",
  "contains_shellfish",
  "spicy",
] as const;
export type Dietary = (typeof DIETARY)[number];

const uuid = z.string().uuid();
const uniqueUuids = (max: number) =>
  z
    .array(uuid)
    .max(max)
    .refine((ids) => new Set(ids).size === ids.length, "ids repetidos");
const name = (max: number) => z.string().trim().min(1).max(max);
const cents = z.number().int().min(0).max(MAX_CENTS);

export const categoryInputSchema = z.object({
  name: name(80),
  scheduleIds: uniqueUuids(10).default([]),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

const httpsUrl = z
  .string()
  .max(500)
  .refine((v) => {
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "só https");

export const productInputSchema = z.object({
  categoryId: uuid,
  name: name(120),
  description: z.string().trim().max(500).default(""),
  imageUrl: httpsUrl.nullable().default(null),
  dietary: z
    .array(z.enum(DIETARY))
    .max(DIETARY.length)
    .refine((d) => new Set(d).size === d.length, "etiquetas repetidas")
    .default([]),
  variants: z
    .array(z.object({ id: uuid.optional(), name: name(60), priceCents: cents }))
    .min(1)
    .max(20),
  optionGroupIds: uniqueUuids(20).default([]),
  scheduleIds: uniqueUuids(10).default([]),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const optionGroupInputSchema = z
  .object({
    name: name(80),
    minSelect: z.number().int().min(0),
    maxSelect: z.number().int().min(1),
    items: z
      .array(z.object({ id: uuid.optional(), name: name(80), priceDeltaCents: cents }))
      .min(1)
      .max(50),
  })
  .refine((g) => g.minSelect <= g.maxSelect, { message: "mínimo maior que o máximo" })
  .refine((g) => g.maxSelect <= g.items.length, { message: "máximo maior que o número de itens" });
export type OptionGroupInput = z.infer<typeof optionGroupInputSchema>;

export const scheduleInputSchema = z.object({
  name: name(80),
  windows: z
    .array(
      z
        .object({
          weekday: z.number().int().min(0).max(6),
          opensMin: z.number().int().min(0).max(1439),
          closesMin: z.number().int().min(1).max(1440),
        })
        .refine((w) => w.opensMin !== w.closesMin, { message: "abre e fecha no mesmo minuto" }),
    )
    .min(1)
    .max(28),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
