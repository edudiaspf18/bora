import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { hit, retryAfterMs, type ThrottleOpts } from "@/server/auth/throttle";
import { customerProfiles, customers, otpCodes } from "@/server/db/schema";
import { withTenant } from "@/server/db/tenant";
import { normalizePhone } from "./phone";
import type { OtpSender } from "./sender";

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const PHONE_LIMIT: ThrottleOpts = { max: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };
const IP_LIMIT: ThrottleOpts = { max: 20, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashCode(code: string, tenantId: string, phone: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET ausente");
  return createHmac("sha256", secret).update(`otp:${tenantId}:${phone}:${code}`).digest("hex");
}

export type IssueResult =
  | { ok: true; phone: string }
  | { ok: false; reason: "invalid_phone" | "throttled" };

export async function issueOtp(args: {
  tenantId: string;
  tenantSlug: string;
  rawPhone: string;
  ip: string;
  sender: OtpSender;
  generate?: () => string;
  now?: Date;
}): Promise<IssueResult> {
  const phone = normalizePhone(args.rawPhone);
  if (!phone) return { ok: false, reason: "invalid_phone" };

  const now = args.now ?? new Date();
  const phoneKey = `otp:req:${args.tenantId}:${phone}`;
  const ipKey = `otp:ip:${args.ip}`;

  // Pré-checagem barata; a garantia real é o reserve-before-act abaixo.
  const waits = await Promise.all([retryAfterMs(phoneKey, now), retryAfterMs(ipKey, now)]);
  if (waits.some((ms) => ms > 0)) return { ok: false, reason: "throttled" };

  // `hit` bloqueia ao atingir `max`; com max+1 a N-ésima reserva ainda passa
  // e a seguinte é barrada: exatamente PHONE_LIMIT.max códigos por janela.
  const [byPhone, byIp] = await Promise.all([
    hit(phoneKey, { ...PHONE_LIMIT, max: PHONE_LIMIT.max + 1 }, now),
    hit(ipKey, IP_LIMIT, now),
  ]);
  if (byPhone.blocked || byIp.blocked) return { ok: false, reason: "throttled" };

  const code = (args.generate ?? generateCode)();
  await withTenant(args.tenantId, async (tx) => {
    // Serializa emissões do mesmo telefone: evita duas linhas não consumidas.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${args.tenantId}:${phone}`}))`);
    // Só o código mais recente vale.
    await tx
      .update(otpCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(otpCodes.tenantId, args.tenantId),
          eq(otpCodes.phone, phone),
          isNull(otpCodes.consumedAt),
        ),
      );
    await tx.insert(otpCodes).values({
      tenantId: args.tenantId,
      phone,
      codeHash: hashCode(code, args.tenantId, phone),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    });
  });
  await args.sender.send(phone, code, { tenantSlug: args.tenantSlug });
  return { ok: true, phone };
}

export type VerifyResult =
  | { ok: true; customerId: string }
  | { ok: false; reason: "invalid" | "expired" | "locked" };

export async function verifyOtp(args: {
  tenantId: string;
  rawPhone: string;
  code: string;
  now?: Date;
}): Promise<VerifyResult> {
  const phone = normalizePhone(args.rawPhone);
  if (!phone || !/^\d{6}$/.test(args.code)) return { ok: false, reason: "invalid" };
  const now = args.now ?? new Date();

  // Retorna sem lançar: a transação confirma, então o contador de tentativas persiste.
  return withTenant(args.tenantId, async (tx): Promise<VerifyResult> => {
    const [row] = await tx
      .select()
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.tenantId, args.tenantId),
          eq(otpCodes.phone, phone),
          isNull(otpCodes.consumedAt),
        ),
      )
      .orderBy(desc(otpCodes.createdAt))
      .limit(1)
      .for("update");
    if (!row) return { ok: false, reason: "invalid" };
    if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };
    if (row.expiresAt <= now) return { ok: false, reason: "expired" };

    const expected = Buffer.from(row.codeHash, "hex");
    const given = Buffer.from(hashCode(args.code, args.tenantId, phone), "hex");
    const match = expected.length === given.length && timingSafeEqual(expected, given);

    if (!match) {
      await tx
        .update(otpCodes)
        .set({ attempts: row.attempts + 1 })
        .where(eq(otpCodes.id, row.id));
      return { ok: false, reason: "invalid" };
    }

    // Consome também qualquer código irmão: nenhum outro vale depois.
    await tx
      .update(otpCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(otpCodes.tenantId, args.tenantId),
          eq(otpCodes.phone, phone),
          isNull(otpCodes.consumedAt),
        ),
      );
    const [customer] = await tx
      .insert(customers)
      .values({ phone })
      .onConflictDoUpdate({ target: customers.phone, set: { phone: sql`excluded.phone` } })
      .returning({ id: customers.id });
    await tx
      .insert(customerProfiles)
      .values({ tenantId: args.tenantId, customerId: customer.id })
      .onConflictDoNothing();
    return { ok: true, customerId: customer.id };
  });
}
