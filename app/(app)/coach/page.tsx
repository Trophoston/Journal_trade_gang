import { History, Lightbulb, ListChecks, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AiPanel } from "@/components/ai/ai-panel";
import { CustomRules, HistoryTimeline, LessonsList, PreTradeForm } from "@/components/coach/coach-client";
import { Onboarding } from "@/components/settings/onboarding";
import { Page, Reveal } from "@/components/shell/page";
import { Card, CardHead } from "@/components/ui/card";
import { CardSkeleton } from "@/components/ui/skeleton";
import { fmtDay } from "@/lib/format";
import { coach } from "@/lib/queries/coach";
import { addDays } from "@/lib/time/zone";

export const metadata = { title: "โค้ช AI" };

export default function CoachPage() {
  return (
    <Page title="โค้ช AI" subtitle="ทุกอย่างที่ Gemini เขียนให้คุณ บันทึกครั้งเดียวและเก็บไว้ เช็กเทรดก่อนเข้าได้ที่นี่">
      <Suspense fallback={<CardSkeleton className="h-[640px]" lines={8} />}>
        <Reveal>
          <CoachData />
        </Reveal>
      </Suspense>
    </Page>
  );
}

async function CoachData() {
  await connection();
  const d = await coach();
  if (!d) return <Onboarding />;
  const r = d.rules;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-7 xl:col-span-8">
        <Card i={0} ai>
          <AiPanel
            kind="weekly"
            payload={{ monday: d.weekly.monday }}
            scopeKey={d.weekly.scopeKey}
            report={d.weekly.report}
            versions={d.weekly.versions}
            title={`รีวิวรายสัปดาห์ · ${fmtDay(d.weekly.monday)} – ${fmtDay(addDays(d.weekly.monday, 4))}`}
            emptyNote="รันอัตโนมัติหลังตลาดปิดวันศุกร์ หรือรันตอนนี้เพื่อดูสัปดาห์ที่ผ่านมาก็ได้"
          />
        </Card>
        <Card i={1}>
          <CardHead label="ประวัติ AI" icon={<History className="size-4" />} action={<span className="num text-[12px] text-fg-3">บันทึกไว้ {d.history.length}</span>} />
          <HistoryTimeline items={d.history} tz={d.ctx.tz} />
        </Card>
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-5 xl:col-span-4">
        <Card i={2} ai>
          <CardHead label={<span className="text-violet-ink">Pre-trade check</span>} icon={<ShieldCheck className="size-4 text-violet-ink" />} />
          <PreTradeForm form={d.form} />
          <p className="mt-4 text-[11px] text-fg-3">คำแนะนำ AI จาก journal ของคุณ ไม่ใช่คำแนะนำทางการเงิน</p>
        </Card>
        <Card i={3}>
          <CardHead label="กฎของคุณ" icon={<ListChecks className="size-4" />} action={<Link href="/settings#rules" className="text-[12px] text-fg-3 hover:text-fg">แก้ขีดจำกัด</Link>} />
          <div className="num mb-3 flex flex-wrap gap-1.5 text-[11.5px]">
            {r.riskPerTradePct !== undefined && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-fg-2">Risk {r.riskPerTradePct}%</span>}
            {r.maxTradesPerDay !== undefined && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-fg-2">Max {r.maxTradesPerDay} trades/day</span>}
            {r.dailyLossLimitPct !== undefined && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-fg-2">Stop at −{r.dailyLossLimitPct}%/day</span>}
            {r.newsBlackoutMin !== undefined && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-fg-2">No trades ±{r.newsBlackoutMin}m news</span>}
          </div>
          <CustomRules rules={d.customRules} />
        </Card>
        <Card i={4}>
          <CardHead label="บทเรียน" icon={<Lightbulb className="size-4" />} />
          <LessonsList lessons={d.lessons} tz={d.ctx.tz} />
        </Card>
      </div>
    </div>
  );
}
