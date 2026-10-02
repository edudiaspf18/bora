import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __boraSql: ReturnType<typeof postgres> | undefined;
}

// Reaproveita a conexão entre hot reloads em dev.
const client =
  globalThis.__boraSql ??
  (globalThis.__boraSql = postgres(process.env.DATABASE_URL ?? "", {
    max: 10,
    onnotice: () => {},
  }));

export const db = drizzle(client, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function closeDb(): Promise<void> {
  await client.end();
  globalThis.__boraSql = undefined;
}
