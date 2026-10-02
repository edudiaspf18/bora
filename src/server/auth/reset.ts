import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { hashPassword, passwordSchema } from "@/server/auth/password";
import { normalizeEmail } from "@/server/auth/staff";
import { hit, retryAfterMs, type ThrottleOpts } from "@/server/auth/throttle";
import { db } from "@/server/db/client";
import { passwordResetTokens, staffUsers } from "@/server/db/schema";

const TOKEN_TTL_MS = 30 * 60_000;
const EMAIL_LIMIT: ThrottleOpts = { max: 3, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
const IP_LIMIT: ThrottleOpts = { max: 10, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export const consoleMailer: Mailer = {
  async send(to, subject, text) {
    console.log(`[mail] para=${to} assunto="${subject}"\n${text}`);
  },
};

/** Provedor real de e-mail entra depois, atrás desta interface. */
export function getMailer(): Mailer {
  return consoleMailer;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function panelOrigin(): string {
  return process.env.PANEL_ORIGIN ?? "http://app.localhost:3000";
}

export async function requestPasswordReset(
  rawEmail: string,
  ip: string,
  mailer: Mailer = getMailer(),
): Promise<void> {
  const email = normalizeEmail(rawEmail).slice(0, 254);
  const emailKey = `reset:email:${email}`;
  const ipKey = `reset:ip:${ip}`;

  // Cheap pre-check; the gate is the reservation below.
  const waits = await Promise.all([retryAfterMs(emailKey), retryAfterMs(ipKey)]);
  if (waits.some((ms) => ms > 0)) return;

  // Reserve-before-act: parallel requests cannot exceed the limit.
  // max + 1: the 4th reservation is the one that blocks, so 3 mails per window.
  const [byEmail, byIp] = await Promise.all([
    hit(emailKey, { ...EMAIL_LIMIT, max: EMAIL_LIMIT.max + 1 }),
    hit(ipKey, IP_LIMIT),
  ]);
  if (byEmail.blocked || byIp.blocked) return;

  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.email, email)).limit(1);
  if (!user) return;

  const token = randomBytes(32).toString("base64url");
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      update password_reset_tokens set used_at = now()
      where staff_id = ${user.id} and used_at is null`);
    await tx.insert(passwordResetTokens).values({
      staffId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });
  });

  await mailer.send(
    user.email,
    "Redefinir sua senha no Bora",
    `Use o link para criar uma nova senha (vale por 30 minutos):\n` +
      `${panelOrigin()}/redefinir-senha?token=${token}\n\n` +
      `Se não foi você, ignore este e-mail.`,
  );
}

export type ResetResult = { ok: true } | { ok: false; reason: "invalid" | "weak" };

export async function confirmPasswordReset(
  token: string,
  newPassword: string,
): Promise<ResetResult> {
  if (token.length === 0 || token.length > 200) return { ok: false, reason: "invalid" };
  if (!passwordSchema.safeParse(newPassword).success) return { ok: false, reason: "weak" };

  const passwordHash = await hashPassword(newPassword);
  return db.transaction(async (tx) => {
    // Consome o token de forma atômica: dois cliques simultâneos não passam os dois.
    const consumed = await tx.execute(sql`
      update password_reset_tokens set used_at = now()
      where token_hash = ${sha256(token)} and used_at is null and expires_at > now()
      returning staff_id`);
    const row = consumed[0] as unknown as { staff_id: string } | undefined;
    if (!row) return { ok: false, reason: "invalid" } as const;

    await tx.update(staffUsers).set({ passwordHash }).where(eq(staffUsers.id, row.staff_id));
    return { ok: true } as const;
  });
}
