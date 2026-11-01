"use client";

import { NotebookPen, Sparkles } from "lucide-react";
import Link from "next/link";
import { ViewTransition } from "react";
import { Segmented } from "@/components/ui/segmented";
import type { DayStat } from "@/lib/analytics/metrics";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import { useStored } from "@/lib/ui/use-stored";

export type Metric = "pnl" | "r" | "trades" | "win" | "pct";

interface Week {
  monday: string;
  days: { day: string; inMonth: boolean; stat: DayStat | null; note: boolean; review: boolean }[];
  net: number;
  count: number;
  r: number;
  review: boolean;
}


function compactMoney(n: number) {
  const abs = Math.abs(n);
  const body = abs >= 1000 ? `${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}K` : abs.toFixed(0);
  return `${n < 0 ? "−" : n > 0 ? "+" : ""}$${body}`;
}

function value(metric: Metric, s: DayStat, pct: number | undefined, currency: string, tight: boolean) {
  switch (metric) {
    case "pnl":
      return tight ? compactMoney(s.net) : fmtMoney(s.net, currency, { sign: true, compact: true });
    case "r":
      return `${fmtNum(s.r, 1, true)}R`;
    case "trades":
      return `${s.count}`;
    case "win":
      return s.wins + s.losses ? fmtPct((s.wins / (s.wins + s.losses)) * 100, 0) : "–";
    case "pct":
      return pct === undefined ? "–" : fmtPct(pct, 2, true);
  }
}

export function CalendarGrid({ month, weeks, pct, currency, today, selected }: { month: string; weeks: Week[]; pct: Record<string, number>; currency: string; today: string; selected: string | null }) {
  const [metric, setMetric] = useStored<Metric>("tg-cal-metric", "pnl", ["pnl", "r", "trades", "win", "pct"]);
  const maxAbs = Math.max(1, ...weeks.flatMap((w) => w.days.map((d) => (d.stat && d.inMonth ? Math.abs(d.stat.net) : 0))));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="แสดงในแต่ละวัน"
          size="sm"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "pnl", label: "P&L" },
            { value: "r", label: "R" },
            { value: "pct", label: "%" },
            { value: "trades", label: "จำนวนเทรด" },
            { value: "win", label: "Win rate" },
          ]}
        />
        <div className="flex items-center gap-3 text-[11px] text-fg-3">
          <span className="flex items-center gap-1">
            <NotebookPen className="size-3" /> โน้ต
          </span>
          <span className="flex items-center gap-1">
            <Sparkles className="size-3 text-violet-ink" /> รีวิว AI
          </span>
        </div>
      </div>
      <div className="overflow-x-auto no-scrollbar">
        <div className="grid min-w-[640px] grid-cols-[repeat(7,minmax(0,1fr))_minmax(92px,0.9fr)] gap-1.5">
          {["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา.", "สัปดาห์"].map((d) => (
            <div key={d} className="px-1 pb-1 text-[11px] font-medium text-fg-3">
              {d}
            </div>
          ))}
          {weeks.map((w, wi) => (
            <Row key={w.monday} week={w} index={wi} metric={metric} pct={pct} currency={currency} today={today} selected={selected} month={month} maxAbs={maxAbs} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ week, index, metric, pct, currency, today, selected, month, maxAbs }: { week: Week; index: number; metric: Metric; pct: Record<string, number>; currency: string; today: string; selected: string | null; month: string; maxAbs: number }) {
  return (
    <>
      {week.days.map((d) => {
        const s = d.stat;
        const isSel = selected === d.day;
        const weekend = new Date(`${d.day}T00:00:00Z`).getUTCDay() % 6 === 0;
        const strength = s && d.inMonth ? 0.35 + 0.65 * Math.min(1, Math.abs(s.net) / maxAbs) : 0;
        const cell = (
          <Link
            href={isSel ? `/calendar?m=${month}` : `/calendar?m=${month}&day=${d.day}`}
            scroll={false}
            aria-current={isSel ? "date" : undefined}
            aria-label={`${d.day}${s ? `: ${fmtMoney(s.net, currency, { sign: true })}, ${s.count} เทรด` : ", ไม่มีเทรด"}`}
            className={cn(
              "group relative flex h-[92px] flex-col rounded-[14px] p-2 ring-1 ring-inset transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] sm:h-[104px] sm:p-2.5",
              !d.inMonth && "opacity-35",
              s ? (s.net > 0 ? "ring-green/20" : s.net < 0 ? "ring-red/20" : "ring-line") : weekend ? "bg-transparent ring-line/60" : "bg-surface-2/40 ring-line",
              isSel && "ring-2 ring-blue",
            )}
            style={s && d.inMonth ? { background: `color-mix(in oklab, ${s.net > 0 ? "var(--green)" : s.net < 0 ? "var(--red)" : "var(--metal)"} ${Math.round(strength * 18)}%, transparent)` } : undefined}
          >
            <div className="flex items-center justify-between">
              <span className={cn("num text-[12px] font-medium", d.day === today ? "grid size-5 place-items-center rounded-full bg-blue text-white" : "text-fg-2")}>{Number(d.day.slice(8))}</span>
              <span className="flex items-center gap-1">
                {d.note && <NotebookPen className="size-3 text-fg-3" aria-label="มีโน้ต" />}
                {d.review && <Sparkles className="size-3 text-violet-ink" aria-label="AI รีวิวแล้ว" />}
              </span>
            </div>
            {s && (
              <div className="mt-auto min-w-0">
                <div className={cn("num truncate text-[15px] leading-tight font-semibold tracking-tight sm:text-[16px]", metric === "trades" ? "text-fg" : s.net > 0 ? "text-green-ink" : s.net < 0 ? "text-red-ink" : "text-metal-ink")}>
                  {metric !== "trades" && metric !== "win" && s.net !== 0 && <span aria-hidden className="mr-0.5 text-[10px]">{s.net > 0 ? "▲" : "▼"}</span>}
                  {value(metric, s, pct[d.day], currency, selected !== null)}
                </div>
                <div className="num truncate text-[11px] text-fg-3">
                  {s.count} เทรด
                  {selected === null && metric !== "win" && s.wins + s.losses > 0 ? ` · ${Math.round((s.wins / (s.wins + s.losses)) * 100)}%` : ""}
                  {selected === null && metric !== "r" && s.rCount ? ` · ${fmtNum(s.r, 1, true)}R` : ""}
                </div>
              </div>
            )}
          </Link>
        );
        return isSel ? (
          <div key={d.day}>{cell}</div>
        ) : (
          <ViewTransition key={d.day} name={`cal-day-${d.day}`} share="morph" default="none">
            {cell}
          </ViewTransition>
        );
      })}
      <div className={cn("flex h-[92px] flex-col justify-between rounded-[14px] bg-surface-2/70 p-2.5 ring-1 ring-line ring-inset sm:h-[104px]")}>
        <div className="flex items-center justify-between text-[11px] text-fg-3">
          <span>สัปดาห์ {index + 1}</span>
          {week.review && <Sparkles className="size-3 text-violet-ink" aria-label="รีวิวรายสัปดาห์จาก AI" />}
        </div>
        {week.count > 0 ? (
          <div>
            <div className={cn("num text-[15px] font-semibold", week.net > 0 ? "text-green-ink" : week.net < 0 ? "text-red-ink" : "text-metal-ink")}>{fmtMoney(week.net, currency, { sign: true, compact: true })}</div>
            <div className="num text-[11px] text-fg-3">
              {week.count} เทรด · {fmtNum(week.r, 1, true)}R
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-fg-3">ไม่มีเทรด</div>
        )}
      </div>
    </>
  );
}
