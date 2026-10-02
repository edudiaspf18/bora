import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/server/db/client";
import { findTenantBySegment } from "@/server/tenancy/lookup";
import { defaultTheme } from "@/server/theme/theme";
import { loadTenantTheme } from "@/server/theme/load";
import { adminSql, closeAdmin, createTenant, resetDb } from "../helpers/db";

let tenantA: string;

beforeEach(async () => {
  await resetDb();
  tenantA = await createTenant("loja-a", "Loja A", "acaiteria");
});

afterAll(async () => {
  await closeDb();
  await closeAdmin();
});

describe("findTenantBySegment", () => {
  it("acha por slug, ignorando caixa", async () => {
    expect((await findTenantBySegment("LOJA-A"))?.id).toBe(tenantA);
  });
  it("slug desconhecido é null", async () => {
    expect(await findTenantBySegment("nao-existe")).toBeNull();
  });
  it("loja suspensa não é servida", async () => {
    await adminSql`update tenants set status = 'suspended' where id = ${tenantA}`;
    expect(await findTenantBySegment("loja-a")).toBeNull();
  });
  it("domínio próprio só vale se verificado", async () => {
    await adminSql`insert into tenant_domains (host, tenant_id, verified) values ('cardapio.loja.com.br', ${tenantA}, false)`;
    expect(await findTenantBySegment("cardapio.loja.com.br")).toBeNull();
    await adminSql`update tenant_domains set verified = true`;
    expect((await findTenantBySegment("cardapio.loja.com.br"))?.slug).toBe("loja-a");
  });
  it("segmento com percent-encoding malformado não lança", async () => {
    expect(await findTenantBySegment("%E0%A4%A")).toBeNull();
  });
});

describe("loadTenantTheme", () => {
  it("sem settings: tema padrão", async () => {
    expect(await loadTenantTheme(tenantA)).toEqual(defaultTheme);
  });
  it("mescla o salvo com o padrão", async () => {
    await adminSql`insert into tenant_settings (tenant_id, theme) values (${tenantA}, ${adminSql.json({ accent: "#BE185D", radius: "lg" })})`;
    const theme = await loadTenantTheme(tenantA);
    expect(theme.accent).toBe("#be185d");
    expect(theme.radius).toBe("lg");
    expect(theme.font).toBe("geist");
  });
  it("tema salvo inválido cai no padrão em vez de quebrar a loja", async () => {
    await adminSql`insert into tenant_settings (tenant_id, theme) values (${tenantA}, ${adminSql.json({ accent: "#fff;}body{display:none" })})`;
    expect(await loadTenantTheme(tenantA)).toEqual(defaultTheme);
  });
});
