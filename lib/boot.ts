import { startRunner } from "./ai/queue";
import { startScheduler } from "./ai/scheduler";
import { startMetaApiSync } from "./connectors/metaapi";
import { startPresenceWatch } from "./live/presence";
import { ensureIndexes } from "./db/collections";
import { getSettings } from "./settings";

const g = globalThis as unknown as { __tgBoot?: boolean };

/** Server start: indexes, settings, the AI queue worker and scheduler. Retries while MongoDB is down. */
export function boot() {
  if (g.__tgBoot) return;
  g.__tgBoot = true;
  const attempt = async (n: number): Promise<void> => {
    try {
      await ensureIndexes();
      await getSettings();
      await startRunner();
      startScheduler();
      startMetaApiSync();
      startPresenceWatch();
      console.log("[trade-gang] ready: indexes, AI queue and scheduler started");
    } catch (err) {
      const wait = Math.min(30, 2 ** n);
      console.warn(`[trade-gang] MongoDB not reachable (${(err as Error).message}). Is it running? Try: pnpm db:up. Retrying in ${wait}s.`);
      setTimeout(() => void attempt(n + 1), wait * 1000).unref?.();
    }
  };
  void attempt(0);
}
