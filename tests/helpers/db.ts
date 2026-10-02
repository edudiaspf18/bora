import postgres from "postgres";
import { hashPassword } from "@/server/auth/password";

export const adminSql = postgres(process.env.DATABASE_ADMIN_URL!, {
  max: 2,
  onnotice: () => {},
});

export async function resetDb(): Promise<void> {
  await adminSql`truncate tenants, customers, staff_users, throttles cascade`;
}

export async function createTenant(
  slug: string,
  name: string = slug,
  vertical: string = "restaurante",
): Promise<string> {
  const [row] = await adminSql`
    insert into tenants (slug, name, vertical)
    values (${slug}, ${name}, ${vertical})
    returning id`;
  return row.id as string;
}

export async function closeAdmin(): Promise<void> {
  await adminSql.end();
}

export async function createStaff(
  email: string,
  password: string,
  name = "Pessoa",
): Promise<string> {
  const hash = await hashPassword(password);
  const [row] = await adminSql`
    insert into staff_users (email, password_hash, name)
    values (${email.toLowerCase()}, ${hash}, ${name})
    returning id`;
  return row.id as string;
}

export async function addMembership(
  tenantId: string,
  staffId: string,
  role: "owner" | "manager" | "attendant",
): Promise<void> {
  await adminSql`
    insert into staff_memberships (tenant_id, staff_id, role)
    values (${tenantId}, ${staffId}, ${role})`;
}
