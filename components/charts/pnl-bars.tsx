"use client";

import { scaleBand, scaleLinear } from "d3-scale";
import { useState } from "react";
import { fmtMoney } from "@/lib/format";
import { ChartTip } from "./tooltip";
import { useSize } from "./use-size";

/** Diverging bars around zero (daily P&L etc.). 2px gaps, rounded data ends anchored at the baseline. */
export function PnlBars({ data, currency, height = 64, label }: { data: { key: string; label: string; value: number; sub?: string }[]; currency: string; height?: number; label: string }) {
  const [ref, { width }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const x = scaleBand<number>().domain(data.map((_, i) => i)).range([0, width]).paddingInner(0.18);
  const y = scaleLinear().domain([-max, max]).range([height, 0]);
  const bw = Math.max(1, x.bandwidth());
  const rad = Math.min(4, bw / 2);
  const zero = y(0);
  const h = hover !== null ? data[hover] : null;
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
          <line x1={0} x2={width} y1={zero} y2={zero} stroke="var(--line-strong)" />
          {data.map((d, i) => {
            const top = d.value >= 0 ? y(d.value) : zero;
            const hgt = Math.max(1.5, Math.abs(y(d.value) - zero));
            const bx = x(i) ?? 0;
            const path =
              d.value >= 0
                ? `M${bx},${zero} V${top + rad} Q${bx},${top} ${bx + rad},${top} H${bx + bw - rad} Q${bx + bw},${top} ${bx + bw},${top + rad} V${zero} Z`
                : `M${bx},${zero} V${zero + hgt - rad} Q${bx},${zero + hgt} ${bx + rad},${zero + hgt} H${bx + bw - rad} Q${bx + bw},${zero + hgt} ${bx + bw},${zero + hgt - rad} V${zero} Z`;
            return (
              <g key={d.key} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <rect x={bx - 1} y={0} width={bw + 2} height={height} fill="transparent" />
                <path d={path} fill={d.value > 0 ? "var(--green)" : d.value < 0 ? "var(--red)" : "var(--metal)"} opacity={hover === null || hover === i ? 1 : 0.45} style={{ transition: "opacity 150ms" }} />
              </g>
            );
          })}
        </svg>
      )}
      {h && hover !== null && (
        <ChartTip x={(x(hover) ?? 0) + bw / 2} y={0} width={width}>
          <div className="text-fg-3">{h.label}</div>
          <div className={`num font-semibold ${h.value >= 0 ? "text-green-ink" : "text-red-ink"}`}>{fmtMoney(h.value, currency, { sign: true })}</div>
          {h.sub && <div className="text-fg-3">{h.sub}</div>}
        </ChartTip>
      )}
    </div>
  );
}
