import { randomBytes } from "node:crypto";
import { cols } from "../db/collections";
import type { Timeframe } from "../domain/types";
import { markLost } from "../live/presence";
import { accountIdFor, completeTask, handleCandles, handleDeals, handleHeartbeat, handleHello, handlePositionUpdate } from "../mt5/ingest";
import { getSettings } from "../settings";

/**
 * MetaApi (metaapi.cloud) runs MT5 in the cloud from your account number, server and investor
 * (read-only) password, so trades sync without the MT5 app or the EA. The password is sent to
 * MetaApi once when the link is created and is never stored here. Everything MetaApi returns is
 * turned into the EA's payloads and goes through the same ingest code.
 */

export interface MetaApiLink {
  _id: string; // MetaApi account id
  kind: "metaapi";
  login: number;
  server: string;
  name: string;
  region?: string;
  state?: string;
  connectionStatus?: string;
  accountId?: string;
  status: "deploying" | "connecting" | "live" | "error";
  lastError?: string;
  lastSyncAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PROVISIONING = "https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai";
const clientHost = (region: string) => `https://mt-client-api-v1.${region}.agiliumtrade.ai`;
const marketHost = (region: string) => `https://mt-market-data-client-api-v1.${region}.agiliumtrade.ai`;

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(
  token: string,
  url: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; data: T; retryAfter?: number }> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      "auth-token": token,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  const data = (text ? safeJson(text) : null) as T;
  if (res.status >= 400) {
    const msg = (data as { message?: string } | null)?.message ?? text.slice(0, 200);
    if (res.status === 401) throw new MetaApiError("MetaApi ไม่รับ token นี้ คัดลอกอันใหม่จาก app.metaapi.cloud/token", 401);
    throw new MetaApiError(`MetaApi ${res.status}: ${msg}`, res.status);
  }
  return {
    status: res.status,
    data,
    retryAfter: Number(res.headers.get("retry-after")) || undefined,
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "2026-11-01 08:30:04.361" (broker clock) → seconds on the broker clock, the unit the EA sends. */
const brokerSec = (brokerTime: string) => Math.floor(Date.parse(`${brokerTime.replace(" ", "T")}Z`) / 1000);
const brokerMs = (brokerTime: string) => Date.parse(`${brokerTime.replace(" ", "T")}Z`) % 1000;

async function token() {
  const t = (await getSettings()).metaapiToken;
  if (!t) throw new MetaApiError("เพิ่ม MetaApi token ก่อน", 400);
  return t;
}

/** Create the MetaApi account (read-only with an investor password) and deploy it. */
export async function createLink(input: { token: string; login: number; server: string; password: string; name: string }): Promise<MetaApiLink> {
  const transactionId = randomBytes(16).toString("hex");
  const body = {
    login: String(input.login),
    password: input.password,
    name: input.name || `Trade Gang ${input.login}`,
    server: input.server,
    platform: "mt5",
    magic: 0,
    manualTrades: true,
  };
  let res = await call<{ id: string; state: string }>(input.token, `${PROVISIONING}/users/current/accounts`, { method: "POST", body, headers: { "transaction-id": transactionId } });
  // 202: MetaApi is still detecting the broker settings; poll with the same transaction id.
  for (let i = 0; res.status === 202 && i < 20; i++) {
    await sleep((res.retryAfter ?? 5) * 1000);
    res = await call(input.token, `${PROVISIONING}/users/current/accounts`, {
      method: "POST",
      body,
      headers: { "transaction-id": transactionId },
    });
  }
  if (res.status === 202 || !res.data?.id) throw new MetaApiError("MetaApi ยังตั้งค่าบัญชีไม่เสร็จ ลองใหม่ในอีก 1 นาที", 202);
  const now = new Date();
  const link: MetaApiLink = {
    _id: res.data.id,
    kind: "metaapi",
    login: input.login,
    server: input.server,
    name: input.name,
    state: res.data.state,
    status: "deploying",
    createdAt: now,
    updatedAt: now,
  };
  const c = await cols();
  await c.links.replaceOne({ _id: link._id }, link, { upsert: true });
  if (res.data.state !== "DEPLOYED") await call(input.token, `${PROVISIONING}/users/current/accounts/${link._id}/deploy`, { method: "POST" });
  return link;
}

/** Remove the account from MetaApi too, so it no longer holds the password. */
export async function removeLink(id: string) {
  const c = await cols();
  const t = (await getSettings()).metaapiToken;
  if (t) {
    try {
      await call(t, `${PROVISIONING}/users/current/accounts/${id}`, {
        method: "DELETE",
      });
    } catch (err) {
      if (!(err instanceof MetaApiError && err.status === 404)) throw err;
    }
  }
  await c.links.deleteOne({ _id: id });
}

interface MaAccount {
  region?: string;
  state?: string;
  connectionStatus?: string;
}
interface MaInfo {
  balance: number;
  equity: number;
  margin?: number;
  freeMargin?: number;
  currency?: string;
  leverage?: number;
  name?: string;
  broker?: string;
  type?: string;
  marginMode?: string;
}
interface MaDeal {
  id: string;
  type: string;
  entryType?: string;
  symbol?: string;
  magic?: number;
  time: string;
  brokerTime: string;
  volume?: number;
  price?: number;
  commission?: number;
  swap?: number;
  profit: number;
  positionId?: string;
  orderId?: string;
  comment?: string;
  reason?: string;
  stopLoss?: number;
  takeProfit?: number;
}
interface MaPosition {
  id: string;
  type: string;
  symbol: string;
  time: string;
  brokerTime: string;
  openPrice: number;
  currentPrice: number;
  volume: number;
  swap?: number;
  profit?: number;
  unrealizedProfit?: number;
  stopLoss?: number;
  takeProfit?: number;
}
interface MaSpec {
  symbol: string;
  tickSize: number;
  contractSize?: number;
  digits: number;
  profitCurrency?: string;
  point?: number;
}
interface MaPrice {
  profitTickValue?: number;
}
interface MaCandle {
  brokerTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume?: number;
  spread?: number;
}

const TF: Record<Timeframe, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  H1: "1h",
  H4: "4h",
  D1: "1d",
};
const TF_SEC: Record<Timeframe, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  H1: 3600,
  H4: 14_400,
  D1: 86_400,
};

