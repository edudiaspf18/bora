import { describe, expect, it } from "vitest";
import { buildCsp } from "@/server/security/csp";

describe("buildCsp", () => {
  it("produção: nonce, strict-dynamic, sem unsafe-eval", () => {
    const csp = buildCsp("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
  });
  it("dev: permite eval para o refresh do React", () => {
    expect(buildCsp("n", true)).toContain("'unsafe-eval'");
  });
  it("imagens: só https e data:, nunca http", () => {
    const csp = buildCsp("n", false);
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).not.toMatch(/img-src[^;]*\bhttp:/);
  });
});
