import { NY_TZ, parseDay, zonedParts, zonedTime } from "./zone";

/** Sessions cover the whole 24h day in New York time, so every trade has one. */
export const SESSION_IDS = ["asia", "london", "ny_am", "ny_pm", "off"] as const;
export type SessionId = (typeof SESSION_IDS)[number];

export interface SessionWindow {
  id: SessionId;
  label: string;
  /** Minutes after midnight, New York time. `end < start` wraps past midnight. */
  start: number;
  end: number;
  /** The high-activity core shown as a "killzone" band on the timeline. */
  kz?: [number, number];
}

const hm = (h: number, m = 0) => h * 60 + m;

export const DEFAULT_SESSIONS: SessionWindow[] = [
  { id: "asia", label: "Asia", start: hm(18), end: hm(1), kz: [hm(20), hm(24)] },
  { id: "london", label: "London", start: hm(1), end: hm(7), kz: [hm(2), hm(5)] },
  { id: "ny_am", label: "NY AM", start: hm(7), end: hm(11, 30), kz: [hm(7), hm(10)] },
  { id: "ny_pm", label: "NY PM", start: hm(11, 30), end: hm(16), kz: [hm(13, 30), hm(16)] },
  { id: "off", label: "After hours", start: hm(16), end: hm(18) },
];

export const SESSION_LABEL: Record<SessionId, string> = Object.fromEntries(
  DEFAULT_SESSIONS.map((s) => [s.id, s.label]),
) as Record<SessionId, string>;

function inWindow(t: number, start: number, end: number) {
  return start <= end ? t >= start && t < end : t >= start || t < end;
}

export function sessionOf(date: Date | number, windows: SessionWindow[] = DEFAULT_SESSIONS): SessionId {
  const p = zonedParts(date, NY_TZ);
  const t = p.h * 60 + p.min;
  return windows.find((w) => inWindow(t, w.start, w.end))?.id ?? "off";
}

export interface SessionSpan {
  id: SessionId;
  label: string;
  start: Date;
  end: Date;
  kzStart?: Date;
  kzEnd?: Date;
}

/**
 * Concrete UTC spans of each session inside one trading day
 * (which runs 17:00 NY of the previous day → 17:00 NY).
 */
export function sessionSpans(day: string, windows: SessionWindow[] = DEFAULT_SESSIONS): SessionSpan[] {
  const { y, m, d } = parseDay(day);
  // Minutes in the trading day are measured from 17:00 NY the evening before.
  const at = (mins: number) => {
    const fromStart = (mins - hm(17) + 1440) % 1440;
    return zonedTime(y, m, d - 1, 17, fromStart, NY_TZ);
  };
  return windows
    .filter((w) => w.id !== "off")
    .map((w) => {
      const start = at(w.start);
      let end = at(w.end);
      if (end <= start) end = new Date(end.getTime() + 86_400_000);
      const span: SessionSpan = { id: w.id, label: w.label, start, end };
      if (w.kz) {
        span.kzStart = at(w.kz[0]);
        span.kzEnd = at(w.kz[1] % 1440);
        if (span.kzEnd <= span.kzStart) span.kzEnd = new Date(span.kzEnd.getTime() + 86_400_000);
      }
      return span;
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
