import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface OtpSender {
  send(phone: string, code: string, ctx: { tenantSlug: string }): Promise<void>;
}

export const consoleSender: OtpSender = {
  async send(phone, code, ctx) {
    console.log(`[otp] loja=${ctx.tenantSlug} telefone=${phone} codigo=${code}`);
  },
};

/** Só para E2E: grava o último código em arquivo. Bloqueado em produção. */
const fileSender: OtpSender = {
  async send(phone, code, ctx) {
    const file = process.env.OTP_FILE ?? ".e2e/otp.json";
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ phone, code, tenant: ctx.tenantSlug }));
  },
};

/** O canal real (WhatsApp) entra no sub-projeto 5, atrás desta interface. */
export function getOtpSender(): OtpSender {
  if (process.env.OTP_SENDER === "file" && process.env.NODE_ENV !== "production") {
    return fileSender;
  }
  return consoleSender;
}
