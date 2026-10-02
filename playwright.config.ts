import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile(".env");
} catch {
  // CI injeta as variáveis direto no ambiente.
}

const PORT = 3100;

const forwarded: Record<string, string | undefined> = {
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_ADMIN_URL: process.env.DATABASE_ADMIN_URL,
  ROOT_DOMAIN: "localhost",
  PANEL_ORIGIN: `http://app.localhost:${PORT}`,
  OTP_SENDER: "file",
  OTP_FILE: ".e2e/otp.json",
  SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-123456",
};

// Só repassa o que está definido: valor vazio sobrescreveria o .env do Next.
const env = Object.fromEntries(
  Object.entries(forwarded).filter((e): e is [string, string] => e[1] !== undefined),
);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env,
  },
});
