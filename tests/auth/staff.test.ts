import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "@/server/auth/password";
import { writeAudit } from "@/server/audit";
import { signSession } from "@/server/auth/session";
import {
  authenticateStaff,
  listMemberships,
  normalizeEmail,
  resolveStaffContext,
} from "@/server/auth/staff";
import { closeDb } from "@/server/db/client";
import { adminSql, addMembership, closeAdmin, createStaff, createTenant, resetDb } from "../helpers/db";

vi.mock("@/server/auth/password", async (importOriginal) => {
  const m = await importOriginal<typeof import("@/server/auth/password")>();
  return { ...m, verifyPassword: vi.fn(m.verifyPassword) };
});

const PASSWORD = "senha-correta-123";
let tenantA: string;
let tenantB: string;
let staffId: string;

beforeEach(async () => {
  vi.mocked(verifyPassword).mockClear();
  await resetDb();
  tenantA = await createTenant("loja-a", "Loja A");
  tenantB = await createTenant("loja-b", "Loja B");
  staffId = await createStaff("dono@exemplo.com", PASSWORD);
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("normalizeEmail", () => {
  it("minúsculas e sem espaços nas pontas", () => {
    expect(normalizeEmail("  Dono@Exemplo.COM ")).toBe("dono@exemplo.com");
  });
});

describe("authenticateStaff", () => {
  it("aceita e-mail com maiúsculas e espaços", async () => {
    const r = await authenticateStaff("  DONO@exemplo.com ", PASSWORD, "1.1.1.1");
    expect(r).toEqual({ ok: true, staffId });
  });
  it("senha errada e e-mail inexistente dão a mesma resposta", async () => {
    expect(await authenticateStaff("dono@exemplo.com", "errada-errada-1", "1.1.1.1")).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticateStaff("ninguem@exemplo.com", "errada-errada-1", "1.1.1.1")).toEqual({ ok: false, reason: "invalid" });
  });
  it("5 falhas bloqueiam, mesmo com a senha certa depois", async () => {
    for (let i = 0; i < 5; i++) {
      await authenticateStaff("dono@exemplo.com", "errada-errada-1", `9.9.9.${i}`);
    }
    expect(await authenticateStaff("dono@exemplo.com", PASSWORD, "8.8.8.8")).toEqual({ ok: false, reason: "throttled" });
  });
  it("20 tentativas concorrentes: no máximo 5 chegam ao argon2", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        authenticateStaff("dono@exemplo.com", "errada-errada-1", `7.7.7.${i}`),
      ),
    );
    expect(vi.mocked(verifyPassword).mock.calls.length).toBeLessThanOrEqual(5);
    expect(results.filter((r) => !r.ok && r.reason === "throttled").length).toBeGreaterThanOrEqual(15);
    expect(await authenticateStaff("dono@exemplo.com", PASSWORD, "6.6.6.6")).toEqual({ ok: false, reason: "throttled" });
  });
  it("senha gigante não chega ao argon2, mas consome tentativa", async () => {
    const r = await authenticateStaff("dono@exemplo.com", "a".repeat(10_000), "1.1.1.1");
    expect(r).toEqual({ ok: false, reason: "invalid" });
    expect(verifyPassword).not.toHaveBeenCalled();
    const rows = await adminSql`select 1 from throttles where key = 'staff:email:dono@exemplo.com'`;
    expect(rows.length).toBe(1);
  });
  it("limite por IP: acima do teto, bloqueia sem chegar ao argon2", async () => {
    await adminSql`insert into throttles (key, failures, window_start) values ('staff:ip:9.9.9.9', 58, now())`;
    const first = await authenticateStaff("a@exemplo.com", "errada-errada-1", "9.9.9.9");
    expect(first).toEqual({ ok: false, reason: "invalid" });
    vi.mocked(verifyPassword).mockClear();
    for (let i = 0; i < 3; i++) {
      expect(await authenticateStaff("dono@exemplo.com", PASSWORD, "9.9.9.9")).toEqual({ ok: false, reason: "throttled" });
    }
    expect(verifyPassword).not.toHaveBeenCalled();
  });
  it("login correto zera o contador de falhas do e-mail", async () => {
    for (let i = 0; i < 3; i++) {
      await authenticateStaff("dono@exemplo.com", "errada-errada-1", "1.1.1.1");
    }
    await authenticateStaff("dono@exemplo.com", PASSWORD, "1.1.1.1");
    const rows = await adminSql`select 1 from throttles where key = 'staff:email:dono@exemplo.com'`;
    expect(rows.length).toBe(0);
  });
});

describe("listMemberships / resolveStaffContext", () => {
  it("lista as lojas ativas do staff, com papel", async () => {
    await addMembership(tenantA, staffId, "owner");
    await addMembership(tenantB, staffId, "attendant");
    const list = await listMemberships(staffId);
    expect(list.map((m) => [m.slug, m.role])).toEqual([
      ["loja-a", "owner"],
      ["loja-b", "attendant"],
    ]);
  });
  it("loja suspensa some da lista", async () => {
    await addMembership(tenantA, staffId, "owner");
    await adminSql`update tenants set status = 'suspended' where id = ${tenantA}`;
    expect(await listMemberships(staffId)).toEqual([]);
  });
  it("ninguém vê memberships de outro staff", async () => {
    await addMembership(tenantA, staffId, "owner");
    const other = await createStaff("outro@exemplo.com", PASSWORD);
    expect(await listMemberships(other)).toEqual([]);
  });
  it("contexto: sem tenant ativo até escolher", async () => {
    await addMembership(tenantA, staffId, "owner");
    const token = await signSession({ kind: "staff", staffId, tenantId: null }, 60);
    const ctx = await resolveStaffContext(token);
    expect(ctx?.active).toBeNull();
    expect(ctx?.memberships.length).toBe(1);
  });
  it("contexto: papel vem do banco a cada request", async () => {
    await addMembership(tenantA, staffId, "owner");
    const token = await signSession({ kind: "staff", staffId, tenantId: tenantA }, 60);
    expect((await resolveStaffContext(token))?.active?.role).toBe("owner");
    await adminSql`update staff_memberships set role = 'attendant' where staff_id = ${staffId}`;
    expect((await resolveStaffContext(token))?.active?.role).toBe("attendant");
  });
  it("contexto: membership removida invalida a loja ativa", async () => {
    await addMembership(tenantA, staffId, "owner");
    await addMembership(tenantB, staffId, "owner");
    const token = await signSession({ kind: "staff", staffId, tenantId: tenantA }, 60);
    await adminSql`delete from staff_memberships where tenant_id = ${tenantA}`;
    const ctx = await resolveStaffContext(token);
    expect(ctx?.active).toBeNull();
  });
  it("contexto: sem nenhuma membership ou token inválido vira null", async () => {
    const token = await signSession({ kind: "staff", staffId, tenantId: null }, 60);
    expect(await resolveStaffContext(token)).toBeNull();
    expect(await resolveStaffContext("lixo")).toBeNull();
    expect(await resolveStaffContext(undefined)).toBeNull();
  });
});

describe("writeAudit", () => {
  it("grava na loja certa", async () => {
    await writeAudit(tenantA, { actor: `staff:${staffId}`, action: "tenant.select", ip: "1.1.1.1" });
    const rows = await adminSql`select tenant_id, action from audit_log`;
    expect(rows.map((r) => [r.tenant_id, r.action])).toEqual([[tenantA, "tenant.select"]]);
  });
});
