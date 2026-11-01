import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense, ViewTransition } from "react";
import { CalendarGrid } from "@/components/calendar/calendar-grid";
import { DayPanel } from "@/components/calendar/day-panel";
import { Onboarding } from "@/components/settings/onboarding";
import { Page, Reveal } from "@/components/shell/page";
import { buttonClass } from "@/components/ui/button";
import { Card, Stat } from "@/components/ui/card";
import { Pnl } from "@/components/ui/pnl";
import { CardSkeleton } from "@/components/ui/skeleton";
import { fmtMonth, fmtPct, fmtR } from "@/lib/format";
import { calendarMonth, getCtx } from "@/lib/queries/journal";
import { cn } from "@/lib/ui/cn";
import { monthKey } from "@/lib/time/zone";

export const metadata = { title: "ปฏิทิน" };

type SP = Promise<{ m?: string; day?: string }>;

function shift(month: string, n: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function CalendarPage({ searchParams }: { searchParams: SP }) {
  return (
    <Page title="ปฏิทิน" subtitle="ผลรายวัน ยอดรวมรายสัปดาห์ และบันทึกของคุณ">
      <Suspense fallback={<CardSkeleton className="h-[640px]" lines={8} />}>
        <Reveal>
          <CalendarData searchParams={searchParams} />
        </Reveal>
      </Suspense>
    </Page>
  );
}

async function CalendarData({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const ctx = await getCtx();
  const month = sp.m && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? monthKey(sp.day) : monthKey(ctx.today);
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  const data = await calendarMonth(month);
  if (!data) return <Onboarding />;
  const s = data.summary;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <ViewTransition name="cal-grid" share="morph" default="none">
        <Card i={0} className={cn("p-4 sm:p-5", day ? "xl:col-span-8" : "xl:col-span-12")}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Link href={`/calendar?m=${shift(month, -1)}`} scroll={false} className={buttonClass("ghost", "icon-sm")} aria-label="เดือนก่อน">
                <ChevronLeft />
              </Link>
              <h2 className="min-w-[150px] text-center text-[17px] font-semibold tracking-tight">{fmtMonth(month)}</h2>
              <Link href={`/calendar?m=${shift(month, 1)}`} scroll={false} className={buttonClass("ghost", "icon-sm")} aria-label="เดือนถัดไป">
                <ChevronRight />
              </Link>
              {month !== monthKey(ctx.today) && (
                <Link href="/calendar" scroll={false} className={buttonClass("ghost", "sm", "ml-1")}>
                  วันนี้
                </Link>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Stat label="Net" value={<Pnl value={s.net} currency={data.ctx.currency} />} />
              <Stat label="Return" value={<span className={(data.monthPct ?? 0) >= 0 ? "text-green-ink" : "text-red-ink"}>{fmtPct(data.monthPct, 2, true)}</span>} />
              <Stat label="วัน" value={<span><span className="text-green-ink">{data.greenDays}▲</span> <span className="text-red-ink">{data.redDays}▼</span></span>} />
              <Stat label="Win rate" value={fmtPct(s.winRate === null ? null : s.winRate * 100, 0)} detail={`${s.count} เทรด`} />
              <Stat label="Total R" value={<span className={s.totalR >= 0 ? "text-green-ink" : "text-red-ink"}>{fmtR(s.totalR, 1)}</span>} />
            </div>
          </div>
          <CalendarGrid month={month} weeks={data.weeks} pct={data.pct} currency={data.ctx.currency} today={data.ctx.today} selected={day} />
        </Card>
      </ViewTransition>
      {day && (
        <div className="xl:col-span-4">
          <DayPanel day={day} month={month} />
        </div>
      )}
    </div>
  );
}
