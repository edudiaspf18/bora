import { describe, expect, it } from "vitest";
import { hashPassword, passwordSchema, verifyPassword } from "@/server/auth/password";

describe("password", () => {
  it("hash é argon2id e verifica", async () => {
    const hash = await hashPassword("uma-senha-boa-123");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "uma-senha-boa-123")).toBe(true);
    expect(await verifyPassword(hash, "outra-senha-123")).toBe(false);
  });
  it("hash inválido verifica como false, sem lançar", async () => {
    expect(await verifyPassword("nao-e-um-hash", "x")).toBe(false);
  });
  it("política: 10 a 128 caracteres (limite protege o argon2 de DoS)", () => {
    expect(passwordSchema.safeParse("curta").success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(10)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(10_000)).success).toBe(false);
  });
});
