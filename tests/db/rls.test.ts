import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

let tenantA: string;
let tenantB: string;

beforeEach(async () => {
  await resetDb();
  tenantA = await createTenant("loja-a");
  tenantB = await createTenant("loja-b");
  await adminSql`insert into audit_log (tenant_id, actor, action) values
    (${tenantA}, 'a', 'x'), (${tenantB}, 'b', 'y')`;
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("withTenant + RLS", () => {
  it("query fora de withTenant retorna zero linhas", async () => {
    const rows = await db.select().from(auditLog);
    expect(rows).toEqual([]);
  });

  it("enxerga só a própria loja", async () => {
    const rows = await withTenant(tenantA, (tx) => tx.select().from(auditLog));
    expect(rows.map((r) => r.actor)).toEqual(["a"]);
  });

  it("a loja A não consegue inserir linha da loja B", async () => {
    await expect(
      withTenant(tenantA, (tx) =>
        tx.insert(auditLog).values({ tenantId: tenantB, actor: "intruso", action: "z" }),
      ),
    ).rejects.toThrow();
    const rows = await adminSql`select 1 from audit_log where actor = 'intruso'`;
    expect(rows.length).toBe(0);
  });

  it("a loja A não consegue apagar nem alterar linha da loja B", async () => {
    const deleted = await withTenant(tenantA, (tx) =>
      tx.delete(auditLog).returning(),
    );
    expect(deleted.map((r) => r.actor)).toEqual(["a"]);
    const remaining = await adminSql`select actor from audit_log`;
    expect(remaining.map((r) => r.actor)).toEqual(["b"]);
  });

  it("rejeita tenant id que não é uuid (sem injeção)", async () => {
    await expect(
      withTenant("x' or '1'='1", (tx) => tx.select().from(auditLog)),
    ).rejects.toThrow();
  });

  it("o tenant não vaza para a próxima query da conexão", async () => {
    await withTenant(tenantA, (tx) => tx.select().from(auditLog));
    const rows = await db.select().from(auditLog);
    expect(rows).toEqual([]);
    const cfg = await db.execute(sql`select current_setting('app.tenant_id', true) as v`);
    expect(["", null]).toContain(cfg[0].v);
  });
});
