import { expect, test } from "@playwright/test";

const PORT = 3100;
const url = (host: string, path = "/") => `http://${host}.localhost:${PORT}${path}`;

test("slug desconhecido retorna 404", async ({ request }) => {
  const res = await request.get(url("nao-existe"));
  expect(res.status()).toBe(404);
});

test("rotas internas não são acessíveis direto", async ({ request }) => {
  expect((await request.get(`http://localhost:${PORT}/panel/login`)).status()).toBe(404);
  expect((await request.get(`http://localhost:${PORT}/s/demo-acai`)).status()).toBe(404);
});

test("cada loja carrega o próprio tema", async ({ page }) => {
  await page.goto(url("demo-acai"));
  const acai = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--brand").trim(),
  );
  expect(acai).toBe("#be185d");

  await page.goto(url("demo-lanche"));
  const lanche = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--brand").trim(),
  );
  expect(lanche).toBe("#15803d");
});

test("tema já vem no HTML do servidor (sem flash)", async ({ request }) => {
  const html = await (await request.get(url("demo-acai"))).text();
  expect(html).toContain("--brand:#be185d");
});

test("resposta traz CSP com nonce", async ({ request }) => {
  const res = await request.get(url("demo-acai"));
  expect(res.headers()["content-security-policy"]).toMatch(/nonce-/);
});