const state = globalThis as unknown as {
  __tgMa?: {
    lastDeals: Map<string, number>;
    lastHello: Map<string, number>;
    specs: Set<string>;
    running: boolean;
  };
};
const mem = (state.__tgMa ??= {
  lastDeals: new Map(),
  lastHello: new Map(),
  specs: new Set(),
  running: false,
});

/** One sync pass for a link: status → hello → deals (every minute) → positions/equity → candle tasks. */
export async function syncLink(link: MetaApiLink, opts: { forceDeals?: boolean } = {}) {
  const t = await token();
  const c = await cols();
  const set = async (patch: Partial<MetaApiLink>) => {
    Object.assign(link, patch);
    await c.links.updateOne({ _id: link._id }, { $set: { ...patch, updatedAt: new Date() } });
  };
  try {
    const acc = (await call<MaAccount>(t, `${PROVISIONING}/users/current/accounts/${link._id}`)).data;
    await set({
      region: acc.region,
      state: acc.state,
      connectionStatus: acc.connectionStatus,
    });
    if (acc.state !== "DEPLOYED" && acc.state !== "DEPLOYING") {
      await call(t, `${PROVISIONING}/users/current/accounts/${link._id}/deploy`, { method: "POST" });
      return set({ status: "deploying", lastError: undefined });
    }
    if (acc.state === "DEPLOYING" || !acc.region) return set({ status: "deploying", lastError: undefined });
    if (acc.connectionStatus !== "CONNECTED") {
      const lastError = acc.connectionStatus === "DISCONNECTED_FROM_BROKER" ? "MetaApi can't log in to the broker. Check the account number, server name and investor password." : undefined;
      if (link.accountId) markLost({ _id: link.accountId, name: link.name, login: link.login, eaVersion: "metaapi" }, lastError ?? "MetaApi lost the broker connection");
      return set({ status: lastError ? "error" : "connecting", lastError });
    }

    const base = `${clientHost(acc.region)}/users/current/accounts/${link._id}`;
    const account = { login: link.login, server: link.server };
    const now = Date.now();

    const [info, clock] = await Promise.all([
      call<MaInfo>(t, `${base}/account-information`).then((r) => r.data),
      call<{ time: string; brokerTime: string }>(t, `${base}/server-time`)
        .then((r) => r.data)
        .catch(() => null),
    ]);
    const gmt = Math.floor(now / 1000);
    const offsetSec = clock ? brokerSec(clock.brokerTime) - Math.floor(Date.parse(clock.time) / 1000) : 0;

    let since = -1;
    if (!link.accountId || now - (mem.lastHello.get(link._id) ?? 0) > 10 * 60_000) {
      const hello = await handleHello({
        ...account,
        v: 1,
        ea: "metaapi",
        company: info.broker ?? "",
        name: info.name ?? link.name,
        currency: info.currency ?? "USD",
        leverage: info.leverage ?? 0,
        marginMode: info.marginMode ?? "ACCOUNT_MARGIN_MODE_RETAIL_HEDGING",
        tradeMode: info.type ?? "ACCOUNT_TRADE_MODE_DEMO",
        balance: info.balance,
        equity: info.equity,
        serverTime: gmt + offsetSec,
        gmtTime: gmt,
      });
      mem.lastHello.set(link._id, now);
      since = hello.since;
      if (!link.accountId) await set({ accountId: hello.accountId });
    }

    if (opts.forceDeals || since >= 0 || now - (mem.lastDeals.get(link._id) ?? 0) > 60_000) {
      await syncDeals(t, base, link, since);
      mem.lastDeals.set(link._id, now);
    }

    const positions = (await call<MaPosition[]>(t, `${base}/positions`)).data ?? [];
    const floating = positions.reduce((s, p) => s + (p.unrealizedProfit ?? p.profit ?? 0), 0);
    await handleHeartbeat({
      ...account,
      serverTime: gmt + offsetSec,
      balance: info.balance,
      equity: info.equity,
      margin: info.margin ?? 0,
      freeMargin: info.freeMargin ?? 0,
      profit: floating,
      positions: positions.map((p) => ({
        ticket: Number(p.id),
        identifier: Number(p.id),
        symbol: p.symbol,
        type: p.type,
        volume: p.volume,
        priceOpen: p.openPrice,
        priceCurrent: p.currentPrice,
        sl: p.stopLoss ?? 0,
        tp: p.takeProfit ?? 0,
        profit: p.profit ?? 0,
        swap: p.swap ?? 0,
        time: brokerSec(p.brokerTime),
      })),
    });
    // The EA reports SL/TP moves as they happen; here they are seen on each poll (deduplicated by ingest).
    for (const p of positions)
      await handlePositionUpdate({
        ...account,
        position: Number(p.id),
        symbol: p.symbol,
        sl: p.stopLoss ?? 0,
        tp: p.takeProfit ?? 0,
        time: gmt + offsetSec,
      });

    await answerTasks(t, acc.region, link);
    await set({ status: "live", lastError: undefined, lastSyncAt: new Date() });
  } catch (err) {
    await set({ status: "error", lastError: (err as Error).message });
  }
}

