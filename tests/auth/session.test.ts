import { afterEach, describe, expect, it, vi } from "vitest";
import { signSession, verifySession, type Session } from "@/server/auth/session";

const uuid = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const staff: Session = { kind: "staff", staffId: uuid, tenantId: null };
const customer: Session = { kind: "customer", customerId: uuid, tenantId: uuid };

afterEach(() => vi.unstubAllEnvs());

describe("session", () => {
  it("ida e volta", async () => {
    expect(await verifySession(await signSession(staff, 60))).toEqual(staff);
    expect(await verifySession(await signSession(customer, 60))).toEqual(customer);
  });
  it("token adulterado, vazio ou ausente vira null", async () => {
    const token = await signSession(staff, 60);
    expect(await verifySession(token.slice(0, -2) + "xx")).toBeNull();
    expect(await verifySession("lixo")).toBeNull();
    expect(await verifySession("")).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });
  it("expira", async () => {
    const token = await signSession(staff, 10);
    expect(await verifySession(token, new Date(Date.now() + 60_000))).toBeNull();
  });
  it("payload com forma inesperada é rejeitado", async () => {
    const bad = await signSession({ kind: "customer", customerId: "x", tenantId: "y" } as Session, 60);
    expect(await verifySession(bad)).toBeNull();
  });
  it("produção rejeita o placeholder do .env.example", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "troque-por-uma-string-aleatoria-de-32-bytes-ou-mais");
    expect(() => signSession(staff, 60)).toThrow(/SESSION_SECRET/);
  });
  it("fora de produção o placeholder passa", async () => {
    vi.stubEnv("SESSION_SECRET", "troque-por-uma-string-aleatoria-de-32-bytes-ou-mais");
    await expect(signSession(staff, 60)).resolves.toBeTypeOf("string");
  });
});
