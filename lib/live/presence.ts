import { cols } from "../db/collections";
import type { AccountDoc } from "../domain/types";
import { publish } from "./bus";

/**
 * Tracks which MT5 accounts are sending data and announces changes once (connected / disconnected).
 * The EA beats every 2 s; the MetaApi poller every 20 s, so it gets a longer grace period.
 */
const g = globalThis as unknown as { __tgPresence?: { online: Set<string>; running: boolean } };
const mem = (g.__tgPresence ??= { online: new Set(), running: false });

const graceMs = (a: Pick<AccountDoc, "eaVersion">) => (a.eaVersion === "metaapi" ? 75_000 : 20_000);
const via = (a: Pick<AccountDoc, "eaVersion">) => (a.eaVersion === "metaapi" ? "metaapi" : "ea") as "metaapi" | "ea";

/** Call whenever an account sends data. Publishes "connected" only on the transition. */
export function markSeen(a: Pick<AccountDoc, "_id" | "name" | "login" | "eaVersion">, at = Date.now()) {
  startPresenceWatch();
  if (mem.online.has(a._id)) return;
  mem.online.add(a._id);
  publish({ type: "ea.status", accountId: a._id, connected: true, at, name: a.name, login: a.login, via: via(a) });
}

/** Mark an account offline right away (e.g. MetaApi reports the broker login failed). */
export function markLost(a: Pick<AccountDoc, "_id" | "name" | "login" | "eaVersion">, reason?: string) {
  if (!mem.online.delete(a._id)) return;
  publish({ type: "ea.status", accountId: a._id, connected: false, at: Date.now(), name: a.name, login: a.login, via: via(a), reason });
}

export function startPresenceWatch() {
  if (mem.running) return;
  mem.running = true;
  const tick = async () => {
    try {
      if (mem.online.size) {
        const c = await cols();
        const accounts = await c.accounts.find({ _id: { $in: [...mem.online] } }, { projection: { name: 1, login: 1, eaVersion: 1, lastSeenAt: 1 } }).toArray();
        const now = Date.now();
        for (const a of accounts) if (!a.lastSeenAt || now - a.lastSeenAt.getTime() > graceMs(a)) markLost(a);
        // Accounts deleted while online
        const found = new Set(accounts.map((a) => a._id));
        for (const id of mem.online) if (!found.has(id)) mem.online.delete(id);
      }
    } catch {
      // MongoDB hiccup: try again next tick
    }
    setTimeout(() => void tick(), 5_000).unref?.();
  };
  void tick();
}
