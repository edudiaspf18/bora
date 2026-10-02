import postgres from "postgres";

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
