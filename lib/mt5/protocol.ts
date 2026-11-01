import { z } from "zod";

/** Payloads posted by mt5/TradeGangSync.mq5. All times are MT5 server seconds. */

const account = { login: z.coerce.number().int(), server: z.string().min(1) };

export const helloSchema = z.object({
  ...account,
  v: z.number().int().default(1),
  ea: z.string().default("?"),
  company: z.string().default(""),
  name: z.string().default(""),
  currency: z.string().default("USD"),
  leverage: z.coerce.number().default(0),
  marginMode: z.string().default("RETAIL_HEDGING"),
  tradeMode: z.string().default("ACCOUNT_TRADE_MODE_DEMO"),
  balance: z.coerce.number(),
  equity: z.coerce.number(),
  serverTime: z.coerce.number(),
  gmtTime: z.coerce.number(),
});

export const dealSchema = z.object({
  ticket: z.coerce.number(),
  order: z.coerce.number().default(0),
  position: z.coerce.number().default(0),
  time: z.coerce.number(),
  timeMsc: z.coerce.number().default(0),
  type: z.string(),
  entry: z.string(),
  reason: z.string().default(""),
  symbol: z.string().default(""),
  volume: z.coerce.number().default(0),
  price: z.coerce.number().default(0),
  profit: z.coerce.number().default(0),
  swap: z.coerce.number().default(0),
  commission: z.coerce.number().default(0),
  fee: z.coerce.number().default(0),
  sl: z.coerce.number().default(0),
  tp: z.coerce.number().default(0),
  magic: z.coerce.number().default(0),
  comment: z.string().default(""),
});

export const symbolSpecSchema = z.object({
  name: z.string(),
  digits: z.coerce.number().int(),
  point: z.coerce.number(),
  tickSize: z.coerce.number(),
  tickValue: z.coerce.number(),
  contractSize: z.coerce.number().default(0),
  currencyProfit: z.string().default(""),
});

export const dealsSchema = z.object({
  ...account,
  deals: z.array(dealSchema).max(1000),
  symbols: z.array(symbolSpecSchema).default([]),
});

export const positionSchema = z.object({
  ticket: z.coerce.number(),
  identifier: z.coerce.number(),
  symbol: z.string(),
  type: z.string(),
  volume: z.coerce.number(),
  priceOpen: z.coerce.number(),
  priceCurrent: z.coerce.number(),
  sl: z.coerce.number().default(0),
  tp: z.coerce.number().default(0),
  profit: z.coerce.number().default(0),
  swap: z.coerce.number().default(0),
  time: z.coerce.number(),
});

export const heartbeatSchema = z.object({
  ...account,
  serverTime: z.coerce.number(),
  balance: z.coerce.number(),
  equity: z.coerce.number(),
  margin: z.coerce.number().default(0),
  freeMargin: z.coerce.number().default(0),
  profit: z.coerce.number().default(0),
  positions: z.array(positionSchema).default([]),
});

export const positionUpdateSchema = z.object({
  ...account,
  position: z.coerce.number(),
  symbol: z.string().default(""),
  sl: z.coerce.number().default(0),
  tp: z.coerce.number().default(0),
  time: z.coerce.number(),
});

export const candlesSchema = z.object({
  ...account,
  task: z.string(),
  symbol: z.string(),
  tf: z.enum(["M1", "M5", "M15", "H1", "H4", "D1"]),
  bars: z.array(z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]).rest(z.number())).max(20000),
});

export const calendarSchema = z.object({
  ...account,
  task: z.string(),
  events: z
    .array(
      z.object({
        id: z.coerce.number(),
        eventId: z.coerce.number(),
        time: z.coerce.number(),
        currency: z.string(),
        country: z.string().default(""),
        name: z.string(),
        importance: z.string(),
        actual: z.number().nullable().default(null),
        forecast: z.number().nullable().default(null),
        previous: z.number().nullable().default(null),
      }),
    )
    .max(5000),
});

export type HelloPayload = z.infer<typeof helloSchema>;
export type DealPayload = z.infer<typeof dealSchema>;
export type HeartbeatPayload = z.infer<typeof heartbeatSchema>;

const DEAL_KIND: Record<string, import("../domain/types").DealKind> = {
  DEAL_TYPE_BUY: "buy",
  DEAL_TYPE_SELL: "sell",
  DEAL_TYPE_BALANCE: "balance",
  DEAL_TYPE_CREDIT: "credit",
  DEAL_TYPE_CHARGE: "charge",
  DEAL_TYPE_CORRECTION: "correction",
  DEAL_TYPE_BONUS: "bonus",
  DEAL_TYPE_COMMISSION: "commission",
  DEAL_TYPE_COMMISSION_DAILY: "commission",
  DEAL_TYPE_COMMISSION_MONTHLY: "commission",
  DEAL_TYPE_COMMISSION_AGENT_DAILY: "commission",
  DEAL_TYPE_COMMISSION_AGENT_MONTHLY: "commission",
  DEAL_TYPE_INTEREST: "interest",
};

export function dealKind(type: string) {
  return DEAL_KIND[type] ?? "other";
}

export function dealEntry(entry: string): import("../domain/types").DealEntry {
  switch (entry) {
    case "DEAL_ENTRY_IN":
      return "in";
    case "DEAL_ENTRY_INOUT":
      return "inout";
    case "DEAL_ENTRY_OUT_BY":
      return "out_by";
    default:
      return "out";
  }
}

export function importanceOf(s: string): import("../domain/types").Importance {
  if (s.endsWith("HIGH")) return "high";
  if (s.endsWith("MODERATE") || s.endsWith("MEDIUM")) return "medium";
  if (s.endsWith("LOW")) return "low";
  return "none";
}
