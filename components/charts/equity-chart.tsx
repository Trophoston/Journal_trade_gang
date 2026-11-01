"use client";

import { scaleLinear, scaleTime } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { bisector, extent } from "d3-array";
import { useMemo, useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { fmtMoney, fmtPct } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import { ChartTip } from "./tooltip";
import { useSize } from "./use-size";

type Range = "1W" | "1M" | "3M" | "YTD" | "ALL";
const DAY = 86_400_000;

/** `fixed`: the points are already a chosen period, so the chart shows them all and hides its own range switch. */
export function EquityChart({ points, currency, tz, height = 220, fixed = false }: { points: { t: number; v: number }[]; currency: string; tz: string; height?: number; fixed?: boolean }) {
  const [picked, setRange] = useState<Range>("3M");
  const range: Range = fixed ? "ALL" : picked;
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const data = useMemo(() => {
    if (!points.length) return [];
    const end = points[points.length - 1].t;
    const from = range === "1W" ? end - 7 * DAY : range === "1M" ? end - 30 * DAY : range === "3M" ? end - 92 * DAY : range === "YTD" ? Date.UTC(new Date(end).getUTCFullYear(), 0, 1) : -Infinity;
    const inRange = points.filter((p) => p.t >= from);
    const before = points.filter((p) => p.t < from).at(-1);
    return before ? [{ t: Math.max(from, before.t), v: before.v }, ...inRange] : inRange;
  }, [points, range]);

  const pad = { l: 4, r: 56, t: 10, b: 24 };
  const w = Math.max(0, width);
  const x = useMemo(() => scaleTime().domain((extent(data, (d) => d.t) as [number, number]) ?? [0, 1]).range([pad.l, w - pad.r]), [data, w, pad.l, pad.r]);
  const y = useMemo(() => {
    const [lo, hi] = extent(data, (d) => d.v) as [number, number];
    const span = (hi - lo) || Math.abs(hi) * 0.02 || 1;
    return scaleLinear().domain([lo - span * 0.08, hi + span * 0.12]).range([height - pad.b, pad.t]).nice(4);
  }, [data, height, pad.b, pad.t]);

  const lineD = data.length > 1 ? line<{ t: number; v: number }>().x((d) => x(d.t)).y((d) => y(d.v)).curve(curveMonotoneX)(data) ?? "" : "";
  const areaD = data.length > 1 ? area<{ t: number; v: number }>().x((d) => x(d.t)).y0(height - pad.b).y1((d) => y(d.v)).curve(curveMonotoneX)(data) ?? "" : "";
  const first = data[0]?.v ?? 0;
  const last = data.at(-1)?.v ?? 0;
  const change = last - first;
  const hp = hover !== null ? data[hover] : null;
  const fmtX = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(t);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = x.invert(e.clientX - r.left + pad.l).getTime();
    const i = bisector<{ t: number }, number>((d) => d.t).center(data, t);
    setHover(i);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="num text-[28px] leading-none font-semibold tracking-[-0.02em]">{fmtMoney(last, currency)}</div>
          <div className={cn("num mt-1.5 text-[13px]", change >= 0 ? "text-green-ink" : "text-red-ink")}>
            {change >= 0 ? "▲" : "▼"} {fmtMoney(change, currency, { sign: true })} <span className="text-fg-3">({fmtPct(first ? (change / first) * 100 : 0, 2, true)}) ในช่วงนี้</span>
          </div>
        </div>
        {!fixed && (
        <Segmented
          label="ช่วงเวลา"
          size="sm"
          value={range}
          onChange={(r) => {
            setRange(r);
            setHover(null);
          }}
          options={(["1W", "1M", "3M", "YTD", "ALL"] as const).map((v) => ({ value: v, label: v === "ALL" ? "ทั้งหมด" : v }))}
        />
        )}
      </div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {w > 0 && data.length > 1 && (
          <svg width={w} height={height} className="block overflow-visible" role="img" aria-label={`Balance จาก ${fmtMoney(first, currency)} เป็น ${fmtMoney(last, currency)}`}>
            <defs>
              <linearGradient id="eq-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.22" />
                <stop offset="100%" stopColor="var(--blue)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <g className="chart-grid">
              {y.ticks(4).map((v) => (
                <line key={v} x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} />
              ))}
            </g>
            <g className="chart-axis">
              {y.ticks(4).map((v) => (
                <text key={v} x={w - pad.r + 8} y={y(v)} dy="0.32em">
                  {fmtMoney(v, currency, { compact: true }).replace(".00", "")}
                </text>
              ))}
              {x.ticks(w < 480 ? 3 : 5).map((d) => (
                <text key={+d} x={x(d)} y={height - 6} textAnchor="middle">
                  {fmtX(+d)}
                </text>
              ))}
            </g>
            <path key={`a-${range}`} d={areaD} fill="url(#eq-fill)" style={{ animation: "appear 600ms ease both" }} />
            <path key={`l-${range}`} d={lineD} fill="none" stroke="var(--blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="draw-in" />
            {hp && (
              <g>
                <line x1={x(hp.t)} x2={x(hp.t)} y1={pad.t} y2={height - pad.b} stroke="var(--line-strong)" strokeDasharray="3 3" />
                <circle cx={x(hp.t)} cy={y(hp.v)} r={4.5} fill="var(--blue)" stroke="var(--surface)" strokeWidth={2} />
              </g>
            )}
            <rect x={pad.l} y={0} width={Math.max(0, w - pad.l - pad.r)} height={height} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
        )}
        {data.length <= 1 && <div className="grid h-full place-items-center text-sm text-fg-3">ประวัติในช่วงนี้ยังไม่พอ</div>}
        {hp && (
          <ChartTip x={x(hp.t)} y={y(hp.v)} width={w}>
            <div className="text-fg-3">{new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(hp.t)}</div>
            <div className="num mt-0.5 text-[14px] font-semibold text-fg">{fmtMoney(hp.v, currency)}</div>
            <div className={cn("num", hp.v - first >= 0 ? "text-green-ink" : "text-red-ink")}>{fmtMoney(hp.v - first, currency, { sign: true })} vs range start</div>
          </ChartTip>
        )}
      </div>
    </div>
  );
}
