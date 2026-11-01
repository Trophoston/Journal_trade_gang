"use client";

import { Tooltip as T } from "radix-ui";
import { cn } from "@/lib/ui/cn";

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <T.Provider delayDuration={250} skipDelayDuration={150}>
      {children}
    </T.Provider>
  );
}

export function Tip({ content, children, side = "top", className }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right"; className?: string }) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={8} collisionPadding={12} className={cn("glass-chrome z-[90] max-w-72 rounded-xl px-3 py-2 text-[12px] leading-relaxed text-fg-2 data-[state=delayed-open]:animate-[appear_160ms_ease]", className)}>
          <div className="relative z-[2]">{content}</div>
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
