import { describe, expect, it } from "vitest";
import { formatBRL, parseBRL } from "@/lib/money";

describe("parseBRL", () => {
  it.each([
    ["12,50", 1250],
    ["12,5", 1250],
    ["12.50", 1250],
    ["1.234,50", 123450],
    ["1.234", 123400],
    ["R$ 9", 900],
    ["  0 ", 0],
    ["0,99", 99],
  ])("%j → %i", (raw, cents) => expect(parseBRL(raw)).toBe(cents));

  it.each(["", "abc", "12,505", "1,2,3", "-5", "1.2.3", "999999999"])("%j → null", (raw) =>
    expect(parseBRL(raw)).toBeNull(),
  );
});

describe("formatBRL", () => {
  it("formata em reais", () => {
    expect(formatBRL(1250).replace(/\s/g, " ")).toBe("R$ 12,50");
  });
});
