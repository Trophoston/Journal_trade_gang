import type { Transition } from "motion/react";

/** One set of springs for the whole app. Only transform and opacity are animated. */
export const spring = {
  snappy: { type: "spring", stiffness: 560, damping: 40, mass: 0.7 } satisfies Transition,
  smooth: { type: "spring", stiffness: 320, damping: 34, mass: 0.9 } satisfies Transition,
  gentle: { type: "spring", stiffness: 170, damping: 26, mass: 1 } satisfies Transition,
};
