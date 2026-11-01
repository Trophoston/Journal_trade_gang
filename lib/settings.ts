import { randomBytes } from "node:crypto";
import { z } from "zod";
import { cols } from "./db/collections";

export const DEFAULT_TAGS = {
  setups: ["Liquidity sweep + FVG", "Order block retest", "Breakout retest", "Trend continuation", "Range fade"],
  confluences: ["Liquidity sweep", "FVG", "Order block", "BOS / MSS", "SMT divergence", "OTE", "Breaker", "Killzone", "HTF bias", "News"],
  emotions: ["Calm", "Confident", "FOMO", "Fear", "Revenge", "Greedy", "Bored", "Tired"],
  mistakes: ["Early entry", "Late entry", "No stop loss", "Moved stop", "Oversized", "Cut winner early", "Held loser", "Chased price", "Traded news", "Overtraded"],
};

export const settingsSchema = z.object({
  _id: z.literal("app").default("app"),
  timezone: z.string().default("Asia/Bangkok"),
  eaToken: z.string().default(""),
  /** MetaApi token for the login + investor-password connection (stays in local MongoDB). */
  metaapiToken: z.string().optional(),
  activeAccountId: z.string().optional(),
  symbolMap: z.record(z.string(), z.string()).default({}),
  pipSizes: z.record(z.string(), z.number()).default({}),
  tags: z
    .object({
      setups: z.array(z.string()).default(DEFAULT_TAGS.setups),
      confluences: z.array(z.string()).default(DEFAULT_TAGS.confluences),
      emotions: z.array(z.string()).default(DEFAULT_TAGS.emotions),
      mistakes: z.array(z.string()).default(DEFAULT_TAGS.mistakes),
    })
    .default(DEFAULT_TAGS),
  playbook: z.array(z.object({ name: z.string(), rules: z.array(z.string()) })).default([
    {
      name: "Liquidity sweep + FVG",
      rules: ["HTF bias agrees", "Session high/low or PDH/PDL swept", "M5 structure shift after the sweep", "Entry in the FVG left by the shift", "Stop beyond the sweep wick, 1% risk"],
    },
  ]),
  rules: z
    .object({
      riskPerTradePct: z.number().optional().default(1),
      maxTradesPerDay: z.number().optional().default(3),
      dailyLossLimitPct: z.number().optional().default(3),
      maxDrawdownPct: z.number().optional().default(10),
      newsBlackoutMin: z.number().optional().default(15),
      requireStopLoss: z.boolean().optional().default(true),
    })
    .default({ riskPerTradePct: 1, maxTradesPerDay: 3, dailyLossLimitPct: 3, maxDrawdownPct: 10, newsBlackoutMin: 15, requireStopLoss: true }),
  customRules: z.array(z.string()).default([]),
  minSample: z.number().int().min(3).max(50).default(8),
  ai: z
    .object({
      language: z.enum(["th", "en"]).default("th"),
      // Defaults all run on Gemini's free tier.
      fastModel: z.string().default("gemini-3.8-flash"),
      deepModel: z.string().default("gemini-3.8-flash"),
      /** Used when the models above hit their rate limit. */
      liteModel: z.string().default("gemini-3.5-flash-lite"),
      /** Google Search grounding is free (500/day) only on the 2.5 Flash models. */
      searchModel: z.string().default("gemini-2.5-flash"),
      autoTrade: z.boolean().default(true),
      autoDaily: z.boolean().default(true),
      autoWeekly: z.boolean().default(true),
      autoBrief: z.boolean().default(true),
      sendScreenshots: z.boolean().default(true),
      useSearch: z.boolean().default(true),
      analyzeDelayMin: z.number().int().min(0).max(240).default(30),
    })
    .default({
      language: "th",
      fastModel: "gemini-3.8-flash",
      deepModel: "gemini-3.8-flash",
      liteModel: "gemini-3.5-flash-lite",
      searchModel: "gemini-2.5-flash",
      autoTrade: true,
      autoDaily: true,
      autoWeekly: true,
      autoBrief: true,
      sendScreenshots: true,
      useSearch: true,
      analyzeDelayMin: 30,
    }),
});

export type SettingsDoc = z.infer<typeof settingsSchema>;

/** Read settings, creating the document (and the EA token) on first use. */
export async function getSettings(): Promise<SettingsDoc> {
  const c = await cols();
  const doc = await c.settings.findOne({ _id: "app" });
  const parsed = settingsSchema.parse(doc ?? {});
  if (!doc || !parsed.eaToken) {
    parsed.eaToken = parsed.eaToken || randomBytes(18).toString("base64url");
    await c.settings.replaceOne({ _id: "app" }, parsed, { upsert: true });
  }
  return parsed;
}

export async function updateSettings(patch: Partial<Omit<SettingsDoc, "_id">>): Promise<SettingsDoc> {
  const c = await cols();
  const current = await getSettings();
  const next = settingsSchema.parse({ ...current, ...patch, _id: "app" });
  await c.settings.replaceOne({ _id: "app" }, next, { upsert: true });
  return next;
}
