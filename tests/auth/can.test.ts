import { describe, expect, it } from "vitest";
import { can } from "@/server/auth/can";

describe("can", () => {
  it("owner pode tudo", () => {
    for (const a of ["billing:manage", "team:manage", "settings:edit", "catalog:edit", "orders:manage", "stock:edit"] as const) {
      expect(can("owner", a)).toBe(true);
    }
  });
  it("manager não gerencia equipe nem cobrança", () => {
    expect(can("manager", "team:manage")).toBe(false);
    expect(can("manager", "billing:manage")).toBe(false);
    expect(can("manager", "catalog:edit")).toBe(true);
    expect(can("manager", "settings:edit")).toBe(true);
  });
  it("attendant só pedidos e estoque", () => {
    expect(can("attendant", "orders:manage")).toBe(true);
    expect(can("attendant", "stock:edit")).toBe(true);
    expect(can("attendant", "catalog:edit")).toBe(false);
    expect(can("attendant", "settings:edit")).toBe(false);
  });
});
