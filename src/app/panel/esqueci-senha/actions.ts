"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/server/auth/ip";
import { requestPasswordReset } from "@/server/auth/reset";

export async function requestResetAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").slice(0, 254);
  await requestPasswordReset(email, clientIp(await headers()));
  // Mesma resposta exista ou não a conta.
  redirect("/esqueci-senha?sent=1");
}
