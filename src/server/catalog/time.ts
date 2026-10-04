const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  /** 0 = domingo … 6 = sábado. */
  weekday: number;
  /** Minutos desde a meia-noite local. */
  minute: number;
}

export function localParts(date: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
    minute: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
}

/** Relógio de parede (data local + minutos) no fuso `tz` → instante. `day` e `minutes` podem estourar. */
export function zonedDate(year: number, month: number, day: number, minutes: number, tz: string): Date {
  const naive = Date.UTC(year, month - 1, day, 0, minutes);
  let guess = naive;
  // Duas passadas corrigem o deslocamento do fuso, inclusive em virada de horário de verão.
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz);
    guess += naive - Date.UTC(p.year, p.month - 1, p.day, 0, p.minute);
  }
  return new Date(guess);
}

export function startOfNextLocalDay(now: Date, tz: string): Date {
  const p = localParts(now, tz);
  return zonedDate(p.year, p.month, p.day + 1, 0, tz);
}
