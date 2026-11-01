import { CircleAlert, CircleCheck, Flame, Gauge, Info, ListChecks, Radar, ShieldAlert, TrendingUp } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AiPanel } from "@/components/ai/ai-panel";
import { EdgeRadarChart } from "@/components/charts/radar";
import { EquityChart } from "@/components/charts/equity-chart";
import { WinGauge } from "@/components/charts/gauge";
import { PnlBars } from "@/components/charts/pnl-bars";
import { LiveAccount } from "@/components/dashboard/live-account";
import { MiniCalendar } from "@/components/dashboard/mini-calendar";
import { PeriodPicker } from "@/components/dashboard/period-picker";
import { ReviewQueue } from "@/components/dashboard/review-queue";
import { SessionStrip } from "@/components/dashboard/session-strip";
import { Onboarding } from "@/components/settings/onboarding";
import { Page, Reveal } from "@/components/shell/page";
import { Card, CardHead, Stat } from "@/components/ui/card";
import { Pnl } from "@/components/ui/pnl";
import { CardSkeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import { fmtDay, fmtMoney, fmtNum, fmtPct, fmtR } from "@/lib/format";
import { dashboard, getCtx } from "@/lib/queries/journal";
import { cn } from "@/lib/ui/cn";

export const metadata = { title: "ภาพรวม" };

type SP = Promise<{ p?: string; at?: string; from?: string; to?: string }>;

export default function DashboardPage({ searchParams }: { searchParams: SP }) {
  return (
    <Page title="ภาพรวม" subtitle={<Suspense fallback=" ">{<TodayLabel />}</Suspense>}>
      <Suspense fallback={<DashboardSkeleton />}>
        <Reveal>
          <DashboardData searchParams={searchParams} />
        </Reveal>
      </Suspense>
    </Page>
  );
}

async function TodayLabel() {
  await connection();
  const { today, account } = await getCtx();
  return (
    <>
      วันเทรด {fmtDay(today, true)}
      {account ? ` · ${account.name || account.login}` : ""}
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
      <CardSkeleton className="h-[120px] md:col-span-6 xl:col-span-12" lines={1} />
      <CardSkeleton className="h-[340px] md:col-span-6 xl:col-span-8" />
      <CardSkeleton className="h-[340px] md:col-span-6 xl:col-span-4" />
      <CardSkeleton className="h-[300px] md:col-span-3 xl:col-span-5" />
      <CardSkeleton className="h-[300px] md:col-span-3 xl:col-span-4" />
      <CardSkeleton className="h-[300px] md:col-span-6 xl:col-span-3" />
    </div>
  );
}

const GUARD_ICON = { stop: ShieldAlert, caution: CircleAlert, info: Info, good: CircleCheck };
const GUARD_TONE = { stop: "text-red-ink bg-red-soft", caution: "text-fg bg-[color-mix(in_oklab,var(--amber)_15%,transparent)]", info: "text-fg-2 bg-metal-soft", good: "text-green-ink bg-green-soft" };

async function DashboardData({ searchParams }: { searchParams: SP }) {
  await connection();
  const d = await dashboard(await searchParams);
  if (!d) return <Onboarding />;
  const { ctx, summary: s, streaks: st } = d;
  const cur = ctx.currency;
  const scale = (await getCtx()).scale;
  const briefKey = d.brief?.scopeKey ?? `brief:${d.account.id}:${ctx.today}`;
  const briefDay = briefKey.split(":").at(-1)!;

  const p = d.period;
  const scoped = p.kind !== "all";
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12">
      <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-6 xl:col-span-12">
        <PeriodPicker key={`${p.kind}:${p.from}:${p.to}`} period={p} today={ctx.today} firstDay={d.firstDay} />
        <span className="num text-[13px] text-fg-3">
          <span className="font-medium text-fg">{p.label}</span>
          {scoped && p.from && p.to && p.from !== p.to && p.kind !== "custom" ? ` · ${fmtDay(p.from)} – ${fmtDay(p.to)}` : ""} · {s.count} เทรด
        </span>
      </div>
      <Card i={0} className="md:col-span-6 xl:col-span-12">
        <SessionStrip title={d.planDay === ctx.today ? "Session วันนี้" : `Session ถัดไป · ${fmtDay(d.planDay)}`} sessions={d.sessions} news={d.news} tz={ctx.tz} minSample={ctx.minSample} />
      </Card>

      <Card i={1} className="md:col-span-6 xl:col-span-8">
        <CardHead label={scoped ? `Balance · ${p.label}` : "Balance"} icon={<TrendingUp className="size-4" />} action={<span className="num text-[12px] text-fg-3">Gain {fmtPct(d.curve.gainPct, 2, true)} · Max DD {fmtPct(-d.curve.maxDrawdownPct, 2)}</span>} />
        <EquityChart key={`${p.from}:${p.to}`} points={d.curve.points} currency={cur} tz={ctx.tz} fixed={scoped} />
      </Card>

      <Card i={2} className="md:col-span-6 xl:col-span-4">
        <LiveAccount account={d.account} today={d.today} currency={cur} scale={scale} />
      </Card>

      <Card i={3} ai className="md:col-span-6 xl:col-span-5">
        <AiPanel kind="brief" scopeKey={briefKey} payload={{ day: briefDay }} report={d.brief as never} title={`Brief ก่อนเทรด${briefDay !== ctx.today ? ` · ${fmtDay(briefDay)}` : ""}`} compact emptyNote="วันละ 1 brief: ช่วงเวลาที่คุณเทรดได้ดี ข่าววันนี้ และ checklist" />
        {d.guards.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">Guardrails · ตามกฎของคุณ</div>
            <ul className="space-y-1.5">
              {d.guards.slice(0, 4).map((g, i) => {
                const Icon = GUARD_ICON[g.level];
                return (
                  <li key={i} className={cn("flex gap-2 rounded-[12px] px-2.5 py-2 text-[13px]", GUARD_TONE[g.level])}>
                    <Icon className="mt-0.5 size-4 shrink-0" />
                    <span>
                      <span className="font-medium">{g.title}</span> <span className="opacity-80">· {g.detail}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Card>

      <Card i={4} className="md:col-span-3 xl:col-span-4">
        <CardHead label="Edge Radar" icon={<Radar className="size-4" />} action={<span className="num text-[12px] text-fg-3">คะแนน {d.edge.score ?? "–"}</span>} />
        <div className="flex flex-1 items-center justify-center">
          <EdgeRadarChart axes={d.edge.axes} />
        </div>
      </Card>

      <Card i={5} className="md:col-span-3 xl:col-span-3">
        <CardHead label="Win rate" icon={<Gauge className="size-4" />} action={<span className="num text-[12px] text-fg-3">n={s.count}</span>} />
        <WinGauge wins={s.wins} losses={s.losses} be={s.be} />
        <div className="mt-2 flex justify-center gap-4 text-[12px] text-fg-3">
          <span>
            <span className="mr-1 inline-block size-2 rounded-full bg-green" />
            ชนะ {s.wins}
          </span>
          <span>
            <span className="mr-1 inline-block size-2 rounded-full bg-metal" />
            เสมอ {s.be}
          </span>
          <span>
            <span className="mr-1 inline-block size-2 rounded-full bg-red" />
            แพ้ {s.losses}
          </span>
        </div>
        <div className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-4">
          <Stat label="Profit factor" value={s.profitFactor === null ? "–" : Number.isFinite(s.profitFactor) ? fmtNum(s.profitFactor, 2) : "∞"} />
          <Stat label="Expectancy" value={<span className={cn((s.avgR ?? 0) >= 0 ? "text-green-ink" : "text-red-ink")}>{fmtR(s.avgR)}</span>} detail={s.expectancy !== null ? `${fmtMoney(s.expectancy, cur, { sign: true })}/เทรด` : undefined} />
        </div>
      </Card>

      <Card i={6} className="md:col-span-2 xl:col-span-3">
        <CardHead label={`Net P&L · ${p.label}`} />
        <Pnl value={s.net} currency={cur} className="text-[24px] font-semibold tracking-tight" />
        <div className="mt-1 text-[12px] text-fg-3">
          {s.count} เทรด · ค่าธรรมเนียม {fmtMoney(s.fees, cur)}
        </div>
        <div className="mt-auto pt-4">
          <PnlBars data={d.sparkDays.map((x) => ({ key: x.day, label: fmtDay(x.day, true), value: x.net, sub: `${x.n} เทรด` }))} currency={cur} height={44} label="P&L รายวัน 30 วันเทรดล่าสุดในช่วงนี้" />
        </div>
      </Card>

      <Card i={7} className="md:col-span-2 xl:col-span-3">
        <CardHead label={`${d.month.label} · ${d.month.summary.count} เทรด`} />
        <Pnl value={d.month.summary.net} currency={cur} className="text-[24px] font-semibold tracking-tight" />
        <div className="mt-auto grid grid-cols-2 gap-3 pt-4">
          <Stat label="Win rate" value={fmtPct(d.month.summary.winRate === null ? null : d.month.summary.winRate * 100, 0)} />
          <Stat label="Total R" value={<span className={d.month.summary.totalR >= 0 ? "text-green-ink" : "text-red-ink"}>{fmtR(d.month.summary.totalR, 1)}</span>} />
        </div>
      </Card>

      <Card i={8} className="md:col-span-2 xl:col-span-3">
        <CardHead label="Avg win vs Avg loss" />
        <div className="flex items-baseline gap-3">
          <Pnl value={s.avgWin} currency={cur} className="text-[20px] font-semibold" />
          <span className="text-fg-3">/</span>
          <Pnl value={s.avgLoss === null ? null : -Math.abs(s.avgLoss)} currency={cur} className="text-[20px] font-semibold" />
        </div>
        {s.avgWin !== null && s.avgLoss !== null && (
          <div className="mt-4 flex h-2 gap-[2px] overflow-hidden rounded-full" aria-hidden>
            <div className="rounded-l-full bg-green" style={{ flex: s.avgWin }} />
            <div className="rounded-r-full bg-red" style={{ flex: Math.abs(s.avgLoss) }} />
          </div>
        )}
        <div className="mt-auto pt-4 text-[12px] text-fg-3">Payoff {fmtNum(s.payoff, 2)} · ชนะมากสุด {fmtMoney(s.largestWin, cur)}</div>
      </Card>

      <Card i={9} className="md:col-span-6 xl:col-span-3">
        <CardHead label="Streak" icon={<Flame className="size-4" />} />
        <div className="grid grid-cols-2 gap-4">
          <Stat label="ตอนนี้ (เทรด)" value={<span className={st.currentTrades.kind === "win" ? "text-green-ink" : st.currentTrades.kind === "loss" ? "text-red-ink" : ""}>{st.currentTrades.n ? `${st.currentTrades.kind === "win" ? "ชนะ" : "แพ้"}ติด ${st.currentTrades.n}` : "–"}</span>} />
          <Stat label="ตอนนี้ (วัน)" value={<span className={st.currentDays.kind === "win" ? "text-green-ink" : st.currentDays.kind === "loss" ? "text-red-ink" : ""}>{st.currentDays.n ? `${st.currentDays.kind === "win" ? "เขียว" : "แดง"}ติด ${st.currentDays.n} วัน` : "–"}</span>} />
          <Stat label="ชนะติดสูงสุด" value={`${st.maxWinTrades} เทรด`} detail={`เขียวติด ${st.maxWinDays} วัน`} />
          <Stat label="แพ้ติดสูงสุด" value={`${st.maxLossTrades} เทรด`} detail={`แดงติด ${st.maxLossDays} วัน`} />
        </div>
      </Card>

      <Card i={10} className="md:col-span-3 xl:col-span-5">
        <MiniCalendar month={d.month.key} days={d.month.days} currency={cur} today={ctx.today} />
      </Card>

      <Card i={11} className="md:col-span-3 xl:col-span-4">
        <CardHead label="รอรีวิว" icon={<ListChecks className="size-4" />} action={<Link href="/trades?review=1" className="text-[12px] text-blue-ink hover:underline">ทั้งหมด</Link>} />
        <ReviewQueue items={d.review} currency={cur} />
      </Card>

      <Card i={12} className="md:col-span-6 xl:col-span-3">
        <CardHead label="Returns" />
        <div className="grid grid-cols-2 gap-4">
          <Tip content="Time-weighted: ตัดผลของการฝาก-ถอนออก จึงเป็นผลงานการเทรดล้วน ๆ">
            <div>
              <Stat label="Gain (TWR)" value={<span className={d.curve.gainPct >= 0 ? "text-green-ink" : "text-red-ink"}>{fmtPct(d.curve.gainPct, 2, true)}</span>} />
            </div>
          </Tip>
          <Stat label="Max drawdown" value={<span className="text-red-ink">{fmtPct(-d.curve.maxDrawdownPct, 2)}</span>} detail={`ตอนนี้ ${fmtPct(-d.curve.currentDrawdownPct, 2)}`} />
          <Stat label="เฉลี่ยต่อวัน" value={fmtPct(d.curve.returns.daily, 2, true)} />
          <Stat label="เฉลี่ยต่อเดือน" value={fmtPct(d.curve.returns.monthly, 2, true)} />
          <Stat label="ฝากสุทธิ" value={fmtMoney(d.curve.netDeposits, cur)} />
          <Stat label="Balance สูงสุด" value={fmtMoney(d.curve.highest, cur)} />
        </div>
      </Card>
    </div>
  );
}
