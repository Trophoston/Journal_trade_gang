import { CheckCircle2, Sparkles } from "lucide-react";
import Link from "next/link";
import { Pnl, RVal } from "@/components/ui/pnl";
import { fmtDay } from "@/lib/format";
import { cn } from "@/lib/ui/cn";

export function ReviewQueue({ items, currency }: { items: { id: string; symbol: string; side: string; day: string; net: number; r: number | null; analyzed: boolean }[]; currency: string }) {
  if (!items.length)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center text-[13px] text-fg-3">
        <CheckCircle2 className="size-6 text-green" />
        ติด tag ครบทุกเทรดแล้ว เยี่ยม!
      </div>
    );
  return (
    <ul className="-mx-2 flex flex-col">
      {items.map((t) => (
        <li key={t.id}>
          <Link href={`/trades/${encodeURIComponent(t.id)}`} className="flex items-center gap-2.5 rounded-[12px] px-2 py-2 transition-colors hover:bg-surface-3/70">
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-[8px] text-[10px] font-bold", t.side === "long" ? "bg-green-soft text-green-ink" : "bg-red-soft text-red-ink")}>{t.side === "long" ? "L" : "S"}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{t.symbol}</span>
              <span className="block text-[11px] text-fg-3">{fmtDay(t.day)}</span>
            </span>
            {t.analyzed && <Sparkles className="size-3.5 text-violet-ink" aria-label="มีบทวิเคราะห์ AI แล้ว" />}
            <span className="text-right">
              <Pnl value={t.net} currency={currency} className="block text-[13px]" arrow={false} />
              <RVal value={t.r} className="block text-[11px]" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
