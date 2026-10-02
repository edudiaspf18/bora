import { afterAll, describe, expect, it } from "vitest";
import { adminSql, closeAdmin } from "../helpers/db";

// Tabelas que têm coluna tenant_id mas são globais de propósito.
const GLOBAL_WITH_TENANT_COLUMN = new Set(["tenant_domains"]);

afterAll(closeAdmin);

describe("schema", () => {
  it("toda tabela por loja tem RLS ligada e ao menos uma policy", async () => {
    const rows = await adminSql`
      select c.relname as name, c.relrowsecurity as rls,
        (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (
          select 1 from information_schema.columns col
          where col.table_schema = 'public' and col.table_name = c.relname
            and col.column_name = 'tenant_id')`;
    const perTenant = rows.filter((r) => !GLOBAL_WITH_TENANT_COLUMN.has(r.name as string));
    expect(perTenant.map((r) => r.name).sort()).toEqual([
      "audit_log",
      "customer_profiles",
      "otp_codes",
      "staff_memberships",
      "tenant_settings",
    ]);
    for (const r of perTenant) {
      expect(r.rls, `RLS off em ${r.name}`).toBe(true);
      expect(r.policies, `sem policy em ${r.name}`).toBeGreaterThan(0);
    }
  });

  it("papel da aplicação não é superuser e não ignora RLS", async () => {
    const [role] = await adminSql`
      select rolsuper, rolbypassrls from pg_roles where rolname = 'bora_app'`;
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  it("papel da aplicação não enxerga a tabela de controle de migrations", async () => {
    const [row] = await adminSql`
      select has_table_privilege('bora_app', '_migrations', 'select') as ok`;
    expect(row.ok).toBe(false);
  });

  it("staff_memberships_for: search_path fixo e privilégios restritos", async () => {
    const [fn] = await adminSql`
      select p.proconfig as cfg from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'staff_memberships_for'`;
    expect(fn.cfg).toContain("search_path=pg_catalog, public, pg_temp");
    const [priv] = await adminSql`
      select has_function_privilege('bora_app', 'staff_memberships_for(uuid)', 'execute') as app,
             has_function_privilege('public', 'staff_memberships_for(uuid)', 'execute') as pub`;
    expect(priv.app).toBe(true);
    expect(priv.pub).toBe(false);
  });
});
