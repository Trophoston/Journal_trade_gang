"use client";

import { CircleAlert, CircleCheck, Info, Radio, Sparkles, TriangleAlert, X } from "lucide-react";
import { toast as sonner } from "sonner";
import { cn } from "@/lib/ui/cn";

export type Tone = "info" | "success" | "error" | "warning" | "ai" | "live";

const TONE: Record<Tone, { tile: string; bar: string; Icon: typeof Info }> = {
  info: { tile: "bg-blue-soft text-blue-ink", bar: "bg-blue", Icon: Info },
  success: { tile: "bg-green-soft text-green-ink", bar: "bg-green", Icon: CircleCheck },
  error: { tile: "bg-red-soft text-red-ink", bar: "bg-red", Icon: CircleAlert },
  warning: { tile: "bg-[color-mix(in_oklab,var(--amber)_18%,transparent)] text-fg", bar: "bg-amber", Icon: TriangleAlert },
  ai: { tile: "bg-violet-soft text-violet-ink", bar: "bg-violet", Icon: Sparkles },
  live: { tile: "bg-green-soft text-green-ink", bar: "bg-green", Icon: Radio },
};

/** How long each tone stays. Errors stay longer so there's time to read them. */
const DURATION: Record<Tone, number> = { info: 5000, success: 4000, error: 9000, warning: 7000, ai: 8000, live: 5000 };

export interface AlertOptions {
  description?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  duration?: number;
  id?: string | number;
  /** Replaces the tone icon. */
  icon?: React.ReactNode;
  /** Sits at the end of the title row, e.g. a P&L figure. */
  aside?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * One alert card for every notification: a tone tile (never color alone, each tone has its own icon),
 * title, detail, an optional action, a close button and a bar showing time left. The bar pauses
 * with the toast timer while the pointer is over the stack.
 */
export function Alert({ id, tone, title, description, action, duration, icon, aside, children }: AlertOptions & { id: string | number; tone: Tone; title: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("glass-chrome w-[356px] max-w-full overflow-hidden rounded-[18px] text-fg", tone === "ai" && "ai-wash")}>
      <div className="relative z-[2] flex items-start gap-3 py-3.5 pr-2.5 pl-3.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-[10px] [&_svg]:size-4", t.tile)}>{icon ?? <t.Icon />}</span>
        <div className="min-w-0 flex-1 pt-[5px]">
          <div className="flex items-baseline justify-between gap-2">
            <div className="min-w-0 text-[14px] leading-snug font-medium">{title}</div>
            {aside}
          </div>
          {description && <div className="mt-1 line-clamp-3 text-[12.5px] leading-relaxed text-fg-2">{description}</div>}
          {children}
          {action && (
            <button
              className={cn("mt-2.5 rounded-[10px] px-3 py-1.5 text-[12.5px] font-medium transition-[filter,transform] hover:brightness-110 active:scale-[0.97]", tone === "ai" ? "bg-violet text-white" : "bg-blue text-white")}
              onClick={() => {
                action.onClick();
                sonner.dismiss(id);
              }}
            >
              {action.label}
            </button>
          )}
        </div>
        <button aria-label="ปิด" className="rounded-full p-1.5 text-fg-3 transition-colors hover:bg-surface-3 hover:text-fg" onClick={() => sonner.dismiss(id)}>
          <X className="size-3.5" />
        </button>
      </div>
      {duration !== undefined && Number.isFinite(duration) && (
        <div aria-hidden className="absolute inset-x-0 bottom-0 z-[2] h-[2px] bg-line">
          <div className={cn("toast-time h-full opacity-70", t.bar)} style={{ "--toast-d": `${duration}ms` } as React.CSSProperties} />
        </div>
      )}
    </div>
  );
}

function show(tone: Tone, title: React.ReactNode, o: AlertOptions = {}) {
  const duration = o.duration ?? DURATION[tone];
  return sonner.custom((id) => <Alert {...o} id={id} tone={tone} title={title} duration={duration} />, { id: o.id, duration });
}

/** Drop-in for sonner's `toast`, rendering every notification as an `Alert`. */
export const toast = Object.assign((title: React.ReactNode, o?: AlertOptions) => show("info", title, o), {
  show,
  success: (title: React.ReactNode, o?: AlertOptions) => show("success", title, o),
  error: (title: React.ReactNode, o?: AlertOptions) => show("error", title, o),
  warning: (title: React.ReactNode, o?: AlertOptions) => show("warning", title, o),
  ai: (title: React.ReactNode, o?: AlertOptions) => show("ai", title, o),
  dismiss: sonner.dismiss,
});
