import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, middleware } from "@/middleware";

function req(host: string, path = "/") {
  return new NextRequest(`http://${host}${path}`, { headers: { host } });
}

afterEach(() => vi.unstubAllEnvs());

describe("middleware", () => {
  it("vitrine: reescreve para /s/{slug}", () => {
    const res = middleware(req("demo.bora.test", "/entrar"));
    expect(res.headers.get("x-middleware-rewrite")).toMatch(/\/s\/demo\/entrar$/);
  });
  it("vitrine na raiz: /s/{slug}", () => {
    const res = middleware(req("demo.bora.test", "/"));
    expect(res.headers.get("x-middleware-rewrite")).toMatch(/\/s\/demo$/);
  });
  it("domínio próprio: segmento é o host", () => {
    const res = middleware(req("cardapio.loja.com.br", "/"));
    expect(res.headers.get("x-middleware-rewrite")).toMatch(/\/s\/cardapio\.loja\.com\.br$/);
  });
  it("painel: reescreve para /panel", () => {
    const res = middleware(req("app.bora.test", "/login"));
    expect(res.headers.get("x-middleware-rewrite")).toMatch(/\/panel\/login$/);
  });
  it("fetch interno de redirect() em dev (loopback + localhost) usa x-forwarded-host", () => {
    vi.stubEnv("ROOT_DOMAIN", "localhost");
    const r = new NextRequest("http://localhost:3100/login", {
      headers: { host: "localhost:3100", "x-forwarded-host": "app.localhost:3100" },
    });
    expect(middleware(r).headers.get("x-middleware-rewrite")).toMatch(/\/panel\/login$/);
  });
  it("produção: x-forwarded-host forjado é ignorado", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ROOT_DOMAIN", "bora.test");
    const r = new NextRequest("http://demo.bora.test/entrar", {
      headers: { host: "demo.bora.test", "x-forwarded-host": "app.bora.test" },
    });
    expect(middleware(r).headers.get("x-middleware-rewrite")).toMatch(/\/s\/demo\/entrar$/);
  });
  it("produção sem ROOT_DOMAIN falha fechado (404 com CSP)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ROOT_DOMAIN", undefined);
    const res = middleware(req("bora.test", "/"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });
  it("landing passa direto", () => {
    const res = middleware(req("bora.test", "/"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
  it("rotas internas não são acessíveis direto", () => {
    expect(middleware(req("bora.test", "/panel/login")).status).toBe(404);
    expect(middleware(req("bora.test", "/s/demo")).status).toBe(404);
    expect(middleware(req("demo.bora.test", "/panel")).status).toBe(404);
    expect(middleware(req("app.bora.test", "/s/demo")).status).toBe(404);
  });
  it("host inválido ou slug reservado dá 404", () => {
    expect(middleware(req("api.bora.test")).status).toBe(404);
    expect(middleware(req("a.b.bora.test")).status).toBe(404);
  });
  it("define CSP com o mesmo nonce enviado ao request", () => {
    const res = middleware(req("bora.test", "/"));
    const csp = res.headers.get("content-security-policy") ?? "";
    const nonce = res.headers.get("x-middleware-request-x-nonce") ?? "";
    expect(nonce.length).toBeGreaterThan(10);
    expect(csp).toContain(`'nonce-${nonce}'`);
  });
  it("paths pontuados internos dão 404 em qualquer host", () => {
    for (const p of ["/s/cardapio.loja.com.br", "/panel/x.y", "/s/demo/a.b"]) {
      expect(middleware(req("bora.test", p)).status).toBe(404);
    }
    expect(middleware(req("demo.bora.test", "/s/cardapio.loja.com.br")).status).toBe(404);
    expect(middleware(req("demo.bora.test", "/panel/x.y")).status).toBe(404);
  });
  it("paths codificados ou estranhos dão 404", () => {
    for (const p of ["/%70anel/login", "/%73/demo", "//s/demo", "/S/demo", "/PANEL", "/%E0%A4%A"]) {
      expect(middleware(req("bora.test", p)).status).toBe(404);
    }
  });
  it("arquivo estático na vitrine não é reescrito e leva CSP", () => {
    const res = middleware(req("demo.bora.test", "/logo.svg"));
    expect(res.status).not.toBe(404);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });
  it("404 leva CSP", () => {
    const res = middleware(req("bora.test", "/panel"));
    expect(res.headers.get("content-security-policy")).toBeTruthy();
  });
  it("CSP no request em resposta pass-through", () => {
    const res = middleware(req("bora.test", "/"));
    const nonce = res.headers.get("x-middleware-request-x-nonce") ?? "";
    expect(res.headers.get("x-middleware-request-content-security-policy")).toContain(`'nonce-${nonce}'`);
  });
  it("matcher cobre paths pontuados internos e ignora _next/static", () => {
    const re = new RegExp("^" + config.matcher[0] + "$");
    expect(re.test("/s/cardapio.loja.com.br")).toBe(true);
    expect(re.test("/panel/x.y")).toBe(true);
    expect(re.test("/_next/static/x.js")).toBe(false);
  });
});
