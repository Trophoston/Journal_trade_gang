import type { Collection } from "mongodb";
import type { AiJob, AiReport, AiThread, AiUsage } from "../ai/types";
import type {
  AccountDoc,
  CandleDoc,
  CashflowDoc,
  DealDoc,
  EconEventDoc,
  EquitySnapshot,
  JournalDayDoc,
  SymbolSpec,
  TradeDoc,
} from "../domain/types";
import type { MetaApiLink } from "../connectors/metaapi";
import type { EaTask } from "../mt5/tasks";
import type { SettingsDoc } from "../settings";
import { db } from "./client";

export interface Collections {
  accounts: Collection<AccountDoc>;
  deals: Collection<DealDoc>;
  trades: Collection<TradeDoc>;
  symbols: Collection<SymbolSpec>;
  cashflows: Collection<CashflowDoc>;
  equity: Collection<EquitySnapshot>;
  candles: Collection<CandleDoc>;
  events: Collection<EconEventDoc>;
  days: Collection<JournalDayDoc>;
  settings: Collection<SettingsDoc>;
  eaTasks: Collection<EaTask>;
  aiReports: Collection<AiReport>;
  aiJobs: Collection<AiJob>;
  aiThreads: Collection<AiThread>;
  aiUsage: Collection<AiUsage>;
  links: Collection<MetaApiLink>;
}

export async function cols(): Promise<Collections> {
  const d = await db();
  return {
    accounts: d.collection("accounts"),
    deals: d.collection("deals"),
    trades: d.collection("trades"),
    symbols: d.collection("symbols"),
    cashflows: d.collection("cashflows"),
    equity: d.collection("equity_snapshots"),
    candles: d.collection("candles"),
    events: d.collection("econ_events"),
    days: d.collection("journal_days"),
    settings: d.collection("settings"),
    eaTasks: d.collection("ea_tasks"),
    aiReports: d.collection("ai_reports"),
    aiJobs: d.collection("ai_jobs"),
    aiThreads: d.collection("ai_threads"),
    aiUsage: d.collection("ai_usage"),
    links: d.collection("links"),
  };
}

const g = globalThis as unknown as { __tgIndexes?: Promise<void> };

/** Create collections and indexes once per process. */
export function ensureIndexes(): Promise<void> {
  g.__tgIndexes ??= (async () => {
    const d = await db();
    const existing = new Set((await d.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    if (!existing.has("equity_snapshots"))
      await d.createCollection("equity_snapshots", { timeseries: { timeField: "t", metaField: "meta", granularity: "minutes" } });
    const c = await cols();
    await Promise.all([
      c.accounts.createIndex({ login: 1, server: 1 }, { unique: true }),
      c.deals.createIndex({ accountId: 1, ticket: 1 }, { unique: true }),
      c.deals.createIndex({ accountId: 1, positionId: 1 }),
      c.deals.createIndex({ accountId: 1, time: -1 }),
      c.trades.createIndex({ accountId: 1, closedAt: -1 }),
      c.trades.createIndex({ accountId: 1, tradingDay: 1 }),
      c.trades.createIndex({ accountId: 1, positionId: 1 }),
      c.trades.createIndex({ "journal.setup": 1 }),
      c.cashflows.createIndex({ accountId: 1, ticket: 1 }, { unique: true }),
      c.candles.createIndex({ symbol: 1, tf: 1, t: 1 }, { unique: true }),
      c.events.createIndex({ time: 1, currency: 1 }),
      c.eaTasks.createIndex({ accountId: 1, status: 1, createdAt: 1 }),
      c.eaTasks.createIndex({ key: 1 }, { unique: true }),
      c.aiReports.createIndex({ kind: 1, scopeKey: 1, version: -1 }, { unique: true }),
      c.aiReports.createIndex({ accountId: 1, createdAt: -1 }),
      c.aiJobs.createIndex({ kind: 1, scopeKey: 1 }, { unique: true, partialFilterExpression: { active: true } }),
      c.aiJobs.createIndex({ status: 1, runAfter: 1 }),
      c.aiThreads.createIndex({ scopeKey: 1, updatedAt: -1 }),
      c.aiUsage.createIndex({ at: -1 }),
    ]);
  })().catch((err) => {
    g.__tgIndexes = undefined;
    throw err;
  });
  return g.__tgIndexes;
}
