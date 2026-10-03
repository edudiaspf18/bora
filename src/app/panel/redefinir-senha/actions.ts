"use server";

import { redirect } from "next/navigation";
import { confirmPasswordReset } from "@/server/auth/reset";

export async function confirmResetAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await confirmPasswordReset(token, password);
  if (!result.ok) {
    redirect(`/redefinir-senha?token=${encodeURIComponent(token)}&error=${result.reason}`);
  }
  redirect("/login?reset=ok");
}
