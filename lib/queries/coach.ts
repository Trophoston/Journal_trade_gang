import "server-only";
import type { DailyReview, TradeAnalysis, WeeklyReview } from "../ai/schemas";
import type { ReportKind } from "../ai/types";
import { cols } from "../db/collections";
import { addDays, weekStartOf } from "../time/zone";
import { getCtx, getTrades, latestReport, serialize } from "./journal";

export interface HistoryItem {
  id: string;
  kind: ReportKind | "chat";
  title: string;
  at: string;
  href: string | null;
  scopeKey: string;
  version?: number;
  auto?: boolean;
  model?: string;
  content?: unknown;
  messages?: number;
}

function hrefFor(kind: ReportKind, scopeKey: string): string | null {
  const last = scopeKey.split(":").at(-1)!;
  if (kind === "trade") return `/trades/${encodeURIComponent(scopeKey.slice(6))}`;
  if (kind === "daily") return `/calendar?day=${last}`;
  if (kind === "weekly") return `/calendar?m=${last.slice(0, 7)}`;
  if (kind === "brief") return "/";
  return null;
}

/** Everything the coach has written, newest first, plus lessons worth turning into rules. */
export async function coach() {
  const ctx = await getCtx();
  if (!ctx.account) return null;
  const c = await cols();
  const accountId = ctx.account._id;
  const [reports, threads, trades] = await Promise.all([
    c.aiReports.find({ accountId }).sort({ createdAt: -1 }).limit(150).toArray(),
    c.aiThreads.find({ accountId }, { projection: { title: 1, scopeKey: 1, updatedAt: 1, messages: 1 } }).sort({ updatedAt: -1 }).limit(40).toArray(),
    getTrades(),
  ]);

  const history: HistoryItem[] = [
    ...reports.map((r) => ({ id: r._id, kind: r.kind, title: r.title, at: r.createdAt.toISOString(), href: hrefFor(r.kind, r.scopeKey), scopeKey: r.scopeKey, version: r.version, auto: r.auto, model: r.model, content: serialize(r.content) })),
    ...threads.map((t) => ({ id: t._id, kind: "chat" as const, title: t.title, at: t.updatedAt.toISOString(), href: null, scopeKey: t.scopeKey, messages: t.messages.length })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  // Lessons: the newest version per scope only, de-duplicated by text.
  const seen = new Set<string>();
  const adopted = new Set(ctx.settings.customRules.map((r) => r.trim().toLowerCase()));
  const lessons: { text: string; rule: string; from: string; href: string | null; at: string; adopted: boolean }[] = [];
  const latestPerScope = new Map<string, (typeof reports)[number]>();
  for (const r of reports) if (!latestPerScope.has(r.scopeKey)) latestPerScope.set(r.scopeKey, r);
  for (const r of latestPerScope.values()) {
    const push = (text: string, rule: string, from: string) => {
      const key = (rule || text).trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      lessons.push({ text, rule, from, href: hrefFor(r.kind, r.scopeKey), at: r.createdAt.toISOString(), adopted: adopted.has(rule.trim().toLowerCase()) });
    };
    if (r.kind === "trade") {
      const x = r.content as TradeAnalysis;
      if (x?.lesson) push(x.lesson, x.ruleSuggestion ?? "", r.title);
    } else if (r.kind === "weekly") {
      for (const rule of (r.content as WeeklyReview)?.nextWeekRules ?? []) push(rule, rule, r.title);
    } else if (r.kind === "daily") {
      const x = r.content as DailyReview;
      if (x?.keyLesson) push(x.keyLesson, "", r.title);
    }
  }

  // The week to review: this week from Saturday on, otherwise last week.
  const monday = weekStartOf(ctx.today);
  const wd = new Date(`${ctx.today}T00:00:00Z`).getUTCDay();
  const reviewMonday = wd === 6 || wd === 0 ? monday : addDays(monday, -7);
  const weeklyScope = `weekly:${accountId}:${reviewMonday}`;
  const weekly = await latestReport(weeklyScope);

  const recent = trades.slice(-200);
  return {
    ctx: { tz: ctx.tz, currency: ctx.currency },
    history,
    lessons: lessons.slice(0, 24),
    customRules: ctx.settings.customRules,
    rules: { ...ctx.settings.rules, ...ctx.account.rules },
    weekly: { monday: reviewMonday, scopeKey: weeklyScope, ...weekly },
    form: {
      symbols: [...new Set(recent.map((t) => t.symbol))].sort(),
      setups: ctx.settings.tags.setups,
      confluences: ctx.settings.tags.confluences,
      riskPct: ctx.account.rules.riskPerTradePct ?? ctx.settings.rules.riskPerTradePct ?? 1,
    },
  };
}

export type CoachData = NonNullable<Awaited<ReturnType<typeof coach>>>;
