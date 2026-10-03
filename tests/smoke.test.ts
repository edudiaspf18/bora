import { describe, expect, it } from "vitest";

describe("ambiente de teste", () => {
  // bora_test no local, bora_ci no GitHub Actions; nunca o banco de desenvolvimento.
  it("aponta para o banco de teste", () => {
    expect(process.env.DATABASE_URL).toMatch(/\/bora_(test|ci)$/);
    expect(process.env.DATABASE_ADMIN_URL).toMatch(/\/bora_(test|ci)$/);
  });
});
