import postgres from "postgres";
import { hashPassword } from "../src/server/auth/password";

const STORES = [
  { slug: "demo-acai", name: "Demo Açaí", vertical: "acaiteria", accent: "#be185d" },
  { slug: "demo-lanche", name: "Demo Lanche", vertical: "lanchonete", accent: "#15803d" },
] as const;

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error("DATABASE_ADMIN_URL ausente");
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sql`truncate throttles`;
    const passwordHash = await hashPassword("Demo@12345678");

    const tenantIds: Record<string, string> = {};
    for (const s of STORES) {
      const [t] = await sql`
        insert into tenants (slug, name, vertical)
        values (${s.slug}, ${s.name}, ${s.vertical})
        on conflict (slug) do update set name = excluded.name
        returning id`;
      tenantIds[s.slug] = t.id as string;
      const theme = { accent: s.accent, font: "geist", radius: "md", logoUrl: null };
      await sql`
        insert into tenant_settings (tenant_id, theme)
        values (${t.id}, ${sql.json(theme)})
        on conflict (tenant_id) do update set theme = excluded.theme`;
    }

    const staff = [
      { email: "dono@demo.test", name: "Dono Demo" },
      { email: "atendente@demo.test", name: "Atendente Demo" },
    ];
    const staffIds: Record<string, string> = {};
    for (const p of staff) {
      const [u] = await sql`
        insert into staff_users (email, password_hash, name)
        values (${p.email}, ${passwordHash}, ${p.name})
        on conflict (email) do update set password_hash = excluded.password_hash
        returning id`;
      staffIds[p.email] = u.id as string;
    }

    const memberships = [
      ["demo-acai", "dono@demo.test", "owner"],
      ["demo-lanche", "dono@demo.test", "manager"],
      ["demo-lanche", "atendente@demo.test", "attendant"],
    ] as const;
    for (const [slug, email, role] of memberships) {
      await sql`
        insert into staff_memberships (tenant_id, staff_id, role)
        values (${tenantIds[slug]}, ${staffIds[email]}, ${role})
        on conflict (tenant_id, staff_id) do update set role = excluded.role`;
    }
    console.log("seed ok: demo-acai, demo-lanche, dono@demo.test, atendente@demo.test");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
