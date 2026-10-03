export const STAFF_COOKIE = "bora_staff";
export const CUSTOMER_COOKIE = "bora_customer";
export const STAFF_TTL_SECONDS = 60 * 60 * 12;
export const CUSTOMER_TTL_SECONDS = 60 * 60 * 24 * 30;

/** Sem `domain`: o cookie fica preso ao host, isolando uma loja da outra. */
export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
