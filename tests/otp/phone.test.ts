import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/server/otp/phone";

describe("normalizePhone", () => {
  it("aceita formatos comuns do Brasil", () => {
    for (const input of [
      "(62) 99828-6169",
      "62998286169",
      "+55 62 998286169",
      "5562998286169",
      "+55 (62) 99828-6169",
      "62 9982-86169",
    ]) {
      expect(normalizePhone(input), input).toBe("+5562998286169");
    }
  });
  it("aceita fixo (10 dígitos)", () => {
    expect(normalizePhone("(62) 3225-1234")).toBe("+556232251234");
  });
  it("DDD 55 não é confundido com código do país", () => {
    expect(normalizePhone("55 99999-9999")).toBe("+5555999999999");
  });
  it("rejeita letras, curto, longo e símbolos", () => {
    for (const bad of ["", "abc", "123", "629982861699999", "62998286169x", "62-99828+6169", "'; drop table customers;--"]) {
      expect(normalizePhone(bad), bad).toBeNull();
    }
  });
  it("limite de tamanho da entrada", () => {
    expect(normalizePhone("1".repeat(500))).toBeNull();
  });
});
