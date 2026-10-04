export const MAX_CENTS = 99_999_999;

/** "12,50", "1.234,50", "R$ 9", "12.50" → centavos; entrada inválida → null. */
export function parseBRL(raw: string): number | null {
  const s = raw.replace(/R\$|\s/g, "");
  if (s === "") return null;
  let normalized: string;
  if (s.includes(",")) {
    if (!/^(\d{1,3}(\.\d{3})+|\d+),\d{1,2}$/.test(s)) return null;
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+(\.\d{1,2})?$/.test(s)) {
    normalized = s;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    normalized = s.replace(/\./g, "");
  } else {
    return null;
  }
  const [int, dec = ""] = normalized.split(".");
  const cents = Number(int) * 100 + Number(dec.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= MAX_CENTS ? cents : null;
}

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}
