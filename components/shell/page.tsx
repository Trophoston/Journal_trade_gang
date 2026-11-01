import { ViewTransition } from "react";
import { cn } from "@/lib/ui/cn";

/** Page frame: title row + content, with the page enter/exit transition. */
export function Page({ title, subtitle, actions, children, className }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <ViewTransition enter="page" exit="page" default="none">
      <div className={cn("flex flex-col gap-4", className)}>
        <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
          <div className="min-w-0">
            <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em]">{title}</h1>
            {subtitle && <div className="mt-0.5 text-[13px] text-fg-3">{subtitle}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </ViewTransition>
  );
}

export { Reveal } from "./reveal";
