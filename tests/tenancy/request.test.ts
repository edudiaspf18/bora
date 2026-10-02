import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { tenantFromHeaders } from "@/server/tenancy/request";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

let tenantA: string;

const h = (init: Record<string, string>) => new Headers(init);

beforeEach(async () => {
  await resetDb();
  tenantA = await createTenant("loja-a", "Loja A");
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("tenantFromHeaders", () => {
  it("host da loja resolve o tenant", async () => {
    expect((await tenantFromHeaders(h({ host: "loja-a.bora.test" }), "bora.test"))?.id).toBe(tenantA);
  });
  it("x-forwarded-host forjado em host não-loopback é ignorado", async () => {
    await createTenant("loja-b");
    const t = await tenantFromHeaders(
      h({ host: "loja-a.bora.test", "x-forwarded-host": "loja-b.bora.test" }),
      "bora.test",
    );
    expect(t?.id).toBe(tenantA);
  });
  it("host desconhecido é null", async () => {
    expect(await tenantFromHeaders(h({ host: "nada.bora.test" }), "bora.test")).toBeNull();
    expect(await tenantFromHeaders(h({ host: "bora.test" }), "bora.test")).toBeNull();
    expect(await tenantFromHeaders(h({}), "bora.test")).toBeNull();
  });
  it("loja suspensa é null", async () => {
    await adminSql`update tenants set status = 'suspended' where id = ${tenantA}`;
    expect(await tenantFromHeaders(h({ host: "loja-a.bora.test" }), "bora.test")).toBeNull();
  });
  it("domínio próprio verificado resolve o tenant", async () => {
    await adminSql`insert into tenant_domains (host, tenant_id, verified) values ('cardapio.loja.com.br', ${tenantA}, true)`;
    expect((await tenantFromHeaders(h({ host: "cardapio.loja.com.br" }), "bora.test"))?.id).toBe(tenantA);
  });
});
