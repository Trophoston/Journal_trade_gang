import type { AnyBulkWriteOperation } from "mongodb";
import { scheduleTradeAnalysis } from "../ai/queue";
import { cols } from "../db/collections";
import type { AccountDoc, CashflowDoc, DealDoc, SlChange, SymbolSpec, TradeDoc } from "../domain/types";
import { publish } from "../live/bus";
import { markSeen } from "../live/presence";
import { refreshEvidence } from "../market/service";
import { moneyScale } from "../queries/core";
import { getSettings } from "../settings";
import { tradesFromDeals } from "./aggregate";
import { dealEntry, dealKind, importanceOf, type HelloPayload } from "./protocol";
import type { calendarSchema, candlesSchema, dealsSchema, heartbeatSchema, positionUpdateSchema } from "./protocol";
import { observedOffset, serverToUtc, utcToServer } from "./servertime";
import { canonicalSymbol, defaultPipSize } from "./symbols";
import { planTradeTasks, planUpcomingCalendar } from "./tasks";
import type { z } from "zod";

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 5);
}

export const accountIdFor = (login: number, server: string) => `a${login}-${hash(server)}`;

export async function getAccount(login: number, server: string) {
  const c = await cols();
  return c.accounts.findOne({ _id: accountIdFor(login, server) });
}

const FLOW_KIND: Record<string, CashflowDoc["kind"]> = {
  credit: "credit",
  bonus: "bonus",
  charge: "charge",
  interest: "interest",
  commission: "commission",
  correction: "correction",
};

/** EA connected: register/refresh the account and tell it where to resume history. */
/** An expected state the EA should just wait out, not a server error. */
export class EaNotice extends Error {
  name = "EaNotice";
}

