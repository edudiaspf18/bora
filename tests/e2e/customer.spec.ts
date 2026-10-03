import { readFile, rm } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const PORT = 3100;
const store = (slug: string, path = "/") => `http://${slug}.localhost:${PORT}${path}`;

test("cliente entra por OTP e a sessão não vaza para outra loja", async ({ page }) => {
  await rm(".e2e/otp.json", { force: true });
  await page.goto(store("demo-acai", "/entrar"));
  await page.waitForLoadState("networkidle"); // espera hidratação (dev compila sob demanda)
  await page.getByLabel("Telefone com DDD").fill("(62) 99828-6169");
  await page.getByRole("button", { name: "Receber código" }).click();

  let otp: { code?: string; phone?: string } = {};
  await expect
    .poll(async () => {
      otp = JSON.parse(await readFile(".e2e/otp.json", "utf8").catch(() => "{}"));
      return otp.phone;
    })
    .toBe("+5562998286169");
  const code = otp.code ?? "";

  await page.getByLabel(/Código enviado/).fill(code);
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("heading", { name: "Sua conta" })).toBeVisible();

  // Cookie é por host: a outra loja não reconhece a sessão.
  await page.goto(store("demo-lanche", "/conta"));
  await expect(page).toHaveURL(/\/entrar$/);
});

test("código errado mostra erro", async ({ page }) => {
  await page.goto(store("demo-lanche", "/entrar"));
  await page.waitForLoadState("networkidle"); // espera hidratação (dev compila sob demanda)
  await page.getByLabel("Telefone com DDD").fill("(62) 98888-7777");
  await page.getByRole("button", { name: "Receber código" }).click();
  await page.getByLabel(/Código enviado/).fill("000000");
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "incorreto" })).toBeVisible();
});
