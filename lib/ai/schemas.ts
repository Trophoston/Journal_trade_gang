import { z } from "zod";

export const DRIVERS = [
  "liquidity_sweep",
  "stop_hunt",
  "fvg_respected",
  "fvg_failed",
  "order_block",
  "structure_shift",
  "trend_alignment",
  "counter_trend",
  "news_volatility",
  "session_timing",
  "risk_management",
  "early_exit",
  "late_entry",
  "emotional",
  "random_variance",
  "other",
] as const;
export type Driver = (typeof DRIVERS)[number];

const driver = z.object({
  type: z.enum(DRIVERS).describe("Main reason category"),
  confidence: z.enum(["high", "medium", "low"]).describe("high only when evidence items directly show it"),
  explanation: z.string().describe("1–2 sentences that cite evidence ids like E2"),
  evidenceIds: z.array(z.string()).describe("Evidence ids (E1…, N1…, S1…) that support this driver"),
});

const score = z.number().int().min(0).max(10);

export const tradeAnalysisSchema = z.object({
  headline: z.string().describe("One line: why this trade won or lost"),
  verdict: z.enum(["good_win", "lucky_win", "good_loss", "bad_loss", "breakeven"]).describe("Process quality vs. outcome"),
  primaryDriver: driver,
  secondaryDrivers: z.array(driver).max(3),
  wentWell: z.array(z.string()).max(4),
  toImprove: z.array(z.string()).max(4),
  scores: z.object({ entry: score, exit: score, risk: score, discipline: score }),
  lesson: z.string().describe("The single most useful lesson"),
  ruleSuggestion: z.string().describe("A concrete, checkable rule for future trades, or empty"),
  dataGaps: z.array(z.string()).max(4).describe("What was missing to be sure"),
});

const point = z.object({ title: z.string(), detail: z.string(), evidence: z.string().describe("Stat/evidence ids, e.g. S3") });

export const dailyReviewSchema = z.object({
  headline: z.string(),
  summary: z.string().describe("3–4 sentences"),
  score: z.number().int().min(0).max(100).describe("Process score for the day, not P&L"),
  bestTradeId: z.string().describe("Trade id or empty"),
  bestTradeWhy: z.string(),
  worstTradeId: z.string().describe("Trade id or empty"),
  worstTradeWhy: z.string(),
  wentWell: z.array(z.string()).max(4),
  toImprove: z.array(z.string()).max(4),
  ruleBreaks: z.array(z.string()).max(5),
  emotionalNote: z.string(),
  keyLesson: z.string(),
  tomorrowFocus: z.array(z.string()).max(3),
});

export const weeklyReviewSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  score: z.number().int().min(0).max(100),
  strengths: z.array(point).max(4),
  weaknesses: z.array(point).max(4),
  strongTimes: z.array(z.object({ window: z.string(), stat: z.string(), comment: z.string() })).max(3),
  weakTimes: z.array(z.object({ window: z.string(), stat: z.string(), comment: z.string() })).max(3),
  setups: z.array(z.object({ name: z.string(), verdict: z.enum(["keep", "refine", "drop", "not_enough_data"]), comment: z.string() })).max(5),
  mistakesCost: z.array(z.object({ mistake: z.string(), cost: z.string(), comment: z.string() })).max(4),
  behavior: z.array(z.string()).max(4),
  lastWeekPlanCheck: z.string(),
  nextWeekRules: z.array(z.string()).max(3),
  focus: z.string(),
});

export const briefSchema = z.object({
  stance: z.enum(["go", "caution", "stop"]),
  headline: z.string(),
  reasons: z.array(z.string()).max(4),
  bestWindows: z.array(z.object({ window: z.string(), localTime: z.string(), why: z.string() })).max(3),
  newsWatch: z.array(z.object({ time: z.string(), event: z.string(), advice: z.string() })).max(5),
  checklist: z.array(z.string()).max(5),
  avoid: z.array(z.string()).max(3),
});

export const preTradeSchema = z.object({
  fit: z.enum(["A+", "B", "C", "skip"]),
  headline: z.string(),
  historicalMatch: z.string(),
  reasons: z.array(z.string()).max(4),
  risks: z.array(z.string()).max(4),
  adjustments: z.array(z.string()).max(3),
});

export type TradeAnalysis = z.infer<typeof tradeAnalysisSchema>;
export type DailyReview = z.infer<typeof dailyReviewSchema>;
export type WeeklyReview = z.infer<typeof weeklyReviewSchema>;
export type Brief = z.infer<typeof briefSchema>;
export type PreTrade = z.infer<typeof preTradeSchema>;

export const DRIVER_LABEL: Record<Driver, string> = {
  liquidity_sweep: "Liquidity sweep",
  stop_hunt: "Stop hunt",
  fvg_respected: "FVG respected",
  fvg_failed: "FVG failed",
  order_block: "Order block",
  structure_shift: "Structure shift",
  trend_alignment: "With trend",
  counter_trend: "Counter-trend",
  news_volatility: "News volatility",
  session_timing: "Session timing",
  risk_management: "Risk management",
  early_exit: "Early exit",
  late_entry: "Late entry",
  emotional: "Emotional decision",
  random_variance: "Normal variance",
  other: "Other",
};