export async function handleHello(p: HelloPayload, source: "mt5" | "demo" = "mt5") {
  // A terminal that isn't logged in to the broker reports no currency, a zero balance and no history.
  if (source === "mt5" && !p.currency) throw new EaNotice("MT5 is not logged in to the broker yet (File → Login to Trade Account). Waiting.");
  const c = await cols();
  const _id = accountIdFor(p.login, p.server);
  const now = new Date();
  const existing = await c.accounts.findOne({ _id });
  const observed = observedOffset(p.serverTime, p.gmtTime);
  const isCent = /USC|cent/i.test(p.currency) || /XAUUSDc|cent/i.test(p.server);
  await c.accounts.updateOne(
    { _id },
    {
      $set: {
        login: p.login,
        server: p.server,
        company: p.company,
        name: p.name,
        currency: p.currency,
        leverage: p.leverage,
        marginMode: /NETTING|EXCHANGE/.test(p.marginMode) ? "netting" : "hedging",
        tradeMode: p.tradeMode.includes("REAL") ? "real" : p.tradeMode.includes("CONTEST") ? "contest" : "demo",
        balance: p.balance,
        equity: p.equity,
        "serverTime.observedOffsetMin": observed,
        eaVersion: p.ea,
        lastSeenAt: now,
        updatedAt: now,
        source,
        // USC is always a cent account; otherwise keep what the user set in Settings.
        ...(isCent ? { isCent: true } : {}),
      },
      $setOnInsert: {
        ...(isCent ? {} : { isCent: false }),
        "serverTime.mode": "auto",
        rules: {},
        margin: 0,
        freeMargin: 0,
        floating: 0,
        positions: [],
        firstConnectedAt: now,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  const settings = await getSettings();
  // The first real account takes focus over the demo data.
  const focused = settings.activeAccountId ? await c.accounts.findOne({ _id: settings.activeAccountId }, { projection: { source: 1 } }) : null;
  if (!focused || (source === "mt5" && focused.source === "demo" && !existing)) await c.settings.updateOne({ _id: "app" }, { $set: { activeAccountId: _id } });

  const account = (await c.accounts.findOne({ _id }))!;
  if (source === "mt5") await planUpcomingCalendar(account);
  markSeen(account, now.getTime());

  const last = await c.deals.find({ accountId: _id }).sort({ time: -1 }).limit(1).next();
  // Resume two days before the newest deal we hold (in server time); re-sent deals are idempotent.
  const since = last ? Math.max(0, utcToServer(new Date(last.timeMsc - 2 * 86_400_000), account.serverTime)) : 0;
  return { accountId: _id, since: existing && last ? since : 0, isNew: !existing };
}

/** Store deals, rebuild the trades they touch and react to trades that just closed. */
export async function handleDeals(p: z.infer<typeof dealsSchema>) {
  const c = await cols();
  const account = await c.accounts.findOne({ _id: accountIdFor(p.login, p.server) });
  if (!account) throw new Error("Unknown account. The EA must call /api/ea/hello first.");
  const settings = await getSettings();
  const cfg = account.serverTime;

  if (p.symbols.length) {
    await c.symbols.bulkWrite(
      p.symbols.map((s) => {
        const symbol = canonicalSymbol(s.name, settings.symbolMap);
        const spec: SymbolSpec = {
          _id: `${account._id}:${s.name}`,
          accountId: account._id,
          raw: s.name,
          symbol,
          digits: s.digits,
          point: s.point,
          tickSize: s.tickSize,
          tickValue: s.tickValue,
          contractSize: s.contractSize,
          currencyProfit: s.currencyProfit,
          pipSize: settings.pipSizes[symbol] ?? defaultPipSize(symbol, s.digits, s.point),
        };
        return { replaceOne: { filter: { _id: spec._id }, replacement: spec, upsert: true } };
      }),
    );
  }

  // MT5 deals never change once written, and the EA re-sends recent history on every
  // reconcile, so skip tickets we already hold instead of re-aggregating them.
  const tickets = p.deals.map((d) => d.ticket);
  const [knownDeals, knownFlows] = await Promise.all([
    c.deals.find({ accountId: account._id, ticket: { $in: tickets } }, { projection: { ticket: 1 } }).toArray(),
    c.cashflows.find({ accountId: account._id, ticket: { $in: tickets } }, { projection: { ticket: 1 } }).toArray(),
  ]);
  const known = new Set([...knownDeals, ...knownFlows].map((x) => x.ticket));

  const dealOps: AnyBulkWriteOperation<DealDoc>[] = [];
  const flowOps: AnyBulkWriteOperation<CashflowDoc>[] = [];
  const touched = new Set<number>();
  for (const d of p.deals) {
    if (known.has(d.ticket)) continue;
    const kind = dealKind(d.type);
    const time = serverToUtc(d.time, cfg);
    if (kind !== "buy" && kind !== "sell") {
      const amount = d.profit + d.commission + d.swap + d.fee;
      if (!amount) continue;
      const flow: CashflowDoc = {
        accountId: account._id,
        ticket: d.ticket,
        time,
        kind: kind === "balance" ? (amount >= 0 ? "deposit" : "withdrawal") : (FLOW_KIND[kind] ?? "correction"),
        amount,
        comment: d.comment,
      };
      flowOps.push({ replaceOne: { filter: { accountId: account._id, ticket: d.ticket }, replacement: flow, upsert: true } });
      continue;
    }
    const doc: DealDoc = {
      accountId: account._id,
      ticket: d.ticket,
      order: d.order,
      positionId: d.position || d.order || d.ticket,
      time,
      timeMsc: time.getTime() + (d.timeMsc ? d.timeMsc % 1000 : 0),
      kind,
      entry: dealEntry(d.entry),
      reason: d.reason,
      symbol: canonicalSymbol(d.symbol, settings.symbolMap),
      rawSymbol: d.symbol,
      volume: d.volume,
      price: d.price,
      profit: d.profit,
      commission: d.commission,
      swap: d.swap,
      fee: d.fee,
      sl: d.sl,
      tp: d.tp,
      magic: d.magic,
      comment: d.comment,
    };
    dealOps.push({ replaceOne: { filter: { accountId: account._id, ticket: d.ticket }, replacement: doc, upsert: true } });
    touched.add(doc.positionId);
  }
  if (dealOps.length) await c.deals.bulkWrite(dealOps, { ordered: false });
  if (flowOps.length) await c.cashflows.bulkWrite(flowOps, { ordered: false });

  const result = await rebuildPositions(account, [...touched]);
  if (flowOps.length && !result.changed) publish({ type: "trades.changed", accountId: account._id, count: 0 });
  return { accepted: dealOps.length + flowOps.length, ...result };
}

/** Re-aggregate the given positions from their deals, preserving journal data. */
export async function rebuildPositions(account: AccountDoc, positionIds: number[]) {
  if (!positionIds.length) return { changed: 0, closed: [] as TradeDoc[] };
  const c = await cols();
  const [deals, previous, specs] = await Promise.all([
    c.deals.find({ accountId: account._id, positionId: { $in: positionIds } }).toArray(),
    c.trades.find({ accountId: account._id, positionId: { $in: positionIds } }).toArray(),
    c.symbols.find({ accountId: account._id }).toArray(),
  ]);
  const specBy = new Map(specs.map((s) => [s.raw, s]));
  const prevBy = new Map(previous.map((t) => [t._id, t]));
  const byPos = new Map<number, DealDoc[]>();
  for (const d of deals) (byPos.get(d.positionId) ?? byPos.set(d.positionId, []).get(d.positionId)!).push(d);

  const now = new Date();
  const ops: AnyBulkWriteOperation<TradeDoc>[] = [];
  const closed: TradeDoc[] = [];
  const opened: TradeDoc[] = [];
  for (const [positionId, list] of byPos) {
    const slHistory: SlChange[] = previous.filter((t) => t.positionId === positionId).flatMap((t) => t.slHistory ?? []);
    const cores = tradesFromDeals(list, { accountId: account._id, spec: specBy.get(list[0].rawSymbol), slHistory });
    for (const core of cores) {
      const prev = prevBy.get(core._id);
      ops.push({
        updateOne: {
          filter: { _id: core._id },
          update: {
            $set: { ...core, updatedAt: now },
            $setOnInsert: { journal: { confluences: [], emotions: [], mistakes: [], screenshots: [] }, createdAt: now, source: account.source },
          },
          upsert: true,
        },
      });
      const doc = { ...(prev ?? {}), ...core, journal: prev?.journal ?? { confluences: [], emotions: [], mistakes: [], screenshots: [] }, source: account.source, createdAt: prev?.createdAt ?? now, updatedAt: now } as TradeDoc;
      if (core.status === "closed" && prev?.status !== "closed") closed.push(doc);
      if (core.status === "open" && !prev) opened.push(doc);
    }
  }
  if (ops.length) await c.trades.bulkWrite(ops, { ordered: false });

  for (const t of opened) publish({ type: "trade.opened", accountId: account._id, tradeId: t._id, symbol: t.symbol, side: t.side });
  const live = account.firstConnectedAt ? account.firstConnectedAt.getTime() - 3_600_000 : Infinity;
  for (const t of closed) {
    if (t.closedAt && t.closedAt.getTime() >= live) {
      publish({ type: "trade.closed", accountId: account._id, tradeId: t._id, symbol: t.symbol, side: t.side, net: t.net * moneyScale(account), r: t.r, currency: account.isCent ? "USD" : account.currency });
      await scheduleTradeAnalysis(t);
    }
  }
  if (closed.length) await planTradeTasks(account, closed);
  if (ops.length) publish({ type: "trades.changed", accountId: account._id, count: ops.length });
  return { changed: ops.length, closed };
}

export async function handleHeartbeat(p: z.infer<typeof heartbeatSchema>) {
  const c = await cols();
  const _id = accountIdFor(p.login, p.server);
  const account = await c.accounts.findOne({ _id });
  if (!account) throw new Error("Unknown account. The EA must call /api/ea/hello first.");
  const settings = await getSettings();
  const now = new Date();
  const positions = p.positions.map((x) => ({
    ticket: x.ticket,
    positionId: x.identifier,
    symbol: canonicalSymbol(x.symbol, settings.symbolMap),
    side: (x.type.includes("SELL") ? "short" : "long") as "long" | "short",
    volume: x.volume,
    priceOpen: x.priceOpen,
    priceCurrent: x.priceCurrent,
    sl: x.sl,
    tp: x.tp,
    profit: x.profit,
    swap: x.swap,
    openedAt: serverToUtc(x.time, account.serverTime),
  }));
  await c.accounts.updateOne(
    { _id },
    { $set: { balance: p.balance, equity: p.equity, margin: p.margin, freeMargin: p.freeMargin, floating: p.profit, positions, lastSeenAt: now } },
  );
  const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const lastSnap = await c.equity.find({ "meta.accountId": _id }).sort({ t: -1 }).limit(1).next();
  if (!lastSnap || lastSnap.t.getTime() < minute.getTime())
    await c.equity.insertOne({ t: minute, meta: { accountId: _id }, balance: p.balance, equity: p.equity });

  markSeen(account, now.getTime());
  // Raw account currency: the top bar and live card apply the cent scale themselves.
  publish({ type: "heartbeat", accountId: _id, balance: p.balance, equity: p.equity, floating: p.profit, margin: p.margin, positions: positions.length, at: now.getTime() });
  if (now.getMinutes() === 0 && now.getSeconds() < 5) await planUpcomingCalendar(account);
  return { account: { ...account, lastSeenAt: now } };
}

export async function handlePositionUpdate(p: z.infer<typeof positionUpdateSchema>) {
  const c = await cols();
  const account = await c.accounts.findOne({ _id: accountIdFor(p.login, p.server) });
  if (!account) return;
  const change: SlChange = { time: serverToUtc(p.time, account.serverTime), sl: p.sl, tp: p.tp };
  const trade = await c.trades.findOne({ accountId: account._id, positionId: p.position, status: "open" });
  if (!trade) return;
  const last = trade.slHistory?.at(-1);
  if (last && last.sl === change.sl && last.tp === change.tp) return;
  await c.trades.updateOne({ _id: trade._id }, { $push: { slHistory: change }, $set: { updatedAt: new Date() } });
}

export async function handleCandles(p: z.infer<typeof candlesSchema>) {
  const c = await cols();
  const account = await c.accounts.findOne({ _id: accountIdFor(p.login, p.server) });
  if (!account) throw new Error("Unknown account");
  const settings = await getSettings();
  const symbol = canonicalSymbol(p.symbol, settings.symbolMap);
  if (p.bars.length) {
    await c.candles.bulkWrite(
      p.bars.map(([t, o, h, l, cl, v]) => {
        const time = serverToUtc(t, account.serverTime);
        return { updateOne: { filter: { symbol, tf: p.tf, t: time }, update: { $set: { o, h, l, c: cl, v: v ?? 0 } }, upsert: true } };
      }),
      { ordered: false },
    );
  }
  await completeTask(p.task);
  if (p.bars.length) {
    const from = serverToUtc(p.bars[0][0], account.serverTime);
    const to = serverToUtc(p.bars[p.bars.length - 1][0], account.serverTime);
    const affected = await c.trades
      .find({ accountId: account._id, symbol, status: "closed", openedAt: { $lte: to }, closedAt: { $gte: from } })
      .toArray();
    for (const t of affected) await refreshEvidence(t);
  }
  return { stored: p.bars.length };
}

export async function handleCalendar(p: z.infer<typeof calendarSchema>) {
  const c = await cols();
  const account = await c.accounts.findOne({ _id: accountIdFor(p.login, p.server) });
  if (!account) throw new Error("Unknown account");
  if (p.events.length) {
    await c.events.bulkWrite(
      p.events.map((e) => ({
        replaceOne: {
          filter: { _id: `mt5:${e.id}` },
          replacement: {
            _id: `mt5:${e.id}`,
            eventId: e.eventId,
            time: serverToUtc(e.time, account.serverTime),
            currency: e.currency,
            country: e.country,
            name: e.name,
            importance: importanceOf(e.importance),
            actual: e.actual,
            forecast: e.forecast,
            previous: e.previous,
            source: "mt5" as const,
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }
  await completeTask(p.task);
  return { stored: p.events.length };
}

export async function completeTask(id: string) {
  const { ObjectId } = await import("mongodb");
  if (!ObjectId.isValid(id)) return;
  const c = await cols();
  await c.eaTasks.updateOne({ _id: new ObjectId(id) }, { $set: { status: "done", doneAt: new Date() } });
}
