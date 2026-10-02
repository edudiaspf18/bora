const NATIONAL_LENGTHS = [10, 11];

/** E.164. `dialCode` virá do país da loja; por ora o padrão é Brasil. */
export function normalizePhone(raw: string, dialCode = "55"): string | null {
  if (raw.length === 0 || raw.length > 32) return null;
  if (!/^[\d\s()+\-.]+$/.test(raw)) return null;
  if (raw.includes("+") && !raw.trim().startsWith("+")) return null;

  const digits = raw.replace(/\D/g, "");
  // Com "+", o número já traz o país: sem prefixo automático (evita virar outro número).
  if (raw.trim().startsWith("+")) {
    const national = digits.length - dialCode.length;
    return digits.startsWith(dialCode) && NATIONAL_LENGTHS.includes(national) ? `+${digits}` : null;
  }
  if (digits.startsWith(dialCode) && NATIONAL_LENGTHS.includes(digits.length - dialCode.length)) {
    return `+${digits}`;
  }
  if (NATIONAL_LENGTHS.includes(digits.length)) return `+${dialCode}${digits}`;
  return null;
}
