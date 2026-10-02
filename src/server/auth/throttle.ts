import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

export interface ThrottleOpts {
  max: number;
  windowMs: number;
  blockMs: number;
}

// Drizzle (postgres-js) devolve timestamptz como string em db.execute; aceita Date também.
type Ts = Date | string;

interface Row {
  failures: number;
  window_start: Ts;
  blocked_until: Ts | null;
}

const toDate = (v: Ts): Date => (v instanceof Date ? v : new Date(v));

/**
 * Conta uma ocorrência. Linha trancada com FOR UPDATE: ocorrências concorrentes
 * se enfileiram e a contagem não se perde. Enquanto bloqueado, não incrementa.
 */
export async function hit(
  key: string,
  opts: ThrottleOpts,
  now: Date = new Date(),
): Promise<{ blocked: boolean }> {
  return db.transaction(async (tx) => {
    const nowIso = now.toISOString();
    await tx.execute(sql`
      insert into throttles (key, failures, window_start)
      values (${key}, 0, ${nowIso}::timestamptz)
      on conflict (key) do nothing`);
    const rows = await tx.execute(sql`
      select failures, window_start, blocked_until
      from throttles where key = ${key} for update`);
    const row = rows[0] as unknown as Row;

    const prevBlock = row.blocked_until === null ? null : toDate(row.blocked_until);
    if (prevBlock && prevBlock > now) return { blocked: true };

    const prevWindow = toDate(row.window_start);
    const reset = prevBlock !== null || now.getTime() - prevWindow.getTime() > opts.windowMs;
    const failures = (reset ? 0 : row.failures) + 1;
    const windowStart = reset ? now : prevWindow;
    const blockedUntil =
      failures >= opts.max ? new Date(now.getTime() + opts.blockMs) : null;

    await tx.execute(sql`
      update throttles
      set failures = ${failures},
          window_start = ${windowStart.toISOString()}::timestamptz,
          blocked_until = ${blockedUntil ? blockedUntil.toISOString() : null}::timestamptz
      where key = ${key}`);
    return { blocked: blockedUntil !== null };
  });
}

export async function retryAfterMs(key: string, now: Date = new Date()): Promise<number> {
  const rows = await db.execute(sql`select blocked_until from throttles where key = ${key}`);
  const raw = (rows[0] as unknown as { blocked_until: Ts | null } | undefined)?.blocked_until;
  if (!raw) return 0;
  const until = toDate(raw);
  if (until <= now) return 0;
  return until.getTime() - now.getTime();
}

export async function resetThrottle(key: string): Promise<void> {
  await db.execute(sql`delete from throttles where key = ${key}`);
}
