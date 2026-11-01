import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { AiPanel } from "@/components/ai/ai-panel";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHead, Stat } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Pnl } from "@/components/ui/pnl";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDuration, fmtMoney, fmtNum, fmtR, fmtTime } from "@/lib/format";
import { tradeDetail } from "@/lib/queries/trades";
import { cn } from "@/lib/ui/cn";
import { EvidenceList } from "./evidence-list";
import { TradeChart } from "./trade-chart";
import { TradeHeader } from "./trade-header";
import { TradeJournal } from "./trade-journal";

const CLOSED_BY: Record<string, string> = { sl: "Stop loss", tp: "Take profit", manual: "ปิดเอง", mobile: "ปิดจากมือถือ", web: "ปิดจากเว็บ", expert: "EA", so: "Stop out", other: "อื่น ๆ" };

const href = (id: string) => `/trades/${encodeURIComponent(id)}`;

function price(n: number | null | undefined) {
  if (n === null || n === undefined) return "–";
  return n >= 1000 ? n.toFixed(2) : n >= 10 ? n.toFixed(3) : n.toFixed(5);
}

export function TradeDetailSkeleton({ header = true }: { header?: boolean }) {
  return (
    <div className="appear-late flex flex-col gap-4">
      {header && <Skeleton className="h-12 w-72" />}
      <Skeleton className="h-16" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Skeleton className="h-[440px] lg:col-span-8" />
        <Skeleton className="h-[440px] lg:col-span-4" />
      </div>
    </div>
  );
}

