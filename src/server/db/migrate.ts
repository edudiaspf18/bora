import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = path.join(process.cwd(), "src/server/db/migrations");
const LOCK_ID = 727274;

export async function migrate(adminUrl: string, appPassword: string): Promise<string[]> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`select pg_advisory_lock(${LOCK_ID})`;

    const roles = await sql`select 1 from pg_roles where rolname = 'bora_app'`;
    const pwd = appPassword.replace(/'/g, "''");
    if (roles.length === 0) {
      await sql.unsafe(`create role bora_app login nosuperuser nobypassrls password '${pwd}'`);
    } else {
      // Senha rotacionável: roda a cada migrate.
      await sql.unsafe(`alter role bora_app with login nosuperuser nobypassrls password '${pwd}'`);
    }

    await sql`create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
    const done = new Set(
      (await sql`select name from _migrations`).map((r) => r.name as string),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const text = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into _migrations (name) values (${file})`;
      });
      applied.push(file);
    }
    return applied;
  } finally {
    await sql.end();
  }
}
