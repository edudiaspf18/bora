"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import {
  cookieOptions,
  STAFF_COOKIE,
  STAFF_TTL_SECONDS,
} from "@/server/auth/cookies";
import { clientIp } from "@/server/auth/ip";
import { signSession } from "@/server/auth/session";
import {
  authenticateStaff,
  getStaffContext,
  listMemberships,
  loginSchema,
} from "@/server/auth/staff";

export async function loginAction(formData: FormData): Promise<void> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/login?error=invalid");

  const ip = clientIp(await headers());
  const result = await authenticateStaff(parsed.data.email, parsed.data.password, ip);
  if (!result.ok) redirect(`/login?error=${result.reason}`);

  const memberships = await listMemberships(result.staffId);
  if (memberships.length === 0) redirect("/login?error=no_store");

  // Com uma única loja, já entra nela.
  const tenantId = memberships.length === 1 ? memberships[0].tenantId : null;
  const token = await signSession(
    { kind: "staff", staffId: result.staffId, tenantId },
    STAFF_TTL_SECONDS,
  );
  (await cookies()).set(STAFF_COOKIE, token, cookieOptions(STAFF_TTL_SECONDS));
  if (tenantId) {
    await writeAudit(tenantId, { actor: `staff:${result.staffId}`, action: "staff.login", ip });
  }
  redirect("/");
}

export async function selectTenantAction(formData: FormData): Promise<void> {
  const tenantId = z.string().uuid().safeParse(formData.get("tenantId"));
  const ctx = await getStaffContext();
  if (!ctx) redirect("/login");
  if (!tenantId.success || !ctx.memberships.some((m) => m.tenantId === tenantId.data)) {
    redirect("/");
  }

  const token = await signSession(
    { kind: "staff", staffId: ctx.staffId, tenantId: tenantId.data },
    STAFF_TTL_SECONDS,
  );
  (await cookies()).set(STAFF_COOKIE, token, cookieOptions(STAFF_TTL_SECONDS));
  await writeAudit(tenantId.data, {
    actor: `staff:${ctx.staffId}`,
    action: "tenant.select",
    ip: clientIp(await headers()),
  });
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(STAFF_COOKIE);
  redirect("/login");
}
