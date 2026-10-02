import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  normalizeAccent,
  pickForeground,
  validateAccent,
} from "@/server/theme/contrast";

describe("contrastRatio", () => {
  it("preto no branco é 21", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
  });
  it("é simétrico", () => {
    expect(contrastRatio("#ea580c", "#ffffff")).toBeCloseTo(
      contrastRatio("#ffffff", "#ea580c"),
      5,
    );
  });
});

describe("pickForeground", () => {
  it("laranja Bora usa texto escuro (contraste maior)", () => {
    expect(pickForeground("#ea580c")).toBe("#09090b");
  });
  it("azul escuro usa texto branco", () => {
    expect(pickForeground("#1e3a8a")).toBe("#ffffff");
  });
});

describe("normalizeAccent / validateAccent", () => {
  it("normaliza maiúsculas", () => {
    expect(normalizeAccent("#EA580C")).toBe("#ea580c");
  });
  it("rejeita formato inválido e injeção de CSS", () => {
    for (const bad of ["#fff", "red", "ea580c", "#ea580c;}body{display:none", "#gggggg", "", "#ea580c "]) {
      expect(normalizeAccent(bad), bad).toBeNull();
      expect(validateAccent(bad).ok, bad).toBe(false);
    }
  });
  it("rejeita branco e preto puros (somem em um dos modos)", () => {
    expect(validateAccent("#ffffff").ok).toBe(false);
    expect(validateAccent("#09090b").ok).toBe(false);
    expect(validateAccent("#000000").ok).toBe(false);
  });
  it("aceita cores curadas com contraste de texto >= 4.5", () => {
    for (const ok of ["#ea580c", "#be185d", "#15803d", "#1e3a8a", "#ffd600"]) {
      const v = validateAccent(ok);
      expect(v.ok, ok).toBe(true);
      if (v.ok) expect(contrastRatio(v.accent, v.foreground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
