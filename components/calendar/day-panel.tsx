import { X } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, ViewTransition } from "react";
import { AiPanel } from "@/components/ai/ai-panel";
import { buttonClass } from "@/components/ui/button";
import { Pnl, RVal } from "@/components/ui/pnl";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDay, fmtPct, fmtR, fmtTime } from "@/lib/format";
import { dayDetail, getCtx } from "@/lib/queries/journal";
import { cn } from "@/lib/ui/cn";
import { Sparkles } from "lucide-react";
import { DayJournal } from "./day-journal";

/** The selected day. Shares its view-transition name with the grid cell, so the cell morphs into it. */
export function DayPanel({ day, month }: { day: string; month: string }) {
  return (
    <ViewTransition name={`cal-day-${day}`} share="morph" default="none">
      <section className="glass-card min-w-0 p-5" aria-label={`วัน ${day}`}>
        <div className="relative z-[2]">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <div className="text-[12px] text-fg-3">วันเทรด</div>
              <h2 className="text-[20px] font-semibold tracking-tight">{fmtDay(day, true)}</h2>
            </div>
            <Link href={`/calendar?m=${month}`} scroll={false} className={buttonClass("ghost", "icon-sm")} aria-label="ปิด">
              <X />
            </Link>
          </div>
          <Suspense fallback={<DaySkeleton />}>
            <DayBody day={day} />
          </Suspense>
        </div>
      </section>
    </ViewTransition>
  );
}

function DaySkeleton() {
  return (
    <div className="appear-late space-y-3">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-14" />
      <Skeleton className="h-14" />
      <Skeleton className="h-32" />
    </div>
  );
}

async function DayBody({ day }: { day: string }) {
  await connection();
  const [d, ctx] = await Promise.all([dayDetail(day), getCtx()]);
  if (!d) return null;
  const s = d.summary;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <Pnl value={s.net} currency={ctx.currency} className="text-[26px] font-semibold tracking-tight" />
        <span className="num text-[13px] text-fg-3">
          {s.count} เทรด · win {fmtPct(s.winRate === null ? null : s.winRate * 100, 0)} · {fmtR(s.totalR)}
        </span>
      </div>
      {d.trades.length > 0 ? (
        <ul className="-mx-2 flex flex-col">
          {d.trades.map((t) => (
            <li key={t.id}>
              <Link href={`/trades/${encodeURIComponent(t.id)}`} className="flex items-center gap-3 rounded-[12px] px-2 py-2 transition-colors hover:bg-surface-3/70">
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-[8px] text-[10px] font-bold", t.side === "long" ? "bg-green-soft text-green-ink" : "bg-red-soft text-red-ink")}>{t.side === "long" ? "L" : "S"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">
                    {t.symbol} <span className="font-normal text-fg-3">· {t.session}</span>
                  </span>
                  <span className="block truncate text-[11px] text-fg-3">
                    {fmtTime(t.openedAt, ctx.tz)}–{fmtTime(t.closedAt, ctx.tz)}
                    {t.setup ? ` · ${t.setup}` : " · untagged"}
                  </span>
                </span>
                {t.analyzed && <Sparkles className="size-3.5 text-violet-ink" aria-label="มีบทวิเคราะห์ AI แล้ว" />}
                <span className="text-right">
                  <Pnl value={t.net} currency={ctx.currency} arrow={false} className="block text-[13px]" />
                  <RVal value={t.r} className="block text-[11px]" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-fg-3">วันนี้ไม่มีเทรด</p>
      )}
      {d.trades.length > 0 && (
        <div className="ai-wash -mx-5 border-y border-line px-5 py-5">
          <AiPanel kind="daily" scopeKey={d.scopeKey} payload={{ day }} report={d.report} versions={d.versions} title="รีวิวรายวัน" emptyNote="รันอัตโนมัติหลังปิดวันเทรด (17:00 เวลานิวยอร์ก)" />
        </div>
      )}
      <DayJournal day={day} initial={d.journal} />
    </div>
  );
}
