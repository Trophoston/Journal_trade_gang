import "server-only";
import { aiConfigured, providerName } from "../ai/provider";
import { cols } from "../db/collections";
import { aiUsageReport } from "./ai-usage";
import { listAccounts } from "./core";
import { getCtx } from "./journal";

/** Everything the Settings page edits, plus live status (EA, AI queue, usage). */
export async function settingsPage() {
  const [ctx, accounts, c] = await Promise.all([getCtx(), listAccounts(), cols()]);
  const [usage, queued, failed, counts, links] = await Promise.all([
    aiUsageReport(),
    c.aiJobs.countDocuments({ status: { $in: ["queued", "running"] } }),
    c.aiJobs.find({ status: "failed" }).sort({ updatedAt: -1 }).limit(3).toArray(),
    c.trades.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$accountId", n: { $sum: 1 } } }]).toArray(),
    c.links.find({}).sort({ createdAt: 1 }).toArray(),
  ]);
  const s = ctx.settings;
  return {
    settings: {
      timezone: s.timezone,
      symbolMap: s.symbolMap,
      pipSizes: s.pipSizes,
      tags: s.tags,
      playbook: s.playbook,
      rules: s.rules,
      minSample: s.minSample,
      ai: s.ai,
      activeAccountId: ctx.account?._id ?? null,
    },
    token: s.eaToken,
    metaapi: {
      // Only a hint of the token leaves the server.
      tokenHint: s.metaapiToken ? `…${s.metaapiToken.slice(-6)}` : null,
      links: links.map((l) => ({
        id: l._id,
        login: l.login,
        server: l.server,
        name: l.name,
        status: l.status,
        connectionStatus: l.connectionStatus ?? null,
        lastError: l.lastError ?? null,
        lastSyncAt: l.lastSyncAt?.getTime() ?? null,
      })),
    },
    accounts: accounts.map((a) => ({
      id: a._id,
      name: a.name,
      login: a.login,
      server: a.server,
      company: a.company,
      currency: a.currency,
      source: a.source,
      tradeMode: a.tradeMode,
      isCent: a.isCent,
      serverTime: a.serverTime,
      rules: a.rules,
      eaVersion: a.eaVersion ?? null,
      lastSeenAt: a.lastSeenAt?.getTime() ?? null,
      firstConnectedAt: a.firstConnectedAt?.getTime() ?? null,
      trades: counts.find((x) => x._id === a._id)?.n ?? 0,
    })),
    ai: {
      provider: providerName(),
      configured: aiConfigured(),
      queued,
      failed: failed.map((j) => ({ kind: j.kind, error: j.error ?? "", at: j.updatedAt.getTime() })),
      usageToday: { requests: usage.today.requests, tokens: usage.today.tokens },
    },
    usage,
  };
}

export type SettingsData = Awaited<ReturnType<typeof settingsPage>>;
