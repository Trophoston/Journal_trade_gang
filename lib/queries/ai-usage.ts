import "server-only";
import { cols } from "../db/collections";
import { getSettings } from "../settings";
import { addDays } from "../time/zone";

/** Gemini's daily request quotas reset at midnight Pacific time, so "today" is a Pacific day here. */
export const QUOTA_TZ = "America/Los_Angeles";

const pacificDay = (d: Date | number) => new Intl.DateTimeFormat("en-CA", { timeZone: QUOTA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** The next midnight in Pacific time, as a timestamp. */
function nextPacificMidnight(now: number): number {
  const today = pacificDay(now);
  // Walk forward in 15-minute steps; DST-proof without a timezone library.
  let t = now - (now % 900_000) + 900_000;
  while (pacificDay(t) === today) t += 900_000;
  return t;
}

const LABEL: Record<string, string> = {
  trade: "วิเคราะห์เทรด",
  daily: "รีวิวรายวัน",
  weekly: "รีวิวรายสัปดาห์",
  brief: "Brief เทรดถัดไป",
  pretrade: "Pre-trade check",
  chat: "แชตข้าง",
  search: "Google Search",
};

export interface UsageTotals {
  requests: number; // answered calls
  limited: number; // rejected with 429 / quota
  failed: number; // other errors
  input: number;
  output: number;
  thinking: number;
  tokens: number;
}

const empty = (): UsageTotals => ({ requests: 0, limited: 0, failed: 0, input: 0, output: 0, thinking: 0, tokens: 0 });

function add(t: UsageTotals, u: { input: number; output: number; total: number; error?: string }) {
  if (u.error === "rate_limit") t.limited++;
  else if (u.error) t.failed++;
  else t.requests++;
  t.input += u.input;
  t.output += u.output;
  t.thinking += Math.max(0, u.total - u.input - u.output);
  t.tokens += Math.max(u.total, u.input + u.output);
}

/** How much this app has used the Gemini API key: today (quota day), the last 30 days and all time. */
export async function aiUsageReport() {
  const c = await cols();
  const now = Date.now();
  const today = pacificDay(now);
  const first = addDays(today, -29);
  const rows = await c.aiUsage
    .find({ at: { $gte: new Date(now - 31 * 86_400_000) } }, { projection: { _id: 0 } })
    .sort({ at: 1 })
    .toArray();
  const [all] = await c.aiUsage
    .aggregate<{ n: number; tokens: number; since: Date }>([{ $match: { error: { $exists: false } } }, { $group: { _id: null, n: { $sum: 1 }, tokens: { $sum: "$total" }, since: { $min: "$at" } } }])
    .toArray();

  const days = new Map<string, UsageTotals>();
  for (let d = first; d <= today; d = addDays(d, 1)) days.set(d, empty());
  const todayTotals = empty();
  const monthTotals = empty();
  const byModelToday = new Map<string, UsageTotals>();
  const byModel30 = new Map<string, UsageTotals>();
  const byKind = new Map<string, UsageTotals>();
  let lastLimitedAt: number | null = null;

  for (const r of rows) {
    const day = pacificDay(r.at);
    const bucket = days.get(day);
    if (!bucket) continue; // older than the 30-day window
    add(bucket, r);
    add(monthTotals, r);
    add(byModel30.get(r.model) ?? byModel30.set(r.model, empty()).get(r.model)!, r);
    add(byKind.get(r.kind) ?? byKind.set(r.kind, empty()).get(r.kind)!, r);
    if (r.error === "rate_limit") lastLimitedAt = r.at.getTime();
    if (day === today) {
      add(todayTotals, r);
      add(byModelToday.get(r.model) ?? byModelToday.set(r.model, empty()).get(r.model)!, r);
    }
  }
  // Requests in the last minute, for the per-minute (RPM) limit.
  const lastMinute = rows.filter((r) => r.at.getTime() > now - 60_000).length;

  const settings = await getSettings();
  const roles: Record<string, string[]> = {};
  for (const [role, model] of [
    ["Fast", settings.ai.fastModel],
    ["Deep", settings.ai.deepModel],
    ["Lite", settings.ai.liteModel],
    ["Search", settings.ai.searchModel],
  ] as const)
    (roles[model] ??= []).push(role);

  const models = [...new Set([...Object.keys(roles), ...byModel30.keys()])].map((model) => ({
    model,
    roles: roles[model] ?? [],
    today: byModelToday.get(model) ?? empty(),
    month: byModel30.get(model) ?? empty(),
  }));
  models.sort((a, b) => b.today.requests - a.today.requests || b.month.requests - a.month.requests);

  return {
    tz: QUOTA_TZ,
    resetsAt: nextPacificMidnight(now),
    today: todayTotals,
    month: monthTotals,
    lastMinute,
    lastLimitedAt,
    allTime: { requests: all?.n ?? 0, tokens: all?.tokens ?? 0, since: all?.since?.getTime() ?? null },
    days: [...days].map(([day, t]) => ({ day, ...t })),
    models,
    kinds: [...byKind]
      .map(([kind, t]) => ({ kind, label: LABEL[kind] ?? kind, ...t }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}

export type AiUsageReport = Awaited<ReturnType<typeof aiUsageReport>>;
