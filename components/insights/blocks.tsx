"use client";

import { scaleLinear, scaleTime } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { ChartColumn, Table2 } from "lucide-react";
import { useState } from "react";
import { ChartTip } from "@/components/charts/tooltip";
import { useSize } from "@/components/charts/use-size";
import { Card, CardHead } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import type { BreakdownRow } from "@/lib/analytics/metrics";
import { fmtDate, fmtMoney, fmtNum, fmtPct, fmtR } from "@/lib/format";
import type { HeatCell } from "@/lib/queries/insights";
import { cn } from "@/lib/ui/cn";

type View = "chart" | "table";

/** Card with the same head everywhere: title, sample note and a Chart / Table switch. */
export function ChartCard({ title, note, i, className, chart, table }: { title: string; note?: React.ReactNode; i?: number; className?: string; chart: React.ReactNode; table: React.ReactNode }) {
  const [view, setView] = useState<View>("chart");
  return (
    <Card i={i} className={className}>
      <CardHead
        label={title}
        action={
          <Segmented
            label={`${title}: มุมมอง`}
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: "chart", label: <ChartColumn />, title: "กราฟ" },
              { value: "table", label: <Table2 />, title: "ดูเป็นตาราง" },
            ]}
          />
        }
      />
      {note && <p className="-mt-1 mb-3 text-[12px] text-fg-3">{note}</p>}
      <div className="min-w-0 flex-1">{view === "chart" ? chart : table}</div>
    </Card>
  );
}

const tone = (v: number | null) => (v === null ? "text-fg-3" : v >= 0.05 ? "text-green-ink" : v <= -0.05 ? "text-red-ink" : "text-metal-ink");

export function BreakdownTable({ rows, currency, minN }: { rows: BreakdownRow[]; currency: string; minN: number }) {
  if (!rows.length) return <p className="text-[13px] text-fg-3">ไม่มีเทรดในช่วงนี้</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="num w-full min-w-[420px] text-[12.5px]">
        <thead>
          <tr className="text-left text-[11px] text-fg-3">
            <th className="px-1 pb-2 font-medium">กลุ่ม</th>
            <th className="px-1 pb-2 text-right font-medium">n</th>
            <th className="px-1 pb-2 text-right font-medium">Win rate (90%)</th>
            <th className="px-1 pb-2 text-right font-medium">Avg R</th>
            <th className="px-1 pb-2 text-right font-medium">สุทธิ</th>
            <th className="px-1 pb-2 text-right font-medium">PF</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={cn("border-t border-line", r.n < minN && "text-fg-3")}>
              <td className="max-w-[180px] truncate px-1 py-1.5">{r.label}</td>
              <td className="px-1 py-1.5 text-right">{r.n}</td>
              <td className="px-1 py-1.5 text-right">
                {fmtPct(r.winRate === null ? null : r.winRate * 100, 0)} <span className="text-fg-3">({Math.round(r.wilsonLow * 100)}–{Math.round(r.wilsonHigh * 100)})</span>
              </td>
              <td className={cn("px-1 py-1.5 text-right", tone(r.avgR))}>{fmtR(r.avgR)}</td>
              <td className={cn("px-1 py-1.5 text-right", tone(r.net))}>{fmtMoney(r.net, currency, { sign: true })}</td>
              <td className="px-1 py-1.5 text-right">{r.profitFactor === null ? "–" : Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : "∞"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Diverging bars of average R around zero. Rows below the minimum sample are drawn
 * hatched and labeled, so a lucky 3-trade group never reads as an edge.
 */
export function BreakdownBars({ rows, minN, currency, empty = "ไม่มีเทรดในช่วงนี้" }: { rows: BreakdownRow[]; minN: number; currency: string; empty?: string }) {
  if (!rows.length) return <p className="text-[13px] text-fg-3">{empty}</p>;
  const max = Math.max(0.5, ...rows.map((r) => Math.abs(r.avgR ?? 0)));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const v = r.avgR ?? 0;
        const w = (Math.abs(v) / max) * 50;
        const low = r.n < minN;
        return (
          <li key={r.key} className="group grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[12.5px]" title={`${r.label}: n ${r.n}, ชนะ ${fmtPct(r.winRate === null ? null : r.winRate * 100, 0)}, สุทธิ ${fmtMoney(r.net, currency, { sign: true })}`}>
            <span className="min-w-0">
              <span className={cn("block truncate", low ? "text-fg-3" : "text-fg-2")}>{r.label}</span>
              <span className="num block text-[10.5px] text-fg-3">
                n {r.n}
                {low ? " · ตัวอย่างน้อย" : ` · ${fmtPct(r.winRate === null ? null : r.winRate * 100, 0)} win`}
              </span>
            </span>
            <span className="relative h-5">
              <span className="absolute top-0 bottom-0 left-1/2 w-px bg-line-strong" />
              <span
                className={cn("absolute top-[3px] bottom-[3px] transition-[width,left] duration-500 ease-out", v >= 0 ? "rounded-r-[4px] bg-green" : "rounded-l-[4px] bg-red", low && "opacity-45 [background-image:repeating-linear-gradient(135deg,transparent_0_3px,rgb(255_255_255/0.35)_3px_5px)]")}
                style={{ left: v >= 0 ? "50%" : `${50 - w}%`, width: `${Math.max(w, 0.6)}%` }}
              />
            </span>
            <span className={cn("num w-14 text-right font-medium", low ? "text-fg-3" : tone(r.avgR))}>{fmtR(r.avgR)}</span>
          </li>
        );
      })}
    </ul>
  );
}

