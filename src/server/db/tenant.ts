import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "./client";

const tenantIdSchema = z.string().uuid();

/**
 * Único caminho para ler/escrever dados por loja.
 * `set_config(..., true)` vale só até o fim da transação.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const id = tenantIdSchema.parse(tenantId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${id}, true)`);
    return fn(tx);
  });
}
