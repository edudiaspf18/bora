import { describe, expect, it } from "vitest";
import { defaultTheme, themeSchema, themeToCss } from "@/server/theme/theme";

describe("themeSchema", () => {
  it("aceita o tema padrão", () => {
    expect(themeSchema.safeParse(defaultTheme).success).toBe(true);
  });
  it("normaliza accent para minúsculas", () => {
    const parsed = themeSchema.parse({ ...defaultTheme, accent: "#BE185D" });
    expect(parsed.accent).toBe("#be185d");
  });
  it("rejeita fonte, raio e accent fora da lista/formato", () => {
    expect(themeSchema.safeParse({ ...defaultTheme, font: "comic" }).success).toBe(false);
    expect(themeSchema.safeParse({ ...defaultTheme, radius: "xl" }).success).toBe(false);
    expect(
      themeSchema.safeParse({ ...defaultTheme, accent: "#fff;}body{display:none" }).success,
    ).toBe(false);
    expect(themeSchema.safeParse({ ...defaultTheme, accent: "#ffffff" }).success).toBe(false);
  });
  it("logoUrl só aceita http(s) ou null", () => {
    expect(themeSchema.safeParse({ ...defaultTheme, logoUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(themeSchema.safeParse({ ...defaultTheme, logoUrl: "https://x.com/l.png" }).success).toBe(true);
  });
});

describe("themeToCss", () => {
  it("emite as variáveis esperadas", () => {
    const css = themeToCss({ ...defaultTheme, accent: "#be185d", radius: "lg", font: "inter" });
    expect(css).toContain("--brand:#be185d");
    expect(css).toContain("--brand-foreground:#ffffff");
    expect(css).toContain("--primary:var(--brand)");
    expect(css).toContain("--radius:0.75rem");
    expect(css).toContain("--font-store:var(--font-inter)");
    expect(css.startsWith(":root{")).toBe(true);
  });
  it("nunca contém caracteres que quebrem o bloco de estilo", () => {
    const css = themeToCss(defaultTheme);
    expect(css).not.toMatch(/[<>]/);
    expect((css.match(/\{/g) ?? []).length).toBe(1);
  });
});
