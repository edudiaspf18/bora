import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

const sessionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("staff"),
    staffId: z.string().uuid(),
    tenantId: z.string().uuid().nullable(),
  }),
  z.object({
    kind: z.literal("customer"),
    customerId: z.string().uuid(),
    tenantId: z.string().uuid(),
  }),
]);

export type Session = z.infer<typeof sessionSchema>;

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET ausente ou curto (mín. 32)");
  return new TextEncoder().encode(value);
}

export function signSession(session: Session, ttlSeconds: number): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
}

export async function verifySession(
  token: string | undefined,
  now: Date = new Date(),
): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
      currentDate: now,
    });
    const parsed = sessionSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
