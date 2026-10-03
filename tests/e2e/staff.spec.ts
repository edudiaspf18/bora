import { expect, test } from "@playwright/test";

const PORT = 3100;
const panel = (path = "/") => `http://app.localhost:${PORT}${path}`;

test("senha errada mostra erro", async ({ page }) => {
  await page.goto(panel("/login"));
  await page.waitForLoadState("networkidle"); // espera hidratação (dev compila sob demanda)
  await page.getByLabel("E-mail").fill("atendente@demo.test");
  await page.getByLabel("Senha").fill("senha-errada-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "incorretos" })).toBeVisible();
});

test("atendente com uma loja entra direto, com o papel certo", async ({ page }) => {
  await page.goto(panel("/login"));
  await page.waitForLoadState("networkidle"); // espera hidratação (dev compila sob demanda)
  await page.getByLabel("E-mail").fill("atendente@demo.test");
  await page.getByLabel("Senha").fill("Demo@12345678");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Demo Lanche" })).toBeVisible();
  await expect(page.getByText("Atendente", { exact: true })).toBeVisible();
});

test("dono com duas lojas escolhe uma", async ({ page }) => {
  await page.goto(panel("/login"));
  await page.waitForLoadState("networkidle"); // espera hidratação (dev compila sob demanda)
  await page.getByLabel("E-mail").fill("DONO@demo.test");
  await page.getByLabel("Senha").fill("Demo@12345678");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Escolha a loja" })).toBeVisible();
  await page.getByRole("button", { name: /Demo Açaí/ }).click();
  await expect(page.getByRole("heading", { name: "Demo Açaí" })).toBeVisible();
  await expect(page.getByText("Dono", { exact: true })).toBeVisible();
});

test("sem login, o painel manda para /login", async ({ page }) => {
  await page.goto(panel("/"));
  await expect(page).toHaveURL(/\/login$/);
});
