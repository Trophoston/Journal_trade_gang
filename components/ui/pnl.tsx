import { fmtMoney, fmtR } from "@/lib/format";
import { cn } from "@/lib/ui/cn";

/** P&L never relies on color alone: sign + arrow + color. */
export function Pnl({ value, currency = "USD", className, compact, arrow = true }: { value: number | null | undefined; currency?: string; className?: string; compact?: boolean; arrow?: boolean }) {
  if (value === null || value === undefined) return <span className={cn("num text-fg-3", className)}>–</span>;
  const tone = value > 0.004 ? "text-green-ink" : value < -0.004 ? "text-red-ink" : "text-metal-ink";
  return (
    <span className={cn("num inline-flex items-baseline gap-1 whitespace-nowrap", tone, className)}>
      {arrow && value !== 0 && <span aria-hidden className="text-[0.7em]">{value > 0 ? "▲" : "▼"}</span>}
      {fmtMoney(value, currency, { sign: true, compact })}
    </span>
  );
}

export function RVal({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={cn("num text-fg-3", className)}>–</span>;
  const tone = value >= 0.05 ? "text-green-ink" : value <= -0.05 ? "text-red-ink" : "text-metal-ink";
  return <span className={cn("num whitespace-nowrap", tone, className)}>{fmtR(value)}</span>;
}

export function toneOf(value: number) {
  return value > 0.004 ? "green" : value < -0.004 ? "red" : "metal";
}
