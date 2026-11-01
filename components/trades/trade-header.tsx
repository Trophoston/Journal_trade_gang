import { Badge } from "@/components/ui/chip";
import { Pnl, RVal } from "@/components/ui/pnl";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { cn } from "@/lib/ui/cn";

const OUTCOME = { win: { label: "ชนะ", tone: "green" }, loss: { label: "แพ้", tone: "red" }, be: { label: "เสมอ", tone: "metal" } } as const;

/** Title block of a trade. Also rendered from the row preview while the detail streams, so the two match. */
export function TradeHeader({
  symbol,
  side,
  outcome,
  net,
  r,
  currency,
  openedAt,
  closedAt,
  tz,
  session,
  actions,
}: {
  symbol: string;
  side: "long" | "short";
  outcome: "win" | "loss" | "be";
  net: number;
  r: number | null;
  currency: string;
  openedAt: number;
  closedAt: number;
  tz: string;
  session: string;
  actions?: React.ReactNode;
}) {
  const o = OUTCOME[outcome];
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-[14px] text-[13px] font-bold", side === "long" ? "bg-green-soft text-green-ink" : "bg-red-soft text-red-ink")}>{side === "long" ? "BUY" : "SELL"}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.02em]">{symbol}</h2>
            <Badge tone={o.tone}>{o.label}</Badge>
            <Badge>{session}</Badge>
          </div>
          <div className="num mt-0.5 text-[12px] text-fg-3">
            {fmtDateTime(openedAt, tz)} → {fmtTime(closedAt, tz)}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <Pnl value={net} currency={currency} className="text-[22px] font-semibold tracking-tight" />
          <RVal value={r} className="block text-[13px]" />
        </div>
        {actions}
      </div>
    </div>
  );
}
