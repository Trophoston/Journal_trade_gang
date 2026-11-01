"use client";

import { useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** Debounced autosave: call `queue(patch)` on every edit; patches merge until saved. */
export function useAutosave<P extends object>(save: (patch: P) => Promise<unknown>, delay = 700) {
  const [state, setState] = useState<SaveState>("idle");
  const pending = useRef<Partial<P>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const flush = async () => {
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    setState("saving");
    try {
      await saveRef.current(patch as P);
      setState("saved");
    } catch {
      setState("error");
    }
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  const queue = (patch: Partial<P>) => {
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };
  return { state, queue, flush };
}
