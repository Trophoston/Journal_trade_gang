import { cn } from "@/lib/ui/cn";

/** Bento cell: glass card with metal rim and (at glass "Most") a pointer sheen. */
export function Card({ className, children, i, ai, as: Tag = "section", ...rest }: React.HTMLAttributes<HTMLElement> & { i?: number; ai?: boolean; as?: "section" | "div" | "article" }) {
  return (
    <Tag className={cn("glass-card sheen bento-in min-w-0 p-5", ai && "ai-wash", className)} style={i !== undefined ? ({ "--i": i } as React.CSSProperties) : undefined} {...rest}>
      <div className="relative z-[2] flex h-full min-w-0 flex-col">{children}</div>
    </Tag>
  );
}

/** Label → value → detail, the same in every card. */
export function CardHead({ label, icon, action, className }: { label: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("mb-3 flex min-h-7 items-center justify-between gap-3", className)}>
      <h2 className="flex items-center gap-2 text-[13px] font-medium tracking-tight text-fg-2">
        {icon}
        {label}
      </h2>
      {action}
    </header>
  );
}

export function Stat({ label, value, detail, className }: { label: React.ReactNode; value: React.ReactNode; detail?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[12px] text-fg-3">{label}</div>
      <div className="num mt-0.5 truncate text-[17px] font-semibold tracking-tight">{value}</div>
      {detail && <div className="mt-0.5 truncate text-[12px] text-fg-3">{detail}</div>}
    </div>
  );
}

export function Inset({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-[var(--radius-inner)] bg-surface-2/70 p-3 ring-1 ring-line ring-inset", className)}>{children}</div>;
}
