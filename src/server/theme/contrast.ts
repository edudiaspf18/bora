export const FOREGROUND_LIGHT = "#ffffff";
export const FOREGROUND_DARK = "#09090b";
const BACKGROUND_LIGHT = "#ffffff";
const BACKGROUND_DARK = "#09090b";
const MIN_TEXT_CONTRAST = 4.5;
// Abaixo disso o destaque some contra o fundo em um dos modos.
const MIN_BACKGROUND_CONTRAST = 1.25;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function pickForeground(accent: string): typeof FOREGROUND_LIGHT | typeof FOREGROUND_DARK {
  return contrastRatio(accent, FOREGROUND_LIGHT) >= contrastRatio(accent, FOREGROUND_DARK)
    ? FOREGROUND_LIGHT
    : FOREGROUND_DARK;
}

export function normalizeAccent(hex: string): string | null {
  return HEX_RE.test(hex) ? hex.toLowerCase() : null;
}

export type AccentValidation =
  | { ok: true; accent: string; foreground: string }
  | { ok: false; reason: string };

export function validateAccent(hex: string): AccentValidation {
  const accent = normalizeAccent(hex);
  if (!accent) return { ok: false, reason: "Use uma cor no formato #rrggbb." };

  const foreground = pickForeground(accent);
  if (contrastRatio(accent, foreground) < MIN_TEXT_CONTRAST) {
    return { ok: false, reason: "Contraste do texto sobre a cor é baixo demais." };
  }
  if (
    contrastRatio(accent, BACKGROUND_LIGHT) < MIN_BACKGROUND_CONTRAST ||
    contrastRatio(accent, BACKGROUND_DARK) < MIN_BACKGROUND_CONTRAST
  ) {
    return { ok: false, reason: "Cor muito próxima do fundo branco ou preto." };
  }
  return { ok: true, accent, foreground };
}
