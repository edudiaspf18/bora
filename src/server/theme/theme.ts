import { z } from "zod";
import { validateAccent } from "./contrast";

const FONT_VAR = {
  geist: "var(--font-geist-sans)",
  inter: "var(--font-inter)",
  editorial: "var(--font-editorial)",
} as const;

const RADIUS = { sm: "0.25rem", md: "0.5rem", lg: "0.75rem" } as const;

export const themeSchema = z.object({
  accent: z
    .string()
    .superRefine((value, ctx) => {
      const result = validateAccent(value);
      if (!result.ok) ctx.addIssue({ code: "custom", message: result.reason });
    })
    .transform((value) => value.toLowerCase()),
  font: z.enum(["geist", "inter", "editorial"]),
  radius: z.enum(["sm", "md", "lg"]),
  logoUrl: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "Use uma URL http(s).")
    .nullable(),
});

export type Theme = z.infer<typeof themeSchema>;

export const defaultTheme: Theme = {
  accent: "#ea580c",
  font: "geist",
  radius: "md",
  logoUrl: null,
};

/** Só emite valores vindos de regex estrita ou de enum: seguro para <style>. */
export function themeToCss(theme: Theme): string {
  const result = validateAccent(theme.accent);
  if (!result.ok) throw new Error("Tema inválido");
  return (
    `:root{--brand:${result.accent};--brand-foreground:${result.foreground};` +
    `--primary:var(--brand);--primary-foreground:var(--brand-foreground);` +
    `--ring:var(--brand);--radius:${RADIUS[theme.radius]};` +
    `--font-store:${FONT_VAR[theme.font]}}`
  );
}
