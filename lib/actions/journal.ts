"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { expediteTrade } from "../ai/queue";
import { cols } from "../db/collections";
import { deleteImage, saveImage } from "../files";
import { activeAccount } from "../queries/core";

const journalPatch = z.object({
  setup: z.string().max(80).nullable().optional(),
  confluences: z.array(z.string().max(60)).max(20).optional(),
  emotions: z.array(z.string().max(40)).max(12).optional(),
  mistakes: z.array(z.string().max(60)).max(20).optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  followedPlan: z.boolean().nullable().optional(),
  notes: z.string().max(5000).optional(),
});

/** Autosave from the trade detail. Tagging a trade sends its queued AI analysis right away. */
export async function saveJournal(tradeId: string, patch: z.infer<typeof journalPatch>) {
  const p = journalPatch.parse(patch);
  const c = await cols();
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  const $unset: Record<string, ""> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    if (v === null) $unset[`journal.${k}`] = "";
    else $set[`journal.${k}`] = v;
  }
  const trade = await c.trades.findOne({ _id: z.string().parse(tradeId) }, { projection: { journal: 1 } });
  if (!trade) return { ok: false as const };
  const tagged = Boolean(p.setup ?? trade.journal?.setup) && (p.emotions ?? trade.journal?.emotions ?? []).length > 0;
  if (tagged && !trade.journal?.reviewedAt) $set["journal.reviewedAt"] = new Date();
  await c.trades.updateOne({ _id: tradeId }, { $set, ...(Object.keys($unset).length ? { $unset } : {}) });
  if (tagged) await expediteTrade(tradeId);
  return { ok: true as const, savedAt: Date.now() };
}

/** One-tap tagging from the "trade closed" toast or the review queue. */
export async function quickTag(tradeId: string, tags: { setup?: string; emotion?: string }) {
  const c = await cols();
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (tags.setup) $set["journal.setup"] = z.string().max(80).parse(tags.setup);
  const update: Record<string, unknown> = { $set };
  if (tags.emotion) update.$addToSet = { "journal.emotions": z.string().max(40).parse(tags.emotion) };
  await c.trades.updateOne({ _id: z.string().parse(tradeId) }, update);
  const t = await c.trades.findOne({ _id: tradeId }, { projection: { journal: 1 } });
  if (t?.journal?.setup && t.journal.emotions?.length && !t.journal.reviewedAt) {
    await c.trades.updateOne({ _id: tradeId }, { $set: { "journal.reviewedAt": new Date() } });
    await expediteTrade(tradeId);
  }
  refresh();
  return { ok: true };
}

export async function setHidden(tradeId: string, hidden: boolean) {
  const c = await cols();
  await c.trades.updateOne({ _id: z.string().parse(tradeId) }, { $set: { hidden, updatedAt: new Date() } });
  refresh();
}

/** Bulk tagging in the trades table; returns the previous values for Undo. */
export async function bulkSetSetup(tradeIds: string[], setup: string | null) {
  const ids = z.array(z.string()).max(500).parse(tradeIds);
  const c = await cols();
  const before = await c.trades.find({ _id: { $in: ids } }, { projection: { "journal.setup": 1 } }).toArray();
  if (setup) await c.trades.updateMany({ _id: { $in: ids } }, { $set: { "journal.setup": z.string().max(80).parse(setup), updatedAt: new Date() } });
  else await c.trades.updateMany({ _id: { $in: ids } }, { $unset: { "journal.setup": "" } });
  refresh();
  return before.map((t) => ({ id: t._id, setup: t.journal?.setup ?? null }));
}

export async function restoreSetups(prev: { id: string; setup: string | null }[]) {
  const c = await cols();
  for (const p of prev) {
    if (p.setup) await c.trades.updateOne({ _id: p.id }, { $set: { "journal.setup": p.setup } });
    else await c.trades.updateOne({ _id: p.id }, { $unset: { "journal.setup": "" } });
  }
  refresh();
}

const dayPatch = z.object({
  plan: z.string().max(4000).optional(),
  reflection: z.string().max(4000).optional(),
  bias: z.enum(["bullish", "bearish", "neutral"]).nullable().optional(),
  mood: z.number().int().min(1).max(5).nullable().optional(),
});

export async function saveDay(day: string, patch: z.infer<typeof dayPatch>) {
  const p = dayPatch.parse(patch);
  const account = await activeAccount();
  if (!account) return { ok: false as const };
  const c = await cols();
  const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(day);
  const $set: Record<string, unknown> = { accountId: account._id, day: d, updatedAt: new Date() };
  const $unset: Record<string, ""> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    if (v === null) $unset[k] = "";
    else $set[k] = v;
  }
  await c.days.updateOne({ _id: `${account._id}:${d}` }, { $set, ...(Object.keys($unset).length ? { $unset } : {}) }, { upsert: true });
  return { ok: true as const, savedAt: Date.now() };
}

export async function uploadScreenshot(form: FormData) {
  const tradeId = z.string().parse(form.get("tradeId"));
  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "ไม่มีรูป" };
  try {
    const id = await saveImage(file, { tradeId });
    const c = await cols();
    await c.trades.updateOne({ _id: tradeId }, { $push: { "journal.screenshots": { id, caption: "" } }, $set: { updatedAt: new Date() } });
    refresh();
    return { ok: true as const, id };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Upload failed" };
  }
}

export async function removeScreenshot(tradeId: string, id: string) {
  const c = await cols();
  await c.trades.updateOne({ _id: z.string().parse(tradeId) }, { $pull: { "journal.screenshots": { id: z.string().parse(id) } } });
  await deleteImage(id);
  refresh();
}
