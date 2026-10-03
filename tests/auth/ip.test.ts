import { describe, expect, it } from "vitest";
import { clientIp } from "@/server/auth/ip";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIp", () => {
  it("usa o primeiro x-forwarded-for", () => {
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
  });
  it("cai para x-real-ip e depois unknown", () => {
    expect(clientIp(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(h({}))).toBe("unknown");
  });
  it("descarta valor com caracteres estranhos ou longo demais", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4<script>" }))).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "1".repeat(100) }))).toBe("unknown");
  });
});
