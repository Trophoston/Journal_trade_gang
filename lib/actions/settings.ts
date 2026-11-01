"use server";

import { randomBytes } from "node:crypto";
import { refresh } from "next/cache";
import { z } from "zod";
import { listModels, providerName } from "../ai/provider";
import { cols } from "../db/collections";
import { getSettings, settingsSchema, updateSettings } from "../settings";

const patchSchema = settingsSchema.omit({ _id: true, eaToken: true, metaapiToken: true }).partial();

export async function saveSettings(patch: z.infer<typeof patchSchema>) {
  const p = patchSchema.parse(patch);
  await updateSettings(p);
  refresh();
  return { ok: true, savedAt: Date.now() };
}

export async function setActiveAccount(id: string) {
  const c = await cols();
  if (!(await c.accounts.findOne({ _id: z.string().parse(id) }))) return;
  await updateSettings({ activeAccountId: id });
  refresh();
}

const accountPatch = z.object({
  isCent: z.boolean().optional(),
  name: z.string().max(80).optional(),
  serverTime: z.object({ mode: z.enum(["auto", "ny", "eu", "fixed"]), fixedOffsetMin: z.number().int().min(-720).max(840).optional() }).optional(),
  rules: z
    .object({
      riskPerTradePct: z.number().min(0).max(100).optional(),
      maxTradesPerDay: z.number().int().min(0).max(100).optional(),
      dailyLossLimitPct: z.number().min(0).max(100).optional(),
      maxDrawdownPct: z.number().min(0).max(100).optional(),
      newsBlackoutMin: z.number().int().min(0).max(240).optional(),
    })
    .optional(),
});

export async function saveAccount(id: string, patch: z.infer<typeof accountPatch>) {
  const p = accountPatch.parse(patch);
  const c = await cols();
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (p.isCent !== undefined) $set.isCent = p.isCent;
  if (p.name !== undefined) $set.name = p.name;
  if (p.serverTime) {
    $set["serverTime.mode"] = p.serverTime.mode;
    if (p.serverTime.fixedOffsetMin !== undefined) $set["serverTime.fixedOffsetMin"] = p.serverTime.fixedOffsetMin;
  }
  if (p.rules) $set.rules = p.rules;
  await c.accounts.updateOne({ _id: z.string().parse(id) }, { $set });
  refresh();
  return { ok: true, savedAt: Date.now() };
}

export async function adoptRule(text: string) {
  const rule = z.string().trim().min(3).max(300).parse(text);
  const s = await getSettings();
  if (!s.customRules.includes(rule)) await updateSettings({ customRules: [...s.customRules, rule] });
  refresh();
  return { ok: true };
}

export async function removeRule(text: string) {
  const s = await getSettings();
  await updateSettings({ customRules: s.customRules.filter((r) => r !== text) });
  refresh();
}

export async function regenerateToken() {
  const c = await cols();
  const token = randomBytes(18).toString("base64url");
  await c.settings.updateOne({ _id: "app" }, { $set: { eaToken: token } });
  refresh();
  return token;
}

export async function geminiModels(): Promise<{ ok: true; models: string[]; provider: string } | { ok: false; error: string }> {
  try {
    return { ok: true, models: await listModels(), provider: providerName() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not list models" };
  }
}

/** Remove the seeded demo account and everything attached to it. */
export async function deleteDemoData() {
  const c = await cols();
  const demo = await c.accounts.find({ source: "demo" }).toArray();
  for (const a of demo) {
    await Promise.all([
      c.accounts.deleteOne({ _id: a._id }),
      c.deals.deleteMany({ accountId: a._id }),
      c.trades.deleteMany({ accountId: a._id }),
      c.cashflows.deleteMany({ accountId: a._id }),
      c.symbols.deleteMany({ accountId: a._id }),
      c.equity.deleteMany({ "meta.accountId": a._id }),
      c.days.deleteMany({ accountId: a._id }),
      c.aiReports.deleteMany({ accountId: a._id }),
      c.aiJobs.deleteMany({ accountId: a._id }),
      c.aiThreads.deleteMany({ accountId: a._id }),
    ]);
  }
  await c.candles.deleteMany({ symbol: /^demo:/ });
  await c.events.deleteMany({ source: "demo" });
  const s = await getSettings();
  if (demo.some((a) => a._id === s.activeAccountId)) {
    const next = await c.accounts.find({}).sort({ lastSeenAt: -1 }).limit(1).next();
    await c.settings.updateOne({ _id: "app" }, next ? { $set: { activeAccountId: next._id } } : { $unset: { activeAccountId: "" } });
  }
  refresh();
  return { removed: demo.length };
}
