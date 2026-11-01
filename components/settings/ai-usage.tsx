"use client";

import { scaleBand, scaleLinear } from "d3-scale";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { ChartTip } from "@/components/charts/tooltip";
import { useSize } from "@/components/charts/use-size";
import { Inset, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/chip";
import { fmtDay } from "@/lib/format";
import type { AiUsageReport } from "@/lib/queries/ai-usage";
import { cn } from "@/lib/ui/cn";
import { useNow } from "@/lib/ui/use-now";

const tok = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function until(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`;
}

/** Requests per day, last 30 quota days. Single violet series (AI); hover shows the day's detail. */
function DailyBars({ days, height = 88 }: { days: AiUsageReport["days"]; height?: number }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.requests + d.limited + d.failed));
  const x = scaleBand<number>().domain(days.map((_, i) => i)).range([0, width]).paddingInner(0.18);
  const y = scaleLinear().domain([0, max]).range([height, 0]);
  const bw = Math.max(1, x.bandwidth());
  const rad = Math.min(4, bw / 2);
  const h = hover !== null ? days[hover] : null;
  const bar = (bx: number, top: number, bottom: number, round: boolean) =>
    round && bottom - top > rad ? `M${bx},${bottom} V${top + rad} Q${bx},${top} ${bx + rad},${top} H${bx + bw - rad} Q${bx + bw},${top} ${bx + bw},${top + rad} V${bottom} Z` : `M${bx},${bottom} V${top} H${bx + bw} V${bottom} Z`;
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Request ของ Gemini ต่อวัน 30 วันล่าสุด" className="block overflow-visible">
          <line x1={0} x2={width} y1={height} y2={height} stroke="var(--line-strong)" />
          {days.map((d, i) => {
            const bx = x(i) ?? 0;
            const okTop = y(d.requests);
            const badTop = y(d.requests + d.limited + d.failed);
            const dim = hover !== null && hover !== i ? 0.45 : 1;
            return (
              <g key={d.day} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} opacity={dim} style={{ transition: "opacity 150ms" }}>
                <rect x={bx - 1} y={0} width={bw + 2} height={height} fill="transparent" />
                {d.requests > 0 && <path d={bar(bx, okTop, height, d.limited + d.failed === 0)} fill="var(--violet)" />}
                {d.limited + d.failed > 0 && <path d={bar(bx, badTop, okTop - (d.requests > 0 ? 2 : 0), true)} fill="var(--red)" />}
                {d.requests + d.limited + d.failed === 0 && <rect x={bx} y={height - 1.5} width={bw} height={1.5} rx={0.75} fill="var(--line-strong)" />}
              </g>
            );
          })}
        </svg>
      )}
      {h && hover !== null && (
        <ChartTip x={(x(hover) ?? 0) + bw / 2} y={0} width={width}>
          <div className="text-fg-3">{fmtDay(h.day, true)}</div>
          <div className="num font-semibold">{h.requests} request</div>
          <div className="num text-fg-3">{tok(h.tokens)} token</div>
          {h.limited > 0 && <div className="num text-red-ink">ชน rate limit {h.limited}</div>}
          {h.failed > 0 && <div className="num text-red-ink">ล้มเหลว {h.failed}</div>}
        </ChartTip>
      )}
    </div>
  );
}

export function AiUsagePanel({ u }: { u: AiUsageReport }) {
  const now = useNow();
  const limitedRecently = u.lastLimitedAt !== null && now !== null && now - u.lastLimitedAt < 3 * 3_600_000;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-fg-3">
        <Badge tone="green">Free tier · $0</Badge>
        {limitedRecently && <Badge tone="red">ชน rate limit ใน 3 ชม. ล่าสุด</Badge>}
        <span>
          Quota รายวันรีเซ็ตตอนเที่ยงคืนเวลา Pacific{now !== null ? ` · อีก ${until(u.resetsAt - now)}` : ""}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Request วันนี้" value={u.today.requests} detail={u.today.limited ? `ชน rate limit ${u.today.limited}` : `${u.lastMinute} ในนาทีล่าสุด`} />
        <Stat label="Token วันนี้" value={tok(u.today.tokens)} detail={`เข้า ${tok(u.today.input)} · ออก ${tok(u.today.output)}`} />
        <Stat label="30 วันล่าสุด" value={`${u.month.requests} req`} detail={`${tok(u.month.tokens)} token`} />
        <Stat label="ทั้งหมด" value={`${u.allTime.requests} req`} detail={u.allTime.since ? `ตั้งแต่ ${fmtDay(new Date(u.allTime.since).toISOString().slice(0, 10), true)}` : "ยังไม่มี"} />
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between text-[12px] text-fg-3">
          <span>Request ต่อวัน · 30 วันล่าสุด</span>
          <span className="flex items-center gap-3">
            <span>
              <span className="mr-1 inline-block size-2 rounded-full bg-violet" />
              ตอบแล้ว
            </span>
            <span>
              <span className="mr-1 inline-block size-2 rounded-full bg-red" />
              ชน limit / ล้มเหลว
            </span>
          </span>
        </div>
        <DailyBars days={u.days} />
      </div>

      <Inset className="overflow-x-auto p-0">
        <table className="num w-full min-w-[480px] text-[13px]">
          <caption className="sr-only">การใช้ Gemini แยกตาม model</caption>
          <thead>
            <tr className="text-left text-[12px] text-fg-3">
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 text-right font-medium">วันนี้</th>
              <th className="px-3 py-2 text-right font-medium">Token วันนี้</th>
              <th className="px-3 py-2 text-right font-medium">30 วัน</th>
              <th className="px-3 py-2 text-right font-medium">ชน limit</th>
            </tr>
          </thead>
          <tbody>
            {u.models.map((m) => (
              <tr key={m.model} className="border-t border-line">
                <td className="px-3 py-2">
                  <span className="font-mono text-[12.5px]">{m.model}</span>
                  {m.roles.length > 0 && <span className="ml-2 text-[11.5px] text-fg-3">{m.roles.join(" · ")}</span>}
                </td>
                <td className="px-3 py-2 text-right">{m.today.requests}</td>
                <td className="px-3 py-2 text-right text-fg-2">{tok(m.today.tokens)}</td>
                <td className="px-3 py-2 text-right text-fg-2">{m.month.requests}</td>
                <td className={cn("px-3 py-2 text-right", m.month.limited ? "text-red-ink" : "text-fg-3")}>{m.month.limited || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Inset>

      {u.kinds.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] text-fg-3">ใช้ไปกับอะไร · 30 วันล่าสุด</div>
          <ul className="flex flex-col gap-1.5">
            {u.kinds.map((k) => {
              const share = u.month.tokens ? k.tokens / u.month.tokens : 0;
              return (
                <li key={k.kind} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
                  <span className="truncate">{k.label}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                    <span className="block h-full rounded-full bg-violet" style={{ width: `${Math.max(2, share * 100)}%` }} />
                  </span>
                  <span className="num text-right text-fg-3">
                    {k.requests} req · {tok(k.tokens)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-[12.5px] leading-relaxed text-fg-3">
        Trade Gang นับจากทุก call ที่ใช้ key ของคุณ รวม thinking token ในยอดรวมแล้ว Google ไม่ได้ประกาศ limit ของ free tier แบบตายตัวต่อ model ดู limit ต่อนาทีและต่อวันที่แท้จริงได้ใน{" "}
        <a href="https://aistudio.google.com/rate-limit?timeRange=last-28-days" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-ink hover:underline">
          AI Studio <ExternalLink className="size-3" />
        </a>
         เมื่อ model ไหนชน limit, Trade Gang จะสลับไปใช้ Lite model และลองใหม่ภายหลัง
      </p>
    </div>
  );
}
