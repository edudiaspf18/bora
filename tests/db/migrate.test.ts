import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { migrate } from "@/server/db/migrate";
import { adminSql, closeAdmin } from "../helpers/db";

afterAll(closeAdmin);

function appUrl(password: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.password = password;
  return url.toString();
}

async function passwordHash(): Promise<string> {
  const [row] = await adminSql`select rolpassword as h from pg_authid where rolname = 'bora_app'`;
  return row.h as string;
}

async function canConnect(password: string): Promise<boolean> {
  const sql = postgres(appUrl(password), { max: 1, onnotice: () => {} });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end();
  }
}

describe("migrate", () => {
  it("rotaciona a senha do papel bora_app quando ele já existe", async () => {
    const original = process.env.APP_DB_PASSWORD!;
    const rotated = `${original}_rot'x`;
    const before = await passwordHash();
    try {
      await migrate(process.env.DATABASE_ADMIN_URL!, rotated);
      expect(await canConnect(rotated)).toBe(true);
      // Se o pg_hba for "trust" a conexão não prova nada; o hash armazenado prova.
      expect(await passwordHash()).not.toBe(before);
    } finally {
      await migrate(process.env.DATABASE_ADMIN_URL!, original);
    }
    expect(await canConnect(original)).toBe(true);
  });
});
