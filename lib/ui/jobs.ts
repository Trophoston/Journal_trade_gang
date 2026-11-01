/** Where an AI job's result lives, and how to name it. Shared by toasts and the AI tray. */
import { fmtDay, fmtDayShort } from "../format";

export const KIND_LABEL: Record<string, string> = {
  trade: "วิเคราะห์เทรด",
  daily: "รีวิวรายวัน",
  weekly: "รีวิวรายสัปดาห์",
  brief: "Brief เทรดถัดไป",
  pretrade: "Pre-trade check",
};

/** The page that shows the job's result. */
export function jobHref(scopeKey: string) {
  const [kind, ...rest] = scopeKey.split(":");
  if (kind === "trade") return `/trades/${encodeURIComponent(rest.join(":"))}`;
  if (kind === "daily") return `/calendar?day=${rest[1]}`;
  if (kind === "brief") return "/";
  return "/coach";
}

/** A short detail for the scope: the day or week it covers. Trades carry their own label. */
export function jobDetail(scopeKey: string) {
  const [kind, , day] = scopeKey.split(":");
  if ((kind === "daily" || kind === "brief") && day) return fmtDay(day);
  if (kind === "weekly" && day) return `สัปดาห์ ${fmtDayShort(day, false)}`;
  return "";
}

/** True when the user is on the page where the job's result appears (or where they started it). */
export function isJobHere(scopeKey: string, origin: string | undefined, pathname: string) {
  return pathname === origin || pathname === jobHref(scopeKey).split("?")[0];
}
