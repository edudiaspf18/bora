import { describe, expect, it } from "vitest";
import { effectiveHost, normalizeHost, resolveHost, segmentFor } from "@/server/tenancy/host";

const ROOT = "bora.app";

describe("normalizeHost", () => {
  it("minúsculas, sem porta e sem ponto final", () => {
    expect(normalizeHost("Loja.BORA.app:3000")).toBe("loja.bora.app");
    expect(normalizeHost("loja.bora.app.")).toBe("loja.bora.app");
  });
  it("rejeita lixo", () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("a..bora.app")).toBeNull();
    expect(normalizeHost("[::1]:3000")).toBeNull();
    expect(normalizeHost("loja.bora.app/../x")).toBeNull();
    expect(normalizeHost("loja bora.app")).toBeNull();
    expect(normalizeHost("a".repeat(300))).toBeNull();
  });
});

describe("resolveHost", () => {
  it("host customizado sem ponto é desconhecido (ex.: localhost com raiz bora.app)", () => {
    expect(resolveHost("localhost:3000", ROOT)).toEqual({ kind: "unknown" });
    expect(resolveHost("intranet", ROOT)).toEqual({ kind: "unknown" });
  });
  it("raiz localhost: localhost continua landing", () => {
    expect(resolveHost("localhost:3000", "localhost")).toEqual({ kind: "landing" });
  });
  it("landing", () => {
    expect(resolveHost("bora.app", ROOT)).toEqual({ kind: "landing" });
    expect(resolveHost("www.bora.app", ROOT)).toEqual({ kind: "landing" });
  });
  it("painel", () => {
    expect(resolveHost("app.bora.app", ROOT)).toEqual({ kind: "panel" });
    expect(resolveHost("APP.bora.app:443", ROOT)).toEqual({ kind: "panel" });
  });
  it("vitrine por slug, ignorando caixa, porta e ponto final", () => {
    expect(resolveHost("acai-do-ze.bora.app", ROOT)).toEqual({ kind: "store", slug: "acai-do-ze" });
    expect(resolveHost("Acai-Do-Ze.Bora.App:8080", ROOT)).toEqual({ kind: "store", slug: "acai-do-ze" });
    expect(resolveHost("acai-do-ze.bora.app.", ROOT)).toEqual({ kind: "store", slug: "acai-do-ze" });
  });
  it("slugs reservados e inválidos são unknown", () => {
    for (const h of ["api", "admin", "static"]) {
      expect(resolveHost(`${h}.bora.app`, ROOT)).toEqual({ kind: "unknown" });
    }
    expect(resolveHost("-ruim.bora.app", ROOT)).toEqual({ kind: "unknown" });
    expect(resolveHost("a.b.bora.app", ROOT)).toEqual({ kind: "unknown" });
  });
  it("host fora do domínio raiz é custom", () => {
    expect(resolveHost("cardapio.minhaloja.com.br", ROOT)).toEqual({
      kind: "custom",
      host: "cardapio.minhaloja.com.br",
    });
    expect(resolveHost("evilbora.app", ROOT)).toEqual({ kind: "custom", host: "evilbora.app" });
  });
  it("host ausente ou malformado é unknown, nunca lança", () => {
    expect(resolveHost(null, ROOT)).toEqual({ kind: "unknown" });
    expect(resolveHost("[::1]", ROOT)).toEqual({ kind: "unknown" });
    expect(resolveHost("a..b", ROOT)).toEqual({ kind: "unknown" });
  });
  it("funciona com root localhost", () => {
    expect(resolveHost("demo.localhost:3000", "localhost")).toEqual({ kind: "store", slug: "demo" });
    expect(resolveHost("localhost:3000", "localhost")).toEqual({ kind: "landing" });
  });
});

describe("segmentFor", () => {
  it("slug para loja, host para custom, null nos demais", () => {
    expect(segmentFor({ kind: "store", slug: "x" })).toBe("x");
    expect(segmentFor({ kind: "custom", host: "a.b.com" })).toBe("a.b.com");
    expect(segmentFor({ kind: "landing" })).toBeNull();
    expect(segmentFor({ kind: "panel" })).toBeNull();
    expect(segmentFor({ kind: "unknown" })).toBeNull();
  });
});

describe("effectiveHost", () => {
  it("ignora x-forwarded-host forjado em host público", () => {
    expect(effectiveHost("app.bora.test", "demo.bora.test", "bora.test")).toBe("app.bora.test");
    expect(effectiveHost("demo.bora.test", "app.bora.test", "bora.test")).toBe("demo.bora.test");
  });
  it("ignora quando ROOT_DOMAIN não é localhost, mesmo com host loopback", () => {
    expect(effectiveHost("localhost:3000", "app.bora.app", "bora.app")).toBe("localhost:3000");
  });
  it("ignora com ROOT_DOMAIN localhost e host público", () => {
    expect(effectiveHost("bora.app", "app.localhost:3100", "localhost")).toBe("bora.app");
    expect(effectiveHost("evil.localhost:3100", "app.localhost:3100", "localhost")).toBe(
      "evil.localhost:3100",
    );
  });
  it("honra com host loopback e ROOT_DOMAIN localhost", () => {
    for (const h of ["localhost:3100", "localhost", "127.0.0.1:3100", "[::1]:3100"]) {
      expect(effectiveHost(h, "demo-acai.localhost:3100", "localhost")).toBe(
        "demo-acai.localhost:3100",
      );
    }
    expect(effectiveHost("localhost:3100", "demo.dev.localhost", "dev.localhost")).toBe(
      "demo.dev.localhost",
    );
  });
  it("forwarded malformado ou ausente cai no host", () => {
    expect(effectiveHost("localhost:3100", "a b!", "localhost")).toBe("localhost:3100");
    expect(effectiveHost("localhost:3100", "", "localhost")).toBe("localhost:3100");
    expect(effectiveHost("localhost:3100", null, "localhost")).toBe("localhost:3100");
  });
});
