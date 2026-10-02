import path from "node:path";
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
process.env.ROOT_DOMAIN = "bora.test";
process.env.PANEL_ORIGIN = "http://app.bora.test";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
