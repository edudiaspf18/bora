const SAFE_IP = /^[0-9a-fA-F:.]{2,45}$/;

/** Confia no proxy da hospedagem para preencher x-forwarded-for. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || headers.get("x-real-ip")?.trim() || "";
  return SAFE_IP.test(candidate) ? candidate : "unknown";
}
