import { euDst, nyDst } from "../time/zone";

/**
 * MT5 reports every time in the broker's server clock.
 * - "ny": GMT+2 in winter / GMT+3 in summer, switching with US DST (most FX brokers)
 * - "eu": GMT+2 / GMT+3 switching with EU DST
 * - "fixed": a constant offset (Exness runs on GMT+0)
 * - "auto": decide from the offset the EA observed at connect time
 */
export type ServerTimeMode = "auto" | "ny" | "eu" | "fixed";

export interface ServerTimeConfig {
  mode: ServerTimeMode;
  /** Offset observed by the EA (server − GMT), minutes. */
  observedOffsetMin: number;
  /** Used when mode is "fixed". Defaults to observedOffsetMin. */
  fixedOffsetMin?: number;
}

const H = 3_600_000;

export function resolveMode(cfg: ServerTimeConfig): Exclude<ServerTimeMode, "auto"> {
  if (cfg.mode !== "auto") return cfg.mode;
  return cfg.observedOffsetMin === 120 || cfg.observedOffsetMin === 180 ? "ny" : "fixed";
}

/** Round an observed server−GMT difference to the nearest 15 minutes. */
export function observedOffset(serverSec: number, gmtSec: number): number {
  return Math.round((serverSec - gmtSec) / 900) * 15;
}

/** Convert an MT5 server timestamp (seconds) to a UTC Date. */
export function serverToUtc(serverSec: number, cfg: ServerTimeConfig): Date {
  const s = serverSec * 1000;
  const mode = resolveMode(cfg);
  if (mode === "fixed") return new Date(s - (cfg.fixedOffsetMin ?? cfg.observedOffsetMin) * 60_000);
  const dst = mode === "ny" ? nyDst : euDst;
  const summer = s - 3 * H;
  return new Date(dst(summer) ? summer : s - 2 * H);
}

/** Convert a UTC instant to MT5 server seconds (used for EA task ranges). */
export function utcToServer(date: Date | number, cfg: ServerTimeConfig): number {
  const ms = typeof date === "number" ? date : date.getTime();
  const mode = resolveMode(cfg);
  if (mode === "fixed") return Math.round((ms + (cfg.fixedOffsetMin ?? cfg.observedOffsetMin) * 60_000) / 1000);
  const dst = mode === "ny" ? nyDst : euDst;
  return Math.round((ms + (dst(ms) ? 3 : 2) * H) / 1000);
}
