import { localParts, zonedDate } from "./time";

export interface Window {
  weekday: number;
  opensMin: number;
  closesMin: number;
}
export interface ScheduleRef {
  windows: Window[];
}
export interface AvailabilityInput {
  pausedUntil: Date | null;
  productSchedules: ScheduleRef[];
  categorySchedules: ScheduleRef[];
}
export type Availability =
  | { state: "available" }
  | { state: "paused"; until: Date }
  | { state: "out_of_hours"; nextOpensAt: Date | null };

function windowOpen(w: Window, weekday: number, minute: number): boolean {
  if (w.closesMin > w.opensMin) {
    return w.weekday === weekday && minute >= w.opensMin && minute < w.closesMin;
  }
  // Cruza a meia-noite: parte no próprio dia, resto no dia seguinte.
  return (
    (w.weekday === weekday && minute >= w.opensMin) ||
    ((w.weekday + 1) % 7 === weekday && minute < w.closesMin)
  );
}

function nextOpening(windows: Window[], now: Date, tz: string): Date | null {
  const p = localParts(now, tz);
  let best: Date | null = null;
  for (let offset = 0; offset <= 7; offset++) {
    const weekday = (p.weekday + offset) % 7;
    for (const w of windows) {
      if (w.weekday !== weekday) continue;
      const candidate = zonedDate(p.year, p.month, p.day + offset, w.opensMin, tz);
      if (candidate > now && (best === null || candidate < best)) best = candidate;
    }
  }
  return best;
}

export function itemAvailability(item: AvailabilityInput, now: Date, timezone: string): Availability {
  if (item.pausedUntil && item.pausedUntil > now) return { state: "paused", until: item.pausedUntil };

  const effective = item.productSchedules.length > 0 ? item.productSchedules : item.categorySchedules;
  if (effective.length === 0) return { state: "available" };

  const windows = effective.flatMap((s) => s.windows);
  const p = localParts(now, timezone);
  if (windows.some((w) => windowOpen(w, p.weekday, p.minute))) return { state: "available" };
  return { state: "out_of_hours", nextOpensAt: nextOpening(windows, now, timezone) };
}
