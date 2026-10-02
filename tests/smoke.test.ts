import { describe, expect, it } from "vitest";

describe("ambiente de teste", () => {
  it("aponta para o banco de teste", () => {
    expect(process.env.DATABASE_URL).toContain("bora_test");
    expect(process.env.DATABASE_ADMIN_URL).toContain("bora_test");
  });
});
