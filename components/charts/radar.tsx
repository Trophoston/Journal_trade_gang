"use client";

import { useState } from "react";
import type { EdgeAxis } from "@/lib/analytics/edge";
import { cn } from "@/lib/ui/cn";

/** Edge Radar: six 0–100 axes; hover an axis to see its formula. */
export function EdgeRadarChart({ axes, size = 220 }: { axes: EdgeAxis[]; size?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const c = size / 2;
  const R = size / 2 - 34;
  const n = axes.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [c + Math.cos(a) * R * (v / 100), c + Math.sin(a) * R * (v / 100)] as const;
  };
  const poly = axes.map((ax, i) => pt(i, ax.score ?? 0).join(",")).join(" ");
  const h = hover !== null ? axes[hover] : null;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[240px]" role="img" aria-label={axes.map((a) => `${a.label} ${a.score ?? "n/a"}`).join(", ")}>
        {[25, 50, 75, 100].map((ring) => (
          <polygon key={ring} points={axes.map((_, i) => pt(i, ring).join(",")).join(" ")} fill="none" stroke="var(--line)" strokeWidth={1} />
        ))}
        {axes.map((_, i) => {
          const [x, y] = pt(i, 100);
          return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--line)" />;
        })}
        <polygon points={poly} fill="var(--blue-soft)" stroke="var(--blue)" strokeWidth={2} strokeLinejoin="round" style={{ transformOrigin: "center", animation: "bento-in 700ms cubic-bezier(0.22,1,0.36,1) both" }} />
        {axes.map((ax, i) => {
          const [x, y] = pt(i, ax.score ?? 0);
          const [lx, ly] = pt(i, 128);
          return (
            <g key={ax.key} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} className="cursor-default">
              <circle cx={lx} cy={ly} r={20} fill="transparent" />
              {ax.score !== null && <circle cx={x} cy={y} r={hover === i ? 5 : 3.5} fill="var(--blue)" stroke="var(--surface)" strokeWidth={2} />}
              <text x={lx} y={ly - 5} textAnchor="middle" className={cn("text-[11px]", hover === i ? "fill-fg" : "fill-fg-2")}>
                {ax.label}
              </text>
              <text x={lx} y={ly + 9} textAnchor="middle" className="num fill-fg-3 text-[10.5px] font-semibold">
                {ax.score ?? "n/a"}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="min-h-8 text-center text-[12px] text-fg-3">{h ? h.detail : "ชี้ที่แกนเพื่อดูวิธีคิดคะแนน"}</p>
    </div>
  );
}
