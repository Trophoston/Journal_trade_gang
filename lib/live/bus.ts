import { EventEmitter } from "node:events";

export type LiveEvent =
  | { type: "heartbeat"; accountId: string; balance: number; equity: number; floating: number; margin: number; positions: number; at: number }
  | { type: "ea.status"; accountId: string; connected: boolean; at: number; name?: string; login?: number; via?: "ea" | "metaapi"; reason?: string }
  | { type: "trade.opened"; accountId: string; tradeId: string; symbol: string; side: string }
  | { type: "trade.closed"; accountId: string; tradeId: string; symbol: string; side: string; net: number; r?: number; currency: string }
  | { type: "trades.changed"; accountId: string; count: number }
  | { type: "ai.progress"; jobId: string; scopeKey: string; kind: string; step: number; steps: string[] }
  | { type: "ai.done"; jobId: string; scopeKey: string; kind: string; reportId: string; title: string }
  | { type: "ai.failed"; jobId: string; scopeKey: string; kind: string; error: string };

const g = globalThis as unknown as { __tgBus?: EventEmitter };
const bus = (g.__tgBus ??= Object.assign(new EventEmitter(), {}).setMaxListeners(100));

export function publish(e: LiveEvent) {
  bus.emit("event", e);
}

export function subscribe(fn: (e: LiveEvent) => void) {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}
