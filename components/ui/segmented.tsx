"use client";

import { motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/ui/cn";
import { spring } from "@/lib/ui/motion";

export interface SegOption<T extends string> {
  value: T;
  label: React.ReactNode;
  title?: string;
}

/** Segmented control with a sliding pill. */
export function Segmented<T extends string>({ value, options, onChange, size = "md", className, label }: { value: T; options: SegOption<T>[]; onChange: (v: T) => void; size?: "sm" | "md"; className?: string; label: string }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className={cn("relative inline-flex shrink-0 rounded-[12px] bg-surface-3/80 p-1 ring-1 ring-line ring-inset", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-0 inline-flex items-center justify-center gap-1.5 rounded-[9px] font-medium whitespace-nowrap transition-colors duration-150 [&_svg]:size-3.5",
              size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]",
              active ? "text-fg" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {active && <motion.span layoutId={`seg-${id}`} transition={spring.snappy} className="absolute inset-0 -z-10 rounded-[9px] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.08),0_2px_8px_-2px_rgb(0_0_0/0.12)] ring-1 ring-line" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