/** Everything about one trade. Rendered as a full page and inside the modal over the list. */
export async function TradeDetailBody({ id, inModal = false }: { id: string; inModal?: boolean }) {
  await connection();
  const d = await tradeDetail(id);
  if (!d) return <Empty title="ไม่พบเทรดนี้">อาจถูกซ่อน ยังเปิดอยู่ หรือมาจากบัญชีที่ลบไปแล้ว</Empty>;
  const { trade: t, ctx } = d;
  const plannedR = t.sl0 && t.tp0 ? Math.abs(t.tp0 - t.entry) / Math.abs(t.entry - t.sl0) : null;

  const nav = (
    <div className="flex items-center gap-1">
      {d.prev ? (
        <Link href={href(d.prev)} replace={inModal} scroll={!inModal} className={buttonClass("ghost", "icon-sm")} aria-label="เทรดก่อนหน้า">
          <ChevronLeft />
        </Link>
      ) : (
        <span className={buttonClass("ghost", "icon-sm", "opacity-30")} aria-hidden>
          <ChevronLeft />
        </span>
      )}
      {d.next ? (
        <Link href={href(d.next)} replace={inModal} scroll={!inModal} className={buttonClass("ghost", "icon-sm")} aria-label="เทรดถัดไป">
          <ChevronRight />
        </Link>
      ) : (
        <span className={buttonClass("ghost", "icon-sm", "opacity-30")} aria-hidden>
          <ChevronRight />
        </span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <TradeHeader symbol={t.symbol} side={t.side} outcome={t.outcome} net={t.net} r={t.r} currency={ctx.currency} openedAt={t.openedAt} closedAt={t.closedAt} tz={ctx.tz} session={t.session} actions={nav} />

      <div className={cn("grid grid-cols-2 gap-x-6 gap-y-4 rounded-[var(--radius-inner)] bg-surface-2/60 p-4 ring-1 ring-line ring-inset sm:grid-cols-4 xl:grid-cols-8")}>
        <Stat label="Entry → exit" value={<span className="text-[15px]">{price(t.entry)} → {price(t.exit)}</span>} detail={`${fmtNum(t.volume, 2)} lot`} />
        <Stat label="SL / TP" value={<span className="text-[15px]">{price(t.sl0)} / {price(t.tp0)}</span>} detail={plannedR ? `แผน RR 1:${plannedR.toFixed(1)}` : t.sl0 ? "ไม่ได้ตั้ง TP" : "ไม่ได้ตั้ง SL"} />
        <Stat label="Risk" value={t.riskMoney ? fmtMoney(t.riskMoney, ctx.currency) : "–"} detail={t.r !== null ? `ผล ${fmtR(t.r)}` : "ต้องมี SL ถึงจะคิด R ได้"} />
        <Stat label="ถือ" value={fmtDuration(t.durationSec)} detail={CLOSED_BY[t.closeReason ?? "other"]} />
        <Stat label="Pips" value={fmtNum(t.pips, 1, true)} />
        <Stat label="MAE" value={<span className="text-red-ink">{t.mae?.r != null ? fmtR(-Math.abs(t.mae.r ?? 0)) : "–"}</span>} detail="ราคาสวนทางมากสุด" />
        <Stat label="MFE" value={<span className="text-green-ink">{t.mfe?.r != null ? fmtR(Math.abs(t.mfe.r ?? 0)) : "–"}</span>} detail={t.mfe?.r && t.r !== null && t.mfe.r > 0 ? `เก็บได้ ${Math.round((Math.max(0, t.r) / t.mfe.r) * 100)}%` : "ราคาไปทางเรามากสุด"} />
        <Stat label="ค่าธรรมเนียม" value={<Pnl value={t.fees} currency={ctx.currency} arrow={false} />} detail={`ก่อนหักค่าธรรมเนียม ${fmtMoney(t.gross, ctx.currency, { sign: true })}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          <Card className="p-4 sm:p-5">
            <CardHead label="กราฟ" />
            <TradeChart
              bars={d.bars}
              trade={{ side: t.side, openedAt: t.openedAt, closedAt: t.closedAt, entry: t.entry, exit: t.exit, sl0: t.sl0, tp0: t.tp0, slHistory: t.slHistory, outcome: t.outcome }}
              evidence={d.evidence}
              tz={ctx.tz}
              height={inModal ? 360 : 420}
            />
          </Card>
          <Card>
            <CardHead label="แท่งเทียนบอกอะไร" action={<span className="text-[11px] text-fg-3">คำนวณจากข้อมูลจริง ไม่ใช่ AI · คลิกเพื่อดูบนกราฟ</span>} />
            <EvidenceList items={d.evidence} news={d.news} coverage={d.coverage} tz={ctx.tz} />
          </Card>
          <Card>
            <CardHead label="รายการ deal" />
            <div className="-mx-1 overflow-x-auto">
              <table className="num w-full min-w-[520px] text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] text-fg-3">
                    <th className="px-1 pb-2 font-medium">เวลา</th>
                    <th className="px-1 pb-2 font-medium">Deal</th>
                    <th className="px-1 pb-2 text-right font-medium">Volume</th>
                    <th className="px-1 pb-2 text-right font-medium">ราคา</th>
                    <th className="px-1 pb-2 text-right font-medium">กำไร</th>
                    <th className="px-1 pb-2 text-right font-medium">ค่าธรรมเนียม</th>
                  </tr>
                </thead>
                <tbody>
                  {t.executions.map((e) => (
                    <tr key={e.ticket} className="border-t border-line">
                      <td className="px-1 py-2 text-fg-2">{fmtTime(e.t, ctx.tz)}</td>
                      <td className="px-1 py-2">
                        <span className={e.side === "long" ? "text-green-ink" : "text-red-ink"}>{e.side === "long" ? "Buy" : "Sell"}</span> <span className="text-fg-3">{e.entry}</span>
                      </td>
                      <td className="px-1 py-2 text-right">{fmtNum(e.volume, 2)}</td>
                      <td className="px-1 py-2 text-right">{price(e.price)}</td>
                      <td className="px-1 py-2 text-right">{e.entry === "in" ? <span className="text-fg-3">–</span> : <Pnl value={e.profit} currency={ctx.currency} arrow={false} />}</td>
                      <td className="px-1 py-2 text-right text-fg-3">{fmtMoney(e.fees, ctx.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {t.slHistory.length > 1 && (
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">การเลื่อน SL / TP</div>
                <ul className="num flex flex-col gap-1 text-[12.5px] text-fg-2">
                  {t.slHistory.map((h, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-11 text-fg-3">{fmtTime(h.t, ctx.tz)}</span>
                      <span>SL {price(h.sl || null)}</span>
                      <span>TP {price(h.tp || null)}</span>
                      {i > 0 && h.sl === t.entry && <span className="text-amber">break-even</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <Card ai>
            <AiPanel
              kind="trade"
              payload={{ tradeId: t.id }}
              scopeKey={`trade:${t.id}`}
              report={d.report}
              versions={d.versions}
              cites={d.cites}
              title="ทำไมชนะหรือแพ้"
              label={`${t.symbol} ${t.side === "long" ? "Buy" : "Sell"}`}
              emptyNote={t.source === "demo" ? "เทรดตัวอย่าง ลองกดวิเคราะห์เพื่อดูว่าโค้ชทำงานยังไง" : "รัน 30 นาทีหลังปิดออเดอร์ หรือทันทีที่คุณแท็ก setup และอารมณ์"}
            />
          </Card>
          <Card>
            <TradeJournal tradeId={t.id} initial={t.journal} tags={d.tags} />
          </Card>
        </div>
      </div>
    </div>
  );
}
