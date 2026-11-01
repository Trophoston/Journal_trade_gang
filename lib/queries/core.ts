import { cols } from "../db/collections";
import type { AccountDoc, TradeDoc } from "../domain/types";
import { getSettings } from "../settings";

export async function listAccounts(): Promise<AccountDoc[]> {
  const c = await cols();
  return c.accounts.find({}).sort({ source: -1, lastSeenAt: -1, createdAt: 1 }).toArray();
}

/** The account the UI is focused on: the chosen one, else the most recently connected. */
export async function activeAccount(): Promise<AccountDoc | null> {
  const [settings, accounts] = await Promise.all([getSettings(), listAccounts()]);
  return accounts.find((a) => a._id === settings.activeAccountId) ?? accounts[0] ?? null;
}

export interface TradeFilter {
  from?: string; // trading day, inclusive
  to?: string;
  symbol?: string;
  setup?: string;
  session?: string;
  side?: string;
}

export async function closedTrades(accountId: string, f: TradeFilter = {}): Promise<TradeDoc[]> {
  const c = await cols();
  const q: Record<string, unknown> = { accountId, status: "closed", hidden: { $ne: true } };
  if (f.from || f.to) q.tradingDay = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lte: f.to } : {}) };
  if (f.symbol) q.symbol = f.symbol;
  if (f.setup) q["journal.setup"] = f.setup;
  if (f.session) q.session = f.session;
  if (f.side) q.side = f.side;
  return c.trades.find(q).sort({ closedAt: 1 }).toArray();
}

export async function tradeById(id: string): Promise<TradeDoc | null> {
  const c = await cols();
  return c.trades.findOne({ _id: id });
}

/** Money is stored in account currency; cent accounts display in dollars. */
export function moneyScale(account: Pick<AccountDoc, "isCent"> | null | undefined) {
  return account?.isCent ? 0.01 : 1;
}

export function displayCurrency(account: Pick<AccountDoc, "currency" | "isCent"> | null | undefined) {
  if (!account) return "USD";
  return account.isCent ? "USD" : account.currency || "USD";
}
