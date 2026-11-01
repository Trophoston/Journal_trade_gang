/** Dashboard time periods over trading days (YYYY-MM-DD keys). Pure, so it runs on server and client. */
import { fmtDay, fmtDayShort, fmtMonth } from "../format";
import { addDays, dayKey, parseDay, weekStartOf } from "../time/zone";

export const PERIOD_KINDS = ["all", "day", "week", "month", "quarter", "year", "custom"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export interface Period {
  kind: PeriodKind;
  /** Inclusive trading-day bounds; null = open-ended. */
  from: string | null;
  to: string | null;
  /** A day inside the period; the arrows step it. */
  anchor: string;
  label: string;
  /** The period contains today. */
  current: boolean;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s: string | undefined): s is string => !!s && DAY_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const lastOfMonth = (y: number, m: number) => dayKey(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());

/** Calendar bounds of the period of `kind` that contains `anchor`. */
export function boundsOf(kind: Exclude<PeriodKind, "all" | "custom">, anchor: string): { from: string; to: string } {
  const { y, m } = parseDay(anchor);
  switch (kind) {
    case "day":
      return { from: anchor, to: anchor };
    case "week": {
      const from = weekStartOf(anchor);
      return { from, to: addDays(from, 6) };
    }
    case "month":
      return { from: dayKey(y, m, 1), to: lastOfMonth(y, m) };
    case "quarter": {
      const q = Math.floor((m - 1) / 3);
      return { from: dayKey(y, q * 3 + 1, 1), to: lastOfMonth(y, q * 3 + 3) };
    }
    case "year":
      return { from: dayKey(y, 1, 1), to: dayKey(y, 12, 31) };
  }
}

function shortRange(from: string, to: string) {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${fmtDayShort(from, !sameYear)} – ${fmtDayShort(to, true)}`;
}

function labelOf(kind: PeriodKind, from: string | null, to: string | null, current: boolean): string {
  if (kind === "all" || !from || !to) return "ทั้งหมด";
  const { y, m } = parseDay(from);
  switch (kind) {
    case "day":
      return current ? "วันนี้" : fmtDay(from, true);
    case "week":
      return current ? "สัปดาห์นี้" : shortRange(from, to);
    case "month":
      return current ? "เดือนนี้" : fmtMonth(from.slice(0, 7));
    case "quarter":
      return `${current ? "ไตรมาสนี้ · " : ""}Q${Math.floor((m - 1) / 3) + 1} ${y}`;
    case "year":
      return current ? `ปีนี้ · ${y}` : `ปี ${y}`;
    case "custom":
      return from === to ? fmtDay(from, true) : shortRange(from, to);
  }
}

/** Read a period from URL search params (`p`, `at`, `from`, `to`); anything invalid falls back to all time. */
export function resolvePeriod(sp: { p?: string; at?: string; from?: string; to?: string }, today: string): Period {
  const kind = (PERIOD_KINDS as readonly string[]).includes(sp.p ?? "") ? (sp.p as PeriodKind) : "all";
  if (kind === "all") return { kind, from: null, to: null, anchor: today, label: "ทั้งหมด", current: true };
  if (kind === "custom") {
    if (!validDay(sp.from) && !validDay(sp.to)) return resolvePeriod({}, today);
    let from = validDay(sp.from) ? sp.from : null;
    let to = validDay(sp.to) ? sp.to : null;
    if (from && to && from > to) [from, to] = [to, from];
    const current = (!from || from <= today) && (!to || to >= today);
    return { kind, from, to, anchor: to ?? today, label: labelOf(kind, from ?? to, to ?? from, current), current };
  }
  const anchor = validDay(sp.at) ? sp.at : today;
  const { from, to } = boundsOf(kind, anchor);
  const current = from <= today && today <= to;
  return { kind, from, to, anchor, label: labelOf(kind, from, to, current), current };
}

/** The anchor of the previous (-1) or next (+1) period of the same kind. */
export function shiftAnchor(kind: Exclude<PeriodKind, "all" | "custom">, anchor: string, dir: -1 | 1): string {
  const { from, to } = boundsOf(kind, anchor);
  return dir < 0 ? addDays(from, -1) : addDays(to, 1);
}

export const inPeriod = (p: Pick<Period, "from" | "to">, day: string) => (!p.from || day >= p.from) && (!p.to || day <= p.to);