async function syncDeals(t: string, base: string, link: MetaApiLink, since: number) {
  const c = await cols();
  const accountId = accountIdFor(link.login, link.server);
  // `since` is on the broker clock (from hello); otherwise resume two days before the newest deal.
  let from: Date;
  if (since >= 0) from = new Date((since > 0 ? since : Date.UTC(2010, 0, 1) / 1000) * 1000 - 86_400_000);
  else {
    const last = await c.deals.find({ accountId }).sort({ time: -1 }).limit(1).next();
    from = new Date((last?.time.getTime() ?? Date.UTC(2010, 0, 1)) - 2 * 86_400_000);
  }
  const to = new Date(Date.now() + 86_400_000);
  for (let offset = 0; ; offset += 1000) {
    const page = (await call<MaDeal[]>(t, `${base}/history-deals/time/${from.toISOString()}/${to.toISOString()}?offset=${offset}&limit=1000`)).data ?? [];
    if (!page.length) break;
    const symbols = await specsFor(t, base, link, [...new Set(page.map((d) => d.symbol).filter((s): s is string => !!s))]);
    await handleDeals({
      login: link.login,
      server: link.server,
      symbols,
      deals: page.map((d) => ({
        ticket: Number(d.id),
        order: Number(d.orderId ?? 0),
        position: Number(d.positionId ?? 0),
        time: brokerSec(d.brokerTime),
        timeMsc: brokerSec(d.brokerTime) * 1000 + brokerMs(d.brokerTime),
        type: d.type,
        entry: d.entryType ?? "DEAL_ENTRY_IN",
        reason: d.reason ?? "",
        symbol: d.symbol ?? "",
        volume: d.volume ?? 0,
        price: d.price ?? 0,
        profit: d.profit ?? 0,
        swap: d.swap ?? 0,
        commission: d.commission ?? 0,
        fee: 0,
        sl: d.stopLoss ?? 0,
        tp: d.takeProfit ?? 0,
        magic: d.magic ?? 0,
        comment: d.comment ?? "",
      })),
    });
    if (page.length < 1000) break;
  }
}

