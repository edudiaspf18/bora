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

describe("isolamento entre lojas", () => {
  let tenantB: string;
  beforeEach(async () => {
    tenantB = await createTenant("loja-b", "Loja B", "lanchonete");
  });

  it("slug resolve a loja certa", async () => {
    expect((await findTenantBySegment("loja-a"))?.id).toBe(tenantA);
    expect((await findTenantBySegment("loja-b"))?.id).toBe(tenantB);
  });
  it("cada domínio verificado resolve a sua loja, sem caixa", async () => {
    await adminSql`insert into tenant_domains (host, tenant_id, verified) values ('a.com', ${tenantA}, true), ('b.com', ${tenantB}, true), ('cardapio.loja.com.br', ${tenantA}, true)`;
    expect((await findTenantBySegment("a.com"))?.id).toBe(tenantA);
    expect((await findTenantBySegment("b.com"))?.id).toBe(tenantB);
    expect((await findTenantBySegment("CARDAPIO.Loja.com.br"))?.id).toBe(tenantA);
  });
  it("domínio verificado de loja suspensa é null", async () => {
    await adminSql`insert into tenant_domains (host, tenant_id, verified) values ('b.com', ${tenantB}, true)`;
    await adminSql`update tenants set status = 'suspended' where id = ${tenantB}`;
    expect(await findTenantBySegment("b.com")).toBeNull();
  });
  it("cada loja recebe só o próprio tema", async () => {
    await adminSql`insert into tenant_settings (tenant_id, theme) values (${tenantA}, ${adminSql.json({ accent: "#be185d", radius: "lg" })}), (${tenantB}, ${adminSql.json({ accent: "#15803d", radius: "sm" })})`;
    const a = await loadTenantTheme(tenantA);
    const b = await loadTenantTheme(tenantB);
    expect([a.accent, a.radius]).toEqual(["#be185d", "lg"]);
    expect([b.accent, b.radius]).toEqual(["#15803d", "sm"]);
  });
  it.each([["string", `'"x"'::jsonb`], ["array", `'[1,2]'::jsonb`], ["null", `'null'::jsonb`]])(
    "tema salvo como %s cai no padrão",
    async (_name, literal) => {
      await adminSql.unsafe(`insert into tenant_settings (tenant_id, theme) values ('${tenantA}', ${literal})`);
      expect(await loadTenantTheme(tenantA)).toEqual(defaultTheme);
    },
  );
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
