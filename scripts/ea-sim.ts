/**
 * Plays the MT5 EA against a running app (pnpm dev): hello → history backfill →
 * a live trade opening and closing → heartbeats that pick up and answer candle /
 * calendar tasks. Uses its own "Exness-MT5Trial" account.
 *
 *   pnpm ea:sim            run the session
 *   pnpm ea:sim --reset    delete the simulated account first
 *   pnpm ea:sim --clean    delete everything the simulator wrote, then exit
 */
import { mongo } from "../lib/db/client";
import { cols } from "../lib/db/collections";
import { accountIdFor } from "../lib/mt5/ingest";
import { getSettings } from "../lib/settings";

const BASE = process.env.TG_URL ?? "http://127.0.0.1:3685";
const LOGIN = 277001234;
const SERVER = "Exness-MT5Trial9";
const OFFSET = 0; // Exness server time = GMT+0

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000) + OFFSET * 3600;

let token = "";
async function post(path: string, body: unknown): Promise<string[]> {
  const res = await fetch(`${BASE}/api/ea/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-tg-token": token }, body: JSON.stringify(body) });
  const lines = (await res.text()).trim().split("\n");
  if (!res.ok || lines[0].startsWith("ERR")) throw new Error(`${path}: ${res.status} ${lines.join(" | ")}`);
  return lines;
}

const account = { login: LOGIN, server: SERVER };
let ticket = 900_100;
const price = 3990.5;
let balance = 5000;

function deal(time: number, type: "BUY" | "SELL", entry: "IN" | "OUT", position: number, volume: number, p: number, profit: number, reason = "CLIENT", sl = 0, tp = 0) {
  return { ticket: ticket++, order: ticket + 50_000, position, time, timeMsc: time * 1000, type: `DEAL_TYPE_${type}`, entry: `DEAL_ENTRY_${entry}`, reason: `DEAL_REASON_${reason}`, symbol: "XAUUSDm", volume, price: p, profit, swap: 0, commission: -0.7 * volume * 10, fee: 0, sl, tp, magic: 0, comment: "" };
}

const symbols = [{ name: "XAUUSDm", digits: 3, point: 0.001, tickSize: 0.001, tickValue: 0.1, contractSize: 100, currencyProfit: "USD" }];

function bars(from: number, to: number, step: number) {
  const out: number[][] = [];
  let p = price - 15;
  for (let t = Math.floor(from / step) * step; t <= to; t += step) {
    const o = p;
    const c = o + (Math.random() - 0.5) * step * 0.02;
    out.push([t, +o.toFixed(3), +(Math.max(o, c) + Math.random() * 0.8).toFixed(3), +(Math.min(o, c) - Math.random() * 0.8).toFixed(3), +c.toFixed(3), 100, 12]);
    p = c;
  }
  return out;
}

async function answer(lines: string[]) {
  for (const line of lines.filter((l) => l.startsWith("T|"))) {
    const [, id, kind, ...rest] = line.split("|");
    if (kind === "CANDLES") {
      const [sym, tf, from, to] = rest;
      const step = { M1: 60, M5: 300, M15: 900, H1: 3600, H4: 14400, D1: 86400 }[tf as "M1"] ?? 300;
      const b = bars(Number(from), Number(to), step);
      const r = await post("candles", { ...account, task: id, symbol: sym, tf, bars: b });
      console.log(`  ↳ task ${kind} ${sym} ${tf}: sent ${b.length} bars → ${r[0]}`);
    } else if (kind === "CALENDAR") {
      const [from] = rest;
      const t = Number(from) + 36 * 3600;
      const events = [
        { id: SIM_EVENTS[0], eventId: 840_030_016, time: t, currency: "USD", country: "US", name: "Initial Jobless Claims", importance: "CALENDAR_IMPORTANCE_MODERATE", actual: 224, forecast: 221, previous: 218 },
        { id: SIM_EVENTS[1], eventId: 840_030_005, time: t + 7200, currency: "USD", country: "US", name: "ISM Manufacturing PMI", importance: "CALENDAR_IMPORTANCE_HIGH", actual: null, forecast: 49.6, previous: 49.1 },
      ];
      const r = await post("calendar", { ...account, task: id, events });
      console.log(`  ↳ task ${kind}: sent ${events.length} events → ${r[0]}`);
    } else {
      console.log(`  ↳ task ${kind}: nothing to send in the simulator`);
    }
  }
}

async function heartbeat(positions: unknown[] = [], floating = 0) {
  const lines = await post("heartbeat", { ...account, serverTime: nowSec(), balance, equity: balance + floating, margin: positions.length ? 80 : 0, freeMargin: balance, profit: floating, positions });
  await answer(lines);
  return lines;
}

const SIM_EVENTS = [7_700_001, 7_700_002];

/** Removes the simulated account and the candles / calendar rows it sent, so none of it mixes with a real MT5 account. */
async function removeSim() {
  const c = await cols();
  const id = accountIdFor(LOGIN, SERVER);
  const tasks = await c.eaTasks.find({ accountId: id, kind: "CANDLES" }).toArray();
  // The simulator rounds each window's first bar down, so widen by one bar.
  const stepMs = { M1: 60e3, M5: 300e3, M15: 900e3, H1: 3600e3, H4: 14400e3, D1: 86400e3 };
  for (const t of tasks) await c.candles.deleteMany({ symbol: t.symbol, tf: t.tf, t: { $gte: new Date(t.from!.getTime() - stepMs[t.tf as "M1"]), $lte: t.to } });
  await Promise.all([
    c.accounts.deleteOne({ _id: id }),
    c.deals.deleteMany({ accountId: id }),
    c.trades.deleteMany({ accountId: id }),
    c.cashflows.deleteMany({ accountId: id }),
    c.eaTasks.deleteMany({ accountId: id }),
    c.aiJobs.deleteMany({ accountId: id }),
    c.aiReports.deleteMany({ accountId: id }),
    c.aiThreads.deleteMany({ accountId: id }),
    c.days.deleteMany({ accountId: id }),
    c.equity.deleteMany({ "meta.accountId": id }),
    c.events.deleteMany({ _id: { $in: SIM_EVENTS.map((v) => `mt5:${v}`) } }),
    c.settings.updateOne({ _id: "app", activeAccountId: id }, { $unset: { activeAccountId: "" } }),
  ]);
}

async function main() {
  if (process.argv.includes("--clean")) {
    await removeSim();
    console.log("• removed the simulated account and its candles / calendar rows");
    return;
  }
  const settings = await getSettings();
  token = settings.eaToken;
  if (process.argv.includes("--reset")) {
    await removeSim();
    console.log("• reset simulated account");
  }

  console.log(`• hello → ${BASE}`);
  const hello = await post("hello", { ...account, v: 1, ea: "1.0.0-sim", company: "Exness Technologies Ltd", name: "EA Simulator", currency: "USD", leverage: 2000, marginMode: "ACCOUNT_MARGIN_MODE_RETAIL_HEDGING", tradeMode: "ACCOUNT_TRADE_MODE_DEMO", balance, equity: balance, serverTime: nowSec(), gmtTime: Math.floor(Date.now() / 1000) });
  console.log(`  ${hello.join(" ")}`);

  console.log("• backfill history");
  const day = 86_400;
  const t = nowSec() - 3 * day;
  const history = [
    { ticket: ticket++, order: 0, position: 0, time: t - day, timeMsc: (t - day) * 1000, type: "DEAL_TYPE_BALANCE", entry: "DEAL_ENTRY_IN", reason: "", symbol: "", volume: 0, price: 0, profit: 5000, swap: 0, commission: 0, fee: 0, sl: 0, tp: 0, magic: 0, comment: "Deposit" },
    deal(t, "BUY", "IN", 800_001, 0.5, 3978.2, 0, "CLIENT", 3972.2, 3990.2),
    deal(t + 2400, "SELL", "OUT", 800_001, 0.5, 3990.2, 600, "TP", 3972.2, 3990.2),
    deal(t + day, "SELL", "IN", 800_002, 0.4, 3995.0, 0, "CLIENT", 4002.5, 3980.0),
    deal(t + day + 1800, "BUY", "OUT", 800_002, 0.4, 4002.5, -300, "SL", 4002.5, 3980.0),
  ];
  balance += 300;
  console.log(`  ${(await post("deals", { ...account, deals: history, symbols })).join(" ")}`);

  console.log("• live trade opens");
  const pos = 800_003;
  const open = nowSec() - 120;
  await post("deals", { ...account, deals: [deal(open, "BUY", "IN", pos, 0.3, price, 0, "CLIENT", price - 5, price + 10)], symbols });
  const position = (p: number, profit: number, sl: number) => ({ ticket: pos, identifier: pos, symbol: "XAUUSDm", type: "POSITION_TYPE_BUY", volume: 0.3, priceOpen: price, priceCurrent: p, sl, tp: price + 10, profit, swap: 0, time: open });
  for (let i = 0; i < 5; i++) {
    const p = price + i * 0.9;
    await heartbeat([position(p, (p - price) * 30, price - 5)], (p - price) * 30);
    process.stdout.write(`  heartbeat ${i + 1}/5 floating ${((p - price) * 30).toFixed(2)}\n`);
    await sleep(2000);
  }
  console.log("• stop moved to break-even");
  await post("position", { ...account, position: pos, symbol: "XAUUSDm", sl: price, tp: price + 10, time: nowSec() });

  console.log("• live trade closes at TP");
  const profit = 10 * 0.3 * 100;
  balance += profit;
  await post("deals", { ...account, deals: [deal(nowSec(), "SELL", "OUT", pos, 0.3, price + 10, profit, "TP", price, price + 10)], symbols });

  console.log("• heartbeats (answering data tasks)");
  for (let i = 0; i < 6; i++) {
    await heartbeat();
    await sleep(2000);
  }
  console.log("✓ done. The trade analysis is queued (Settings → AI → delay) and the dashboard updated live.");
}

main()
  .catch((err) => {
    console.error(`✗ ${(err as Error).message}`);
    if (String(err).includes("fetch failed")) console.error("  Is the app running? Start it with: pnpm dev");
    process.exitCode = 1;
  })
  .finally(async () => {
    await (await mongo()).close();
  });
