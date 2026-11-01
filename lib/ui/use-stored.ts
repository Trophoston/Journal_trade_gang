"use client";

import { useCallback, useSyncExternalStore } from "react";

const subs = new Map<string, Set<() => void>>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * A per-browser preference (remembered tab, metric…). Server and hydration use the
 * fallback, so markup always matches; the saved value applies right after.
 */
export function useStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (v: T) => void] {
  const subscribe = useCallback(
    (cb: () => void) => {
      const set = subs.get(key) ?? new Set();
      set.add(cb);
      subs.set(key, set);
      return () => set.delete(cb);
    },
    [key],
  );
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
  const value = raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback(
    (v: T) => {
      try {
        localStorage.setItem(key, v);
      } catch {
        // storage unavailable: keep the default
      }
      subs.get(key)?.forEach((cb) => cb());
    },
    [key],
  );
  return [value, set];
}
