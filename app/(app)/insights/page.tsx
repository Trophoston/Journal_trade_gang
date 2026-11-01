import { TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { BreakdownBars, BreakdownTable, ChartCard, DrawdownChart, Heatmap, RHistogram } from "@/components/insights/blocks";
import { Onboarding } from "@/components/settings/onboarding";
import { Page, Reveal } from "@/components/shell/page";
import { Card, CardHead, Stat } from "@/components/ui/card";
import { Pnl, RVal } from "@/components/ui/pnl";
import { CardSkeleton } from "@/components/ui/skeleton";
import type { BreakdownRow } from "@/lib/analytics/metrics";
import { fmtMoney, fmtNum, fmtPct, fmtR } from "@/lib/format";
import { insights, RANGES, type Insights, type Range } from "@/lib/queries/insights";
import { cn } from "@/lib/ui/cn";

export const metadata = { title: "Insights" };

type SP = Promise<{ range?: string }>;
const RANGE_LABEL: Record<Range, string> = { "30d": "30 วัน", "90d": "90 วัน", ytd: "ปีนี้", all: "ทั้งหมด" };

export default function InsightsPage({ searchParams }: { searchParams: SP }) {
  return (
    <Page title="Insights" subtitle="edge ของคุณอยู่ตรงไหน และรั่วตรงไหน คำนวณจากเทรดจริง ไม่ใช่ AI เดา">
      <Suspense fallback={<CardSkeleton className="h-[640px]" lines={8} />}>
        <Reveal>
          <InsightsData searchParams={searchParams} />
        </Reveal>
      </Suspense>
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="px-1 pt-3 text-[11px] font-semibold tracking-[0.08em] text-fg-3 uppercase">{title}</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-6 lg:grid-cols-12">{children}</div>
    </section>
  );
}

function Breakdown({ title, rows, d, note, className, i }: { title: string; rows: BreakdownRow[]; d: Insights; note?: string; className?: string; i?: number }) {
  return (
    <ChartCard
      i={i}
      title={title}
      note={note}
      className={className ?? "md:col-span-3 lg:col-span-4"}
      chart={<BreakdownBars rows={rows} minN={d.ctx.minN} currency={d.ctx.currency} />}
      table={<BreakdownTable rows={rows} minN={d.ctx.minN} currency={d.ctx.currency} />}
    />
  );
}

function EdgeList({ rows, kind, d }: { rows: (BreakdownRow & { group: string })[]; kind: "strong" | "weak"; d: Insights }) {
  const good = kind === "strong";
  return (
    <Card className="md:col-span-3 lg:col-span-6">
      <CardHead label={good ? "จุดแข็ง" : "จุดอ่อน"} icon={good ? <TrendingUp className="size-4 text-green-ink" /> : <TrendingDown className="size-4 text-red-ink" />} />
      {rows.length ? (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={`${r.group}:${r.key}`} className="flex items-center gap-3 rounded-[12px] px-2 py-2 -mx-2 hover:bg-surface-3/60">
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", good ? "bg-green-soft text-green-ink" : "bg-red-soft text-red-ink")}>{r.group}</span>
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{r.label}</span>
              <span className="num text-[12px] text-fg-3">
                n {r.n} · {fmtPct(r.winRate === null ? null : r.winRate * 100, 0)}
              </span>
              <RVal value={r.avgR} className="w-16 text-right text-[14px] font-semibold" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-fg-3">ยังไม่มีกลุ่มที่{good ? "เป็นบวก" : "เป็นลบ"}ที่มีอย่างน้อย {d.ctx.minN} เทรด</p>
      )}
    </Card>
  );
}

async function InsightsData({ searchParams }: { searchParams: SP }) {
  await connection();
  const sp = await searchParams;
  const range: Range = RANGES.includes(sp.range as Range) ? (sp.range as Range) : "90d";
  const d = await insights(range);
  if (!d) return <Onboarding />;
  const s = d.summary;
  const minNote = `แท่งแสดงค่า R เฉลี่ย แถวลายขีดมีน้อยกว่า ${d.ctx.minN} เทรด`;

  return (
    <div className="flex flex-col gap-4">
      <Card i={0} className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <nav aria-label="ช่วงวันที่" className="inline-flex rounded-[12px] bg-surface-3/80 p-1 ring-1 ring-line ring-inset">
            {RANGES.map((r) => (
              <Link key={r} href={`/insights?range=${r}`} scroll={false} aria-current={r === range ? "page" : undefined} className={cn("rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition-colors", r === range ? "bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-line" : "text-fg-3 hover:text-fg-2")}>
                {RANGE_LABEL[r]}
              </Link>
            ))}
          </nav>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <Stat label="เทรด" value={s.count} detail={`${d.days} วันที่เทรด`} />
            <Stat label="Net" value={<Pnl value={s.net} currency={d.ctx.currency} />} />
            <Stat label="Win rate" value={fmtPct(s.winRate === null ? null : s.winRate * 100, 1)} detail={`${s.wins}W · ${s.losses}L · ${s.be}BE`} />
            <Stat label="Avg R" value={<RVal value={s.avgR} />} detail={`รวม ${fmtR(s.totalR, 1)}`} />
            <Stat label="Profit factor" value={s.profitFactor === null ? "–" : Number.isFinite(s.profitFactor) ? fmtNum(s.profitFactor, 2) : "∞"} detail={`Payoff ${fmtNum(s.payoff, 2)}`} />
            <Stat label="Expectancy" value={<Pnl value={s.expectancy} currency={d.ctx.currency} arrow={false} />} detail="ต่อเทรด" />
          </div>
        </div>
      </Card>

      <Section title="เวลา">
        <Heatmap local={d.heat.local} ny={d.heat.ny} tz={d.ctx.tz} minN={d.ctx.minN} currency={d.ctx.currency} />
        <EdgeList rows={d.strong} kind="strong" d={d} />
        <EdgeList rows={d.weak} kind="weak" d={d} />
        <Breakdown title="Sessions" rows={d.sessions} d={d} note="Session อิงเวลา New York" />
        <Breakdown title="วันในสัปดาห์" rows={d.weekdays} d={d} />
        <Breakdown title="ระยะเวลาถือ" rows={d.hold} d={d} />
      </Section>

      <Section title="Setup และตลาด">
        <Breakdown title="Setups" rows={d.setups} d={d} note={minNote} className="md:col-span-6 lg:col-span-6" />
        <Breakdown title="Confluences" rows={d.confluences} d={d} note="1 เทรดนับในทุก confluence ที่ติด tag" className="md:col-span-6 lg:col-span-6" />
        <Breakdown title="Symbols" rows={d.symbols} d={d} />
        <Breakdown title="Buy vs Sell" rows={d.sides} d={d} />
        <Breakdown title="ข่าว" rows={d.news} d={d} note="จากปฏิทินเศรษฐกิจของ MT5" />
      </Section>

      <Section title="พฤติกรรม">
        <Breakdown title="อารมณ์" rows={d.emotions} d={d} />
        <Breakdown title="เทรดลำดับที่เท่าไรของวัน" rows={d.tradeNo} d={d} />
        <Breakdown title="หลังแพ้" rows={d.tilt} d={d} note="เทรดที่เปิดภายใน 1 ชม. หลังปิดขาดทุน" />
        <Card className="md:col-span-3 lg:col-span-4">
          <CardHead label="ข้อผิดพลาดทำให้เสียเท่าไร" />
          {d.cost.length ? (
            <ul className="flex flex-col gap-2.5">
              {d.cost.map((m) => {
                const worst = Math.abs(Math.min(...d.cost.map((x) => x.net), -1));
                return (
                  <li key={m.key} className="text-[12.5px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-fg-2">{m.label}</span>
                      <span className="num shrink-0">
                        <span className="text-fg-3">n {m.n} · </span>
                        <span className={m.net < 0 ? "text-red-ink" : "text-green-ink"}>{fmtMoney(m.net, d.ctx.currency, { sign: true })}</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-3">
                      <div className={cn("h-full rounded-full", m.net < 0 ? "bg-red" : "bg-green")} style={{ width: `${Math.max(2, (Math.abs(m.net) / worst) * 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-fg-3">ติด tag ข้อผิดพลาดในเทรด เพื่อดูว่าเสียไปเท่าไร</p>
          )}
        </Card>
        <Breakdown title="การจัดการ SL" rows={d.stopBe} d={d} note="เลื่อน SL ไปที่ entry ช่วยคุณ หรือตัดกำไรทิ้ง?" />
        <Breakdown title="ข้อผิดพลาด" rows={d.mistakes} d={d} />
      </Section>

      <Section title="ความเสี่ยง">
        <ChartCard
          title="ผลลัพธ์เป็น R"
          note="แต่ละแท่งคือ 0.5R ขาดทุนเกิน −1R แปลว่า SL slip หรือไม่ได้เคารพ SL"
          className="md:col-span-6 lg:col-span-6"
          chart={<RHistogram bins={d.hist} />}
          table={
            <table className="num w-full text-[12.5px]">
              <tbody>
                {d.hist.map((b) => (
                  <tr key={b.from} className="border-t border-line">
                    <td className="px-1 py-1.5">
                      {fmtNum(b.from, 1, true)}R ถึง {fmtNum(b.from + 0.5, 1, true)}R
                    </td>
                    <td className="px-1 py-1.5 text-right">{b.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
        <ChartCard
          title="Drawdown"
          note={`แย่สุด ${fmtPct(d.drawdown.max, 2)} · ตอนนี้ ${fmtPct(d.drawdown.current, 2)} · ไม่รวมฝาก/ถอน`}
          className="md:col-span-6 lg:col-span-6"
          chart={<DrawdownChart points={d.drawdown.points} tz={d.ctx.tz} />}
          table={
            <p className="text-[13px] text-fg-2">
              Drawdown ลึกสุดในช่วงนี้: <span className="num font-semibold text-red-ink">{fmtPct(d.drawdown.max, 2)}</span> · ตอนนี้: <span className="num font-semibold">{fmtPct(d.drawdown.current, 2)}</span>.
            </p>
          }
        />
      </Section>
    </div>
  );
}
