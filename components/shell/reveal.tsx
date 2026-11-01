"use client";

import { useSyncExternalStore, ViewTransition } from "react";

const noop = () => () => {};

/**
 * Suspense reveal: content slides up as the skeleton leaves. Only after hydration;
 * a reveal streamed during the first load would start a view transition before
 * the first paint, which the browser rejects.
 */
export function Reveal({ children }: { children: React.ReactNode }) {
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return (
    <ViewTransition enter={hydrated ? "reveal" : "none"} default="none">
      {children}
    </ViewTransition>
  );
}