const DAYS = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];

/** Hour × weekday, colored by average R (green above zero, red below, metal at zero). */
export function Heatmap({ local, ny, tz, minN, currency }: { local: HeatCell[]; ny: HeatCell[]; tz: string; minN: number; currency: string }) {
  const [zone, setZone] = useState<"local" | "ny">("local");
  const [view, setView] = useState<View>("chart");
  const [hover, setHover] = useState<HeatCell | null>(null);
  const cells = zone === "local" ? local : ny;
  const at = new Map(cells.map((c) => [`${c.wd}:${c.h}`, c]));
  const days = cells.some((c) => c.wd >= 5) ? DAYS : DAYS.slice(0, 5);
  const cap = Math.max(0.5, ...cells.filter((c) => c.n >= 2).map((c) => Math.abs(c.avgR ?? 0)));
  const fill = (c: HeatCell | undefined) => {
    if (!c || c.avgR === null) return undefined;
    // Color strength = size of the edge × confidence from the sample size.
    const k = Math.min(1, Math.abs(c.avgR) / cap) * Math.min(1, 0.35 + (0.65 * c.n) / minN);
    const hue = c.avgR >= 0.05 ? "var(--green)" : c.avgR <= -0.05 ? "var(--red)" : "var(--metal)";
    return `color-mix(in oklab, ${hue} ${Math.round(18 + k * 70)}%, var(--surface-2))`;
  };

  return (
    <Card i={0} className="lg:col-span-12">
      <CardHead
        label="ช่วงเวลาที่คุณเทรดได้ดีที่สุด"
        action={
          <div className="flex items-center gap-2">
            <Segmented
              label="Time zone"
              size="sm"
              value={zone}
              onChange={setZone}
              options={[
                { value: "local", label: tz.split("/").at(-1)!.replace("_", " ") },
                { value: "ny", label: "New York" },
              ]}
            />
            <Segmented
              label="มุมมอง heatmap"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "chart", label: <ChartColumn />, title: "กราฟ" },
                { value: "table", label: <Table2 />, title: "ดูเป็นตาราง" },
              ]}
            />
          </div>
        }
      />
      <p className="-mt-1 mb-3 text-[12px] text-fg-3">R เฉลี่ยตามชั่วโมงที่เปิดเทรด ช่องจางมีเทรดน้อย ช่องลายขีดมีไม่ถึง 3 เทรด</p>
      {view === "table" ? (
        <div className="-mx-1 max-h-[340px] overflow-auto">
          <table className="num w-full text-[12.5px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-[11px] text-fg-3">
                <th className="px-1 pb-2 font-medium">วัน</th>
                <th className="px-1 pb-2 font-medium">ชั่วโมง</th>
                <th className="px-1 pb-2 text-right font-medium">n</th>
                <th className="px-1 pb-2 text-right font-medium">Win</th>
                <th className="px-1 pb-2 text-right font-medium">Avg R</th>
                <th className="px-1 pb-2 text-right font-medium">สุทธิ</th>
              </tr>
            </thead>
            <tbody>
              {[...cells]
                .sort((a, b) => a.wd - b.wd || a.h - b.h)
                .map((c) => (
                  <tr key={`${c.wd}:${c.h}`} className="border-t border-line">
                    <td className="px-1 py-1.5">{DAYS[c.wd]}</td>
                    <td className="px-1 py-1.5">{String(c.h).padStart(2, "0")}:00</td>
                    <td className="px-1 py-1.5 text-right">{c.n}</td>
                    <td className="px-1 py-1.5 text-right">{fmtPct(c.winRate === null ? null : c.winRate * 100, 0)}</td>
                    <td className={cn("px-1 py-1.5 text-right", tone(c.avgR))}>{fmtR(c.avgR)}</td>
                    <td className={cn("px-1 py-1.5 text-right", tone(c.net))}>{fmtMoney(c.net, currency, { sign: true })}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto no-scrollbar">
          <div className="relative min-w-[680px]" onPointerLeave={() => setHover(null)}>
            <div className="grid grid-cols-[40px_repeat(24,minmax(0,1fr))] gap-[3px]">
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="num pb-1 text-center text-[10px] text-fg-3">
                  {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
                </span>
              ))}
              {days.map((d, wd) => (
                <div key={d} className="contents">
                  <span className="flex items-center text-[11px] text-fg-3">{d}</span>
                  {Array.from({ length: 24 }, (_, h) => {
                    const c = at.get(`${wd}:${h}`);
                    const low = c && c.n < 3;
                    return (
                      <span
                        key={h}
                        onPointerEnter={() => setHover(c ?? null)}
                        className={cn("h-7 rounded-[5px] ring-inset transition-transform duration-150", c ? "hover:scale-[1.15] hover:ring-2 hover:ring-fg/40" : "bg-surface-2/50", low && "opacity-60")}
                        style={{ background: fill(c), backgroundImage: low ? "repeating-linear-gradient(135deg, transparent 0 3px, rgb(255 255 255 / 0.16) 3px 4px)" : undefined }}
                        aria-label={c ? `${d} ${h}:00, ${c.n} เทรด, เฉลี่ย ${fmtR(c.avgR)}` : undefined}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            {hover && (
              <div className="glass-chrome pointer-events-none absolute top-0 right-0 z-10 rounded-[12px] px-3 py-2 text-[12px]">
                <div className="relative z-[2]">
                  <div className="font-medium text-fg">
                    {DAYS[hover.wd]} {String(hover.h).padStart(2, "0")}:00
                  </div>
                  <div className="num text-fg-2">
                    n {hover.n} · {fmtPct(hover.winRate === null ? null : hover.winRate * 100, 0)} win · <span className={tone(hover.avgR)}>{fmtR(hover.avgR)}</span>
                  </div>
                  <div className={cn("num", tone(hover.net))}>{fmtMoney(hover.net, currency, { sign: true })}</div>
                </div>
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 text-[11px] text-fg-3">
              <span>ขาดทุน</span>
              <span className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(90deg, var(--red), color-mix(in oklab, var(--metal) 40%, var(--surface-2)), var(--green))" }} />
              <span>กำไร (avg R)</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Distribution of results in R. */
export function RHistogram({ bins }: { bins: { from: number; n: number }[] }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = 180;
  const pad = { l: 4, r: 4, t: 8, b: 22 };
  const max = Math.max(1, ...bins.map((b) => b.n));
  const bw = (Math.max(0, width) - pad.l - pad.r) / bins.length;
  const y = scaleLinear().domain([0, max]).range([h - pad.b, pad.t]);
  const label = (b: { from: number }) => (b.from <= -3 ? "≤ −3R" : b.from >= 5 ? "≥ +5R" : `${fmtNum(b.from, 1, true)} ถึง ${fmtNum(b.from + 0.5, 1, true)}R`);
  return (
    <div ref={ref} className="relative" style={{ height: h }}>
      {width > 0 && (
        <svg width={width} height={h} role="img" aria-label="Histogram ผลเทรดเป็น R">
          {[0.5, 1].map((f) => (
            <line key={f} x1={pad.l} x2={width - pad.r} y1={y(max * f)} y2={y(max * f)} className="chart-grid" />
          ))}
          {bins.map((b, i) => {
            const x = pad.l + i * bw;
            const top = y(b.n);
            const tone = b.from >= 0 ? "var(--green)" : b.from + 0.5 <= 0 ? "var(--red)" : "var(--metal)";
            return (
              <g key={b.from} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={x} y={pad.t} width={bw} height={h - pad.b - pad.t} fill="transparent" />
                {b.n > 0 && <rect x={x + 1} y={top} width={Math.max(1, bw - 2)} height={h - pad.b - top} rx={Math.min(4, bw / 3)} fill={tone} opacity={hover === null || hover === i ? 1 : 0.45} className="transition-opacity" />}
                {(b.from === -3 || b.from === 0 || b.from === 2 || b.from === 5) && (
                  <text x={x + bw / 2} y={h - 6} textAnchor="middle" className="chart-axis">
                    {fmtNum(b.from, 0, true)}R
                  </text>
                )}
              </g>
            );
          })}
          <line x1={pad.l + 6 * bw} x2={pad.l + 6 * bw} y1={pad.t} y2={h - pad.b} stroke="var(--line-strong)" />
        </svg>
      )}
      {hover !== null && (
        <ChartTip x={pad.l + hover * bw + bw / 2} y={y(bins[hover].n)} width={width}>
          <div className="font-medium text-fg">{label(bins[hover])}</div>
          <div className="num text-fg-2">{bins[hover].n} trades</div>
        </ChartTip>
      )}
    </div>
  );
}

/** Underwater curve: how far below the last peak the account was, cash flows removed. */
export function DrawdownChart({ points, tz }: { points: { t: number; dd: number }[]; tz: string }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const h = 180;
  const pad = { l: 4, r: 44, t: 8, b: 22 };
  if (points.length < 2) return <p className="text-[13px] text-fg-3">เทรดในช่วงนี้ยังไม่พอ</p>;
  const x = scaleTime()
    .domain([points[0].t, points[points.length - 1].t])
    .range([pad.l, Math.max(pad.l + 1, width - pad.r)]);
  const lo = Math.min(-0.5, ...points.map((p) => p.dd));
  const y = scaleLinear().domain([lo * 1.1, 0]).range([h - pad.b, pad.t]).nice(3);
  const a = area<{ t: number; dd: number }>().x((d) => x(d.t)).y0(y(0)).y1((d) => y(d.dd)).curve(curveMonotoneX)(points) ?? "";
  const l = line<{ t: number; dd: number }>().x((d) => x(d.t)).y((d) => y(d.dd)).curve(curveMonotoneX)(points) ?? "";
  const hp = hover !== null ? points[hover] : null;
  return (
    <div ref={ref} className="relative" style={{ height: h }}>
      {width > 0 && (
        <svg
          width={width}
          height={h}
          role="img"
          aria-label="Drawdown ตามเวลา"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const t = x.invert(e.clientX - r.left).getTime();
            let best = 0;
            for (let i = 1; i < points.length; i++) if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
            setHover(best);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {y.ticks(3).map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="chart-grid" />
              <text x={width - pad.r + 6} y={y(v) + 4} className="chart-axis">
                {fmtNum(v, 0)}%
              </text>
            </g>
          ))}
          <path d={a} fill="var(--red)" opacity={0.16} />
          <path d={l} fill="none" stroke="var(--red)" strokeWidth={2} className="draw-in" />
          {hp && (
            <>
              <line x1={x(hp.t)} x2={x(hp.t)} y1={pad.t} y2={h - pad.b} stroke="var(--line-strong)" />
              <circle cx={x(hp.t)} cy={y(hp.dd)} r={4} fill="var(--red)" stroke="var(--surface)" strokeWidth={2} />
            </>
          )}
        </svg>
      )}
      {hp && (
        <ChartTip x={x(hp.t)} y={y(hp.dd)} width={width}>
          <div className="text-fg-3">{fmtDate(hp.t, tz)}</div>
          <div className="num font-medium text-fg">{fmtPct(hp.dd, 2)} จากจุดสูงสุด</div>
        </ChartTip>
      )}
    </div>
  );
}
