import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env");
} catch {
  // CI injeta as variáveis direto no ambiente.
}

// Testes sempre usam o banco de teste.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
process.env.DATABASE_ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? "";
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-123456";
process.env.APP_DB_PASSWORD ??= "bora_app_dev"; // só banco de teste
process.env.ROOT_DOMAIN = "bora.test";
process.env.PANEL_ORIGIN = "http://app.bora.test";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
