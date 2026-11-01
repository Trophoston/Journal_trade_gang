"use client";

import { Check, Minus, Newspaper, X } from "lucide-react";
import { focusEvidence } from "@/components/ai/cite";
import type { EvidenceItem } from "@/lib/domain/types";
import { fmtTime } from "@/lib/format";
import { cn } from "@/lib/ui/cn";

const KIND: Record<EvidenceItem["kind"], string> = {
  fvg: "FVG",
  sweep: "Liquidity sweep",
  structure: "Structure",
  stop_hunt: "Stop hunt",
  excursion: "MAE / MFE",
  volatility: "Volatility",
  trend: "Trend",
  news: "ข่าว",
  level: "แนวราคา",
  sl_management: "การจัดการ SL",
};

/** What the detectors found, in plain words. Clicking an item shows it on the chart. */
export function EvidenceList({ items, news, coverage, tz }: { items: EvidenceItem[]; news: { id: string; t: number; currency: string; name: string; importance: string; actual: number | null; forecast: number | null }[]; coverage: string[]; tz: string }) {
  return (
    <div className="flex flex-col gap-4">
      {items.length ? (
        <ul className="-mx-2 flex flex-col">
          {items.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => focusEvidence(e.id)} className="flex w-full items-start gap-3 rounded-[12px] px-2 py-2 text-left transition-colors hover:bg-surface-3/70">
                <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full [&_svg]:size-3", e.polarity === "supports" ? "bg-green-soft text-green-ink" : e.polarity === "against" ? "bg-red-soft text-red-ink" : "bg-metal-soft text-fg-3")}>
                  {e.polarity === "supports" ? <Check strokeWidth={3} /> : e.polarity === "against" ? <X strokeWidth={3} /> : <Minus strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium">
                    <span className="rounded-[5px] bg-blue-soft px-1 font-mono text-[10.5px] font-semibold text-blue-ink">{e.id}</span>
                    {e.title}
                    <span className="text-[11px] font-normal text-fg-3">
                      {KIND[e.kind]}
                      {e.tf ? ` · ${e.tf}` : ""}
                      {e.t ? ` · ${fmtTime(e.t, tz)}` : ""}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-fg-2">{e.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-fg-3">{coverage.length ? "ไม่พบ sweep, FVG หรือ structure shift ใกล้จุดเข้า" : "รอแท่งเทียนจาก MT5 เพื่อตรวจเทรดนี้"}</p>
      )}
      {news.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-fg-3 uppercase">
            <Newspaper className="size-3.5" /> ข่าว ±2 ชม.
          </div>
          <ul className="flex flex-col gap-1">
            {news.map((n) => (
              <li key={n.id} className="flex items-center gap-2 text-[12.5px]">
                <span className="rounded-[5px] bg-[color-mix(in_oklab,var(--amber)_15%,transparent)] px-1 font-mono text-[10.5px] font-semibold text-fg-2">{n.id}</span>
                <span className="num w-11 shrink-0 text-fg-3">{fmtTime(n.t, tz)}</span>
                <span className={cn("size-1.5 shrink-0 rounded-full", n.importance === "high" ? "bg-red" : "bg-amber")} aria-label={`ผลกระทบ ${n.importance === "high" ? "สูง" : n.importance === "medium" ? "กลาง" : "ต่ำ"}`} />
                <span className="min-w-0 flex-1 truncate">
                  {n.currency} {n.name}
                </span>
                {n.actual !== null && (
                  <span className="num shrink-0 text-[11px] text-fg-3">
                    {n.actual} / f {n.forecast ?? "–"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
