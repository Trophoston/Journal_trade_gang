import { TZDate } from "@date-fns/tz";

export const NY_TZ = "America/New_York";
export const DEFAULT_LOCAL_TZ = "Asia/Bangkok";

const MINUTE = 60_000;
const DAY = 86_400_000;

type Parts = { y: number; m: number; d: number; h: number; min: number; wd: number };

const partFormatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(date: Date | number, tz: string): Parts {
  let fmt = partFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    partFormatters.set(tz, fmt);
  }
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(typeof date === "number" ? new Date(date) : date)) out[p.type] = p.value;
  return {
    y: Number(out.year),
    m: Number(out.month),
    d: Number(out.day),
    h: Number(out.hour),
    min: Number(out.minute),
    wd: WEEKDAYS.indexOf(out.weekday),
  };
}

/** UTC offset (minutes, east positive) of a zone at an instant. */
export function zoneOffsetMin(date: Date | number, tz: string): number {
  return -new TZDate(typeof date === "number" ? date : date.getTime(), tz).getTimezoneOffset();
}

/** True when New York observes daylight saving time at this instant. */
export function nyDst(date: Date | number): boolean {
  return zoneOffsetMin(date, NY_TZ) === -240;
}

/** Last Sunday of a month at 01:00 UTC, the EU DST switch instant. */
function euSwitch(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const back = lastDay.getUTCDay();
  return Date.UTC(year, month, lastDay.getUTCDate() - back, 1);
}

/** True when the EU observes summer time at this instant. */
export function euDst(date: Date | number): boolean {
  const ms = typeof date === "number" ? date : date.getTime();
  const y = new Date(ms).getUTCFullYear();
  return ms >= euSwitch(y, 2) && ms < euSwitch(y, 9);
}

/** UTC instant for a wall-clock time in a zone. Day overflow follows Date semantics. */
export function zonedTime(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  return new Date(new TZDate(y, m - 1, d, h, min, 0, tz).getTime());
}

export function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

export function dayKey(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function parseDay(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

/** Add days to a YYYY-MM-DD key. */
export function addDays(day: string, n: number): string {
  const { y, m, d } = parseDay(day);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return dayKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Weekday (0 = Sunday) of a YYYY-MM-DD key. */
export function weekdayOf(day: string): number {
  const { y, m, d } = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Forex trading day: it ends at 17:00 New York (the MT5 daily candle close),
 * so a trade at 18:00 NY on Monday belongs to Tuesday.
 */
export function tradingDayOf(date: Date | number): string {
  const p = zonedParts(date, NY_TZ);
  const base = dayKey(p.y, p.m, p.d);
  return p.h >= 17 ? addDays(base, 1) : base;
}

/** UTC [start, end) of a trading day. */
export function tradingDayBounds(day: string): { start: Date; end: Date } {
  const { y, m, d } = parseDay(day);
  return { start: zonedTime(y, m, d - 1, 17, 0, NY_TZ), end: zonedTime(y, m, d, 17, 0, NY_TZ) };
}

/** Monday key of the week containing a trading day. */
export function weekStartOf(day: string): string {
  const wd = weekdayOf(day);
  return addDays(day, wd === 0 ? -6 : 1 - wd);
}

/** ISO-like week label for a Monday key, e.g. "2026-W44". */
export function weekLabel(monday: string): string {
  const { y, m, d } = parseDay(monday);
  const date = new Date(Date.UTC(y, m - 1, d + 3)); // Thursday decides the ISO year
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(week)}`;
}

export function monthKey(day: string) {
  return day.slice(0, 7);
}

export const minutes = (n: number) => n * MINUTE;
export const days = (n: number) => n * DAY;
