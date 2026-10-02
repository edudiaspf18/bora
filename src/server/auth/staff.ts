import { eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { can, type Action, type Role } from "@/server/auth/can";
import { STAFF_COOKIE } from "@/server/auth/cookies";
import { dummyHash, verifyPassword } from "@/server/auth/password";
import { verifySession } from "@/server/auth/session";
import { hit, resetThrottle, retryAfterMs, type ThrottleOpts } from "@/server/auth/throttle";
import { db } from "@/server/db/client";
import { staffUsers } from "@/server/db/schema";

const MAX_PASSWORD_LENGTH = 128;
const EMAIL_LIMIT: ThrottleOpts = { max: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
const IP_LIMIT: ThrottleOpts = { max: 20, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };

export const loginSchema = z.object({
  email: z.string().max(254),
  password: z.string().min(1).max(128),
});

export function normalizeEmail(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

export type AuthResult =
  | { ok: true; staffId: string }
  | { ok: false; reason: "invalid" | "throttled" };

export async function authenticateStaff(
  rawEmail: string,
  password: string,
  ip: string,
): Promise<AuthResult> {
  const email = normalizeEmail(rawEmail);
  const emailKey = `staff:email:${email}`;
  const ipKey = `staff:ip:${ip}`;

  const waits = await Promise.all([retryAfterMs(emailKey), retryAfterMs(ipKey)]);
  if (waits.some((ms) => ms > 0)) return { ok: false, reason: "throttled" };

  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, email)).limit(1);
  // Senha acima de 128 caracteres nunca chega ao argon2 (evita DoS por entrada gigante).
  const matches =
    password.length > MAX_PASSWORD_LENGTH
      ? false
      : await verifyPassword(user?.passwordHash ?? (await dummyHash()), password);

  if (!user || !matches) {
    await Promise.all([hit(emailKey, EMAIL_LIMIT), hit(ipKey, IP_LIMIT)]);
    return { ok: false, reason: "invalid" };
  }
  await resetThrottle(emailKey);
  return { ok: true, staffId: user.id };
}

export interface Membership {
  tenantId: string;
  role: Role;
  slug: string;
  name: string;
}

export async function listMemberships(staffId: string): Promise<Membership[]> {
  const rows = await db.execute(
    sql`select tenant_id, role, slug, name from staff_memberships_for(${staffId}::uuid)`,
  );
  return rows.map((r) => ({
    tenantId: r.tenant_id as string,
    role: r.role as Role,
    slug: r.slug as string,
    name: r.name as string,
  }));
}

export interface StaffContext {
  staffId: string;
  memberships: Membership[];
  active: Membership | null;
}

/** Revalida contra o banco a cada request: papel e loja ativa nunca vêm só do token. */
export async function resolveStaffContext(
  token: string | undefined,
): Promise<StaffContext | null> {
  const session = await verifySession(token);
  if (!session || session.kind !== "staff") return null;
  const memberships = await listMemberships(session.staffId);
  if (memberships.length === 0) return null;
  const active = memberships.find((m) => m.tenantId === session.tenantId) ?? null;
  return { staffId: session.staffId, memberships, active };
}

export async function getStaffContext(): Promise<StaffContext | null> {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  return resolveStaffContext(token);
}

export async function requireAction(
  action: Action,
): Promise<StaffContext & { active: Membership }> {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/login");
  if (!ctx.active || !can(ctx.active.role, action)) redirect("/");
  return { ...ctx, active: ctx.active };
}
