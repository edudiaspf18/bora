"use server";

import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { CUSTOMER_COOKIE, CUSTOMER_TTL_SECONDS, cookieOptions } from "@/server/auth/cookies";
import { clientIp } from "@/server/auth/ip";
import { signSession } from "@/server/auth/session";
import { issueOtp, verifyOtp } from "@/server/otp/otp";
import { getOtpSender } from "@/server/otp/sender";
import { findTenantBySegment } from "@/server/tenancy/lookup";

const segmentSchema = z.string().min(1).max(253);

export async function requestCodeAction(formData: FormData): Promise<void> {
  const segment = segmentSchema.parse(formData.get("segment"));
  const tenant = await findTenantBySegment(segment);
  if (!tenant) notFound();

  const result = await issueOtp({
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    rawPhone: String(formData.get("phone") ?? ""),
    ip: clientIp(await headers()),
    sender: getOtpSender(),
  });
  if (!result.ok) redirect(`/entrar?erro=${result.reason}`);
  redirect(`/entrar?etapa=codigo&tel=${encodeURIComponent(result.phone)}`);
}

export async function verifyCodeAction(formData: FormData): Promise<void> {
  const segment = segmentSchema.parse(formData.get("segment"));
  const tenant = await findTenantBySegment(segment);
  if (!tenant) notFound();

  const phone = String(formData.get("phone") ?? "");
  const result = await verifyOtp({
    tenantId: tenant.id,
    rawPhone: phone,
    code: String(formData.get("code") ?? ""),
  });
  if (!result.ok) {
    redirect(`/entrar?etapa=codigo&tel=${encodeURIComponent(phone)}&erro=${result.reason}`);
  }

  const token = await signSession(
    { kind: "customer", customerId: result.customerId, tenantId: tenant.id },
    CUSTOMER_TTL_SECONDS,
  );
  (await cookies()).set(CUSTOMER_COOKIE, token, cookieOptions(CUSTOMER_TTL_SECONDS));
  await writeAudit(tenant.id, {
    actor: `customer:${result.customerId}`,
    action: "customer.login",
    ip: clientIp(await headers()),
  });
  redirect("/conta");
}

export async function customerLogoutAction(): Promise<void> {
  (await cookies()).delete(CUSTOMER_COOKIE);
  redirect("/");
}
