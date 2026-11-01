/** Formatting shared by server and client. Always pass the time zone so SSR and hydration agree. */

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions) {
  let f = cache.get(key);
  if (!f) {
    // Thai names, Gregorian years (2026, not 2569) and Western digits, to match the numbers everywhere else.
    f = new Intl.DateTimeFormat("th-TH-u-ca-gregory-nu-latn", opts);
    cache.set(key, f);
  }
  return f;
}

export function fmtTime(d: Date | number, tz: string) {
  return fmt(`t${tz}`, { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function fmtDateTime(d: Date | number, tz: string) {
  return fmt(`dt${tz}`, { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}

export function fmtDate(d: Date | number, tz: string) {
  return fmt(`d${tz}`, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
}

/** "2026-10-30" → "Fri 30 Oct" (day keys are calendar labels, no zone needed). */
export function fmtDay(day: string, withYear = false) {
  const [y, m, d] = day.split("-").map(Number);
  return fmt(`day${withYear}`, { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(
    Date.UTC(y, m - 1, d),
  );
}

/** "2026-10-30" → "30 ต.ค." (no weekday). */
export function fmtDayShort(day: string, withYear = false) {
  const [y, m, d] = day.split("-").map(Number);
  return fmt(`ds${withYear}`, { timeZone: "UTC", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(Date.UTC(y, m - 1, d));
}

export function fmtMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return fmt("month", { timeZone: "UTC", month: "long", year: "numeric" }).format(Date.UTC(y, m - 1, 1));
}

export function fmtMoney(n: number, currency = "USD", opts: { sign?: boolean; compact?: boolean } = {}) {
  const abs = Math.abs(n);
  const body =
    opts.compact && abs >= 10_000
      ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(abs)
      : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = currency === "USD" || currency === "USC" ? "$" : `${currency} `;
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  return `${sign}${sym}${body}`;
}

export function fmtNum(n: number | null | undefined, digits = 2, sign = false) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const s = Math.abs(n).toFixed(digits);
  return `${n < 0 ? "−" : sign && n > 0 ? "+" : ""}${s}`;
}

export function fmtPct(n: number | null | undefined, digits = 1, sign = false) {
  return n === null || n === undefined || !Number.isFinite(n) ? "–" : `${fmtNum(n, digits, sign)}%`;
}

export function fmtR(n: number | null | undefined, digits = 2) {
  return n === null || n === undefined ? "–" : `${fmtNum(n, digits, true)}R`;
}

export function fmtDuration(sec: number | null | undefined) {
  if (!sec) return "–";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60 ? `${m % 60}m` : ""}`.trim();
  return `${Math.round(h / 24)}d`;
}