/** Symbol specs (once per symbol per process); tick value comes from the live price. */
async function specsFor(t: string, base: string, link: MetaApiLink, symbols: string[]) {
  const out = [];
  for (const s of symbols) {
    const key = `${link._id}:${s}`;
    if (mem.specs.has(key)) continue;
    try {
      const spec = (await call<MaSpec>(t, `${base}/symbols/${encodeURIComponent(s)}/specification`)).data;
      const price = await call<MaPrice>(t, `${base}/symbols/${encodeURIComponent(s)}/current-price`)
        .then((r) => r.data)
        .catch(() => null);
      const tickValue = price?.profitTickValue ?? spec.tickSize * (spec.contractSize ?? 0);
      out.push({
        name: s,
        digits: spec.digits,
        point: spec.point ?? 10 ** -spec.digits,
        tickSize: spec.tickSize,
        tickValue,
        contractSize: spec.contractSize ?? 0,
        currencyProfit: spec.profitCurrency ?? "",
      });
      mem.specs.add(key);
    } catch {
      // Without a spec the trade still syncs; R falls back to the stop distance.
    }
  }
  return out;
}

/** Answer the app's candle requests from MetaApi's market data. The MT5 calendar is not available here. */
async function answerTasks(t: string, region: string, link: MetaApiLink) {
  if (!link.accountId) return;
  const c = await cols();
  const tasks = await c.eaTasks
    .find({ accountId: link.accountId, status: { $ne: "done" } })
    .sort({ createdAt: 1 })
    .limit(4)
    .toArray();
  for (const task of tasks) {
    if (task.kind !== "CANDLES" || !task.tf || !task.rawSymbol) {
      await completeTask(String(task._id));
      continue;
    }
    const limit = Math.min(1000, Math.ceil((task.to.getTime() - task.from.getTime()) / 1000 / TF_SEC[task.tf]) + 2);
    try {
      const url = `${marketHost(region)}/users/current/accounts/${link._id}/historical-market-data/symbols/${encodeURIComponent(task.rawSymbol)}/timeframes/${TF[task.tf]}/candles?startTime=${task.to.toISOString()}&limit=${limit}`;
      const candles = (await call<MaCandle[]>(t, url)).data ?? [];
      const bars = candles.map((k) => [brokerSec(k.brokerTime), k.open, k.high, k.low, k.close, k.tickVolume ?? 0, k.spread ?? 0] as [number, number, number, number, number, number, number]).sort((a, b) => a[0] - b[0]);
      await handleCandles({
        login: link.login,
        server: link.server,
        task: String(task._id),
        symbol: task.rawSymbol,
        tf: task.tf,
        bars,
      });
    } catch {
      // Market data may not be included in the MetaApi plan; don't retry forever.
      await completeTask(String(task._id));
    }
  }
}

/** Poll every linked account. Started once from boot. */
export function startMetaApiSync() {
  if (mem.running) return;
  mem.running = true;
  const tick = async () => {
    try {
      const c = await cols();
      const settings = await getSettings();
      if (settings.metaapiToken) for (const link of await c.links.find({ kind: "metaapi" }).toArray()) await syncLink(link);
    } catch (err) {
      console.warn(`[trade-gang] MetaApi sync: ${(err as Error).message}`);
    }
    setTimeout(() => void tick(), 20_000).unref?.();
  };
  void tick();
}
