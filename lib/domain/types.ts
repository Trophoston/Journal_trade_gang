import type { SessionId } from "../time/sessions";

export type Side = "long" | "short";
export type CloseReason = "sl" | "tp" | "manual" | "mobile" | "web" | "expert" | "so" | "other";
export type DealKind = "buy" | "sell" | "balance" | "credit" | "charge" | "correction" | "bonus" | "commission" | "interest" | "other";
export type DealEntry = "in" | "out" | "inout" | "out_by";
export type Timeframe = "M1" | "M5" | "M15" | "H1" | "H4" | "D1";
export type Importance = "none" | "low" | "medium" | "high";

export interface ServerTimeSettings {
  mode: "auto" | "ny" | "eu" | "fixed";
  observedOffsetMin: number;
  fixedOffsetMin?: number;
}

export interface AccountRules {
  riskPerTradePct?: number;
  maxTradesPerDay?: number;
  dailyLossLimitPct?: number;
  maxDrawdownPct?: number;
  newsBlackoutMin?: number;
  requireStopLoss?: boolean;
}

export interface OpenPosition {
  ticket: number;
  positionId: number;
  symbol: string;
  side: Side;
  volume: number;
  priceOpen: number;
  priceCurrent: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  openedAt: Date;
}

export interface AccountDoc {
  _id: string;
  login: number;
  server: string;
  company: string;
  name: string;
  currency: string;
  isCent: boolean;
  leverage: number;
  marginMode: "hedging" | "netting";
  tradeMode: "demo" | "real" | "contest";
  source: "mt5" | "demo";
  serverTime: ServerTimeSettings;
  rules: AccountRules;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  floating: number;
  positions: OpenPosition[];
  eaVersion?: string;
  firstConnectedAt?: Date;
  lastSeenAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DealDoc {
  accountId: string;
  ticket: number;
  order: number;
  positionId: number;
  time: Date;
  timeMsc: number;
  kind: DealKind;
  entry: DealEntry;
  reason: string;
  symbol: string;
  rawSymbol: string;
  volume: number;
  price: number;
  profit: number;
  commission: number;
  swap: number;
  fee: number;
  sl: number;
  tp: number;
  magic: number;
  comment: string;
}

export interface SymbolSpec {
  _id: string; // `${accountId}:${rawSymbol}`
  accountId: string;
  raw: string;
  symbol: string;
  digits: number;
  point: number;
  tickSize: number;
  tickValue: number;
  contractSize: number;
  currencyProfit: string;
  pipSize: number;
}

export interface Execution {
  ticket: number;
  time: Date;
  side: Side; // direction of the deal itself
  entry: DealEntry;
  volume: number;
  price: number;
  profit: number;
  commission: number;
  swap: number;
  fee: number;
  reason: string;
}

export interface SlChange {
  time: Date;
  sl: number;
  tp: number;
}

export type EvidenceKind =
  | "fvg"
  | "sweep"
  | "structure"
  | "stop_hunt"
  | "excursion"
  | "volatility"
  | "trend"
  | "news"
  | "level"
  | "sl_management";

export interface EvidenceItem {
  id: string; // E1, E2…
  kind: EvidenceKind;
  /** Relative to the trade's direction. */
  polarity: "supports" | "against" | "neutral";
  title: string;
  detail: string;
  tf?: Timeframe;
  t?: number; // unix ms (UTC)
  t2?: number;
  price?: number;
  price2?: number;
}

export interface TradeJournal {
  setup?: string;
  confluences: string[];
  emotions: string[];
  mistakes: string[];
  rating?: number; // 1–5 execution quality
  followedPlan?: boolean;
  notes?: string;
  screenshots: { id: string; caption?: string }[];
  reviewedAt?: Date;
}

export interface TradeDoc {
  _id: string; // `${accountId}_${positionId}` (+ `-n` for later segments)
  accountId: string;
  positionId: number;
  segment: number;
  symbol: string;
  rawSymbol: string;
  side: Side;
  status: "open" | "closed";
  volume: number;
  openedAt: Date;
  closedAt?: Date;
  tradingDay: string;
  entryPrice: number;
  exitPrice?: number;
  sl0?: number;
  tp0?: number;
  slFinal?: number;
  tpFinal?: number;
  slHistory: SlChange[];
  closeReason?: CloseReason;
  gross: number;
  commission: number;
  swap: number;
  fee: number;
  net: number;
  riskMoney?: number;
  r?: number;
  points?: number;
  pips?: number;
  durationSec?: number;
  session: SessionId;
  executions: Execution[];
  mae?: { price: number; r?: number };
  mfe?: { price: number; r?: number };
  evidence?: { computedAt: Date; items: EvidenceItem[]; coverage: string[]; v?: number };
  journal: TradeJournal;
  hidden?: boolean;
  source: "mt5" | "demo";
  createdAt: Date;
  updatedAt: Date;
}

export interface CashflowDoc {
  accountId: string;
  ticket: number;
  time: Date;
  kind: "deposit" | "withdrawal" | "credit" | "bonus" | "charge" | "interest" | "commission" | "correction";
  amount: number;
  comment: string;
}

export interface CandleDoc {
  symbol: string;
  tf: Timeframe;
  t: Date;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface EconEventDoc {
  _id: string;
  eventId: number;
  time: Date;
  currency: string;
  country: string;
  name: string;
  importance: Importance;
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  source: "mt5" | "demo";
}

export interface JournalDayDoc {
  _id: string; // `${accountId}:${day}`
  accountId: string;
  day: string;
  plan?: string;
  bias?: "bullish" | "bearish" | "neutral";
  reflection?: string;
  mood?: number; // 1–5
  updatedAt: Date;
}

export interface EquitySnapshot {
  t: Date;
  meta: { accountId: string };
  balance: number;
  equity: number;
}

/** Plain candle bar used by detectors and charts. */
export interface Bar {
  t: number; // unix ms UTC
  o: number;
  h: number;
  l: number;
  c: number;
}
