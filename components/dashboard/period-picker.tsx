"use client";

import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { boundsOf, shiftAnchor, type Period, type PeriodKind } from "@/lib/analytics/period";
import { cn } from "@/lib/ui/cn";

const OPTIONS: { value: PeriodKind; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "day", label: "วัน" },
  { value: "week", label: "สัปดาห์" },
  { value: "month", label: "เดือน" },
  { value: "quarter", label: "ไตรมาส" },
  { value: "year", label: "ปี" },
  { value: "custom", label: "กำหนดเอง" },
];

/** Chooses the dashboard's period. Lives in the URL (?p=week&at=…), so reloads and links keep it. */
export function PeriodPicker({ period, today, firstDay }: { period: Period; today: string; firstDay: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<PeriodKind>(period.kind);
  const [from, setFrom] = useState(period.from ?? firstDay);
  const [to, setTo] = useState(period.to ?? today);

  const go = (q: Record<string, string>) => start(() => router.push(`/?${new URLSearchParams(q)}`, { scroll: false }));

  const choose = (k: PeriodKind) => {
    setKind(k);
    if (k === "custom") {
      // Start from the period on screen, so "Custom" is a small edit away.
      setFrom(period.from ?? firstDay);
      setTo(period.to ?? today);
      return;
    }
    go(k === "all" ? {} : { p: k });
  };

  const step = period.kind !== "all" && period.kind !== "custom" ? period.kind : null;
  const nextAnchor = step ? shiftAnchor(step, period.anchor, 1) : null;
  const canNext = step && nextAnchor ? boundsOf(step, nextAnchor).from <= today : false;
  const canPrev = step ? boundsOf(step, period.anchor).from > firstDay : false;

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <div className="max-w-full overflow-x-auto">
        <Segmented label="ช่วงเวลาของภาพรวม" size="sm" value={kind} onChange={choose} options={OPTIONS} />
      </div>
      {kind === "custom" ? (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            go({ p: "custom", from, to });
          }}
        >
          <Input type="date" aria-label="ตั้งแต่" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[9.5rem] text-[13px]" />
          <span className="text-fg-3">–</span>
          <Input type="date" aria-label="ถึง" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-8 w-[9.5rem] text-[13px]" />
          <Button size="sm" variant="soft" type="submit" disabled={!from && !to}>
            <CalendarRange /> แสดง
          </Button>
        </form>
      ) : (
        step && (
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="ช่วงก่อนหน้า" disabled={!canPrev} onClick={() => go({ p: step, at: shiftAnchor(step, period.anchor, -1) })}>
              <ChevronLeft />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="ช่วงถัดไป" disabled={!canNext} onClick={() => nextAnchor && go({ p: step, at: nextAnchor })}>
              <ChevronRight />
            </Button>
            {!period.current && (
              <Button size="sm" variant="ghost" onClick={() => go({ p: step })}>
                กลับมาปัจจุบัน
              </Button>
            )}
          </div>
        )
      )}
    </div>
  );
}
