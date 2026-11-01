"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

/** Animates a number between values without re-rendering React on each frame. */
export function Ticker({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prev.current;
    prev.current = value;
    if (reduce || from === value || document.documentElement.dataset.motion === "off") {
      el.textContent = format(value);
      return;
    }
    const controls = animate(from, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => (el.textContent = format(v)) });
    return () => controls.stop();
  }, [value, format, reduce]);
  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
