import { cookies } from "next/headers";
import { CUSTOMER_COOKIE } from "@/server/auth/cookies";
import { verifySession } from "@/server/auth/session";

/** A sessão só vale na loja para a qual foi emitida. */
export async function getCustomerSession(
  tenantId: string,
): Promise<{ customerId: string } | null> {
  const token = (await cookies()).get(CUSTOMER_COOKIE)?.value;
  const session = await verifySession(token);
  if (!session || session.kind !== "customer" || session.tenantId !== tenantId) return null;
  return { customerId: session.customerId };
}
