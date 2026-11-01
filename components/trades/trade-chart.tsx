"use client";

import { CandlestickSeries, createChart, createSeriesMarkers, LineStyle, type IChartApi, type ISeriesApi, type SeriesMarker, type UTCTimestamp } from "lightweight-charts";
import { CandlestickChart } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import type { Bar, EvidenceItem, Timeframe } from "@/lib/domain/types";
import { zoneOffsetMin } from "@/lib/time/zone";
import { cn } from "@/lib/ui/cn";

type TF = "M1" | "M5" | "M15" | "H1";
const TF_SEC: Record<TF, number> = { M1: 60, M5: 300, M15: 900, H1: 3600 };

export interface ChartTrade {
  side: "long" | "short";
  openedAt: number;
  closedAt: number;
  entry: number;
  exit: number | null;
  sl0: number | null;
  tp0: number | null;
  slHistory: { t: number; sl: number; tp: number }[];
  outcome: "win" | "loss" | "be";
}

interface Zone {
  id: string;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  polarity: EvidenceItem["polarity"];
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The theme as the chart canvas needs it (canvas can't read CSS variables). */
function readTheme() {
  return {
    fg3: cssVar("--fg-3"),
    line: cssVar("--line"),
    lineStrong: cssVar("--line-strong"),
    green: cssVar("--green"),
    red: cssVar("--red"),
    blue: cssVar("--blue"),
    violet: cssVar("--violet"),
    metal: cssVar("--metal"),
    amber: cssVar("--amber"),
  };
}

/** Bars arrive in UTC; the chart's axis shows wall-clock time in the user's zone. */
const toLocal = (ms: number, tz: string) => Math.floor((ms + zoneOffsetMin(ms, tz) * 60_000) / 1000) as UTCTimestamp;

/** Snap a time to the bar containing it (markers must sit on an existing bar). */
function snap(bars: Bar[], ms: number) {
  let lo = 0;
  let hi = bars.length - 1;
  if (hi < 0) return null;
  if (ms <= bars[0].t) return bars[0].t;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].t <= ms) lo = mid;
    else hi = mid - 1;
  }
  return bars[lo].t;
}

function defaultTf(bars: Partial<Record<Timeframe, Bar[]>>, durationMs: number): TF {
  if (durationMs < 50 * 60_000 && bars.M1?.length) return "M1";
  if (durationMs < 8 * 3_600_000 && bars.M5?.length) return "M5";
  if (bars.M15?.length) return "M15";
  return (["M5", "H1", "M1"] as TF[]).find((tf) => bars[tf]?.length) ?? "M5";
}

/**
 * Candles around a trade with entry/exit, SL/TP lines, stop moves, FVG zones and sweep markers.
 * Evidence chips elsewhere on the page call `focusEvidence(id)`; the chart pans to it and highlights it.
 */
export function TradeChart({ bars, trade, evidence, tz, height = 380 }: { bars: Partial<Record<Timeframe, Bar[]>>; trade: ChartTrade; evidence: EvidenceItem[]; tz: string; height?: number }) {
  const available = (["M1", "M5", "M15", "H1"] as TF[]).filter((tf) => bars[tf]?.length);
  const [tf, setTf] = useState<TF>(() => defaultTf(bars, trade.closedAt - trade.openedAt));
  const [focus, setFocus] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [themeKey, setThemeKey] = useState(0);
  const data = useMemo(() => bars[tf] ?? [], [bars, tf]);

  const drawn = useMemo(() => evidence.filter((e) => e.t !== undefined && (e.kind === "fvg" ? e.price !== undefined && e.price2 !== undefined : true)), [evidence]);

  // Re-read colors when the theme or palette changes.
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeKey((k) => k + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-palette"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || !data.length) return;
    const c = readTheme();
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: c.fg3, fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: c.line }, horzLines: { color: c.line } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.1 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4, minBarSpacing: 2 },
      crosshair: { vertLine: { color: c.lineStrong, labelBackgroundColor: c.metal }, horzLine: { color: c.lineStrong, labelBackgroundColor: c.metal } },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: c.green,
      downColor: c.red,
      borderVisible: false,
      wickUpColor: c.green,
      wickDownColor: c.red,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    series.setData(data.map((b) => ({ time: toLocal(b.t, tz), open: b.o, high: b.h, low: b.l, close: b.c })));

    const line = (price: number | null, color: string, title: string, style = LineStyle.Dashed) => {
      if (price) series.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title });
    };
    line(trade.entry, c.blue, "Entry", LineStyle.Solid);
    line(trade.sl0, c.red, "SL");
    line(trade.tp0, c.green, "TP");
    const lastSl = trade.slHistory.at(-1)?.sl;
    if (lastSl && lastSl !== trade.sl0) line(lastSl, c.amber, "SL moved", LineStyle.Dotted);

    const markers: SeriesMarker<UTCTimestamp>[] = [];
    const at = (ms: number) => {
      const s = snap(data, ms);
      return s === null ? null : toLocal(s, tz);
    };
    const long = trade.side === "long";
    const tIn = at(trade.openedAt);
    if (tIn) markers.push({ time: tIn, position: long ? "belowBar" : "aboveBar", shape: long ? "arrowUp" : "arrowDown", color: c.blue, text: long ? "Buy" : "Sell", size: 1.2 });
    const tOut = at(trade.closedAt);
    if (tOut) markers.push({ time: tOut, position: long ? "aboveBar" : "belowBar", shape: "circle", color: trade.outcome === "win" ? c.green : trade.outcome === "loss" ? c.red : c.metal, text: "Exit" });
    for (const h of trade.slHistory) {
      const t = at(h.t);
      if (t && h.t > trade.openedAt + 1000) markers.push({ time: t, position: "inBar", shape: "square", color: c.amber, size: 0.6 });
    }
    for (const e of drawn) {
      if (e.kind === "fvg") continue;
      const t = at(e.t!);
      if (!t) continue;
      const color = e.polarity === "supports" ? c.green : e.polarity === "against" ? c.red : c.metal;
      const above = e.price !== undefined ? e.price >= (data.find((b) => toLocal(b.t, tz) === t)?.c ?? e.price) : !long;
      markers.push({ time: t, position: above ? "aboveBar" : "belowBar", shape: e.kind === "sweep" ? "arrowDown" : "circle", color, text: e.id, size: 0.8 });
      if (e.kind === "sweep" && !above) markers[markers.length - 1].shape = "arrowUp";
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(series, markers);

    // Frame the trade with some context either side.
    const span = Math.max(trade.closedAt - trade.openedAt, TF_SEC[tf] * 1000 * 20);
    const from = toLocal(trade.openedAt - span * 0.8, tz);
    const to = toLocal(trade.closedAt + span * 0.5, tz);
    try {
      chart.timeScale().setVisibleRange({ from, to });
    } catch {
      chart.timeScale().fitContent();
    }

    chartRef.current = chart;
    seriesRef.current = series;

    const layout = () => {
      const ts = chart.timeScale();
      const out: Zone[] = [];
      for (const e of drawn) {
        if (e.kind !== "fvg") continue;
        const t1 = at(e.t!);
        const t2 = at(e.t2 ?? trade.closedAt);
        if (!t1 || !t2) continue;
        const x1 = ts.timeToCoordinate(t1);
        const xEnd = ts.timeToCoordinate(at(Math.max(e.t2 ?? 0, trade.closedAt)) ?? t2);
        const y1 = series.priceToCoordinate(e.price2!);
        const y2 = series.priceToCoordinate(e.price!);
        if (x1 === null || xEnd === null || y1 === null || y2 === null) continue;
        out.push({ id: e.id, x1, x2: Math.max(xEnd, x1 + 6), y1: Math.min(y1, y2), y2: Math.max(y1, y2), polarity: e.polarity });
      }
      setZones(out);
    };
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(layout);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(schedule);
    chart.subscribeCrosshairMove(schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [data, tf, tz, trade, drawn, themeKey]);

  // Evidence chips → pan to the item and highlight it.
  useEffect(() => {
    const onFocus = (ev: Event) => {
      const id = (ev as CustomEvent<string>).detail;
      const item = evidence.find((e) => e.id === id);
      if (!item) return;
      setFocus(id);
      box.current?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const want = item.tf && (["M1", "M5", "M15", "H1"] as string[]).includes(item.tf) && bars[item.tf as TF]?.length ? (item.tf as TF) : tf;
      if (want !== tf) setTf(want);
      if (item.t !== undefined) {
        requestAnimationFrame(() => {
          const chart = chartRef.current;
          if (!chart) return;
          const pad = TF_SEC[want] * 1000 * 24;
          try {
            chart.timeScale().setVisibleRange({ from: toLocal(item.t! - pad, tz), to: toLocal((item.t2 ?? item.t!) + pad, tz) });
          } catch {}
        });
      }
      window.setTimeout(() => setFocus((f) => (f === id ? null : f)), 2600);
    };
    window.addEventListener("tg:evidence", onFocus);
    return () => window.removeEventListener("tg:evidence", onFocus);
  }, [evidence, bars, tf, tz]);

  if (!available.length) {
    return (
      <div className="grid place-items-center gap-2 rounded-[var(--radius-inner)] bg-surface-2/60 px-6 text-center ring-1 ring-line ring-inset" style={{ height }}>
        <div>
          <CandlestickChart className="mx-auto mb-2 size-6 text-fg-3" />
          <p className="text-[13px] font-medium">ยังไม่มีแท่งเทียน</p>
          <p className="mt-1 max-w-xs text-[12px] text-fg-3">EA จะส่งแท่งเทียนของเทรดนี้มาในรอบ heartbeat ถัดไป เปิด MT5 ไว้โดยมี TradeGangSync อยู่บนกราฟ</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Timeframe" size="sm" value={tf} onChange={setTf} options={available.map((v) => ({ value: v, label: v }))} />
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-fg-3">
          <Legend swatch="bg-blue" label="Entry" />
          <Legend swatch="bg-red" label="SL" dashed />
          <Legend swatch="bg-green" label="TP" dashed />
          {trade.slHistory.length > 1 && <Legend swatch="bg-amber" label="เลื่อน SL" />}
          {zones.length > 0 && <Legend swatch="bg-blue/30" label="FVG" block />}
        </div>
      </div>
      <div className="relative" style={{ height }}>
        <div ref={box} className="absolute inset-0" role="img" aria-label={`แท่งเทียน ${tf} รอบเทรดนี้ พร้อมจุดเข้า จุดออก SL และ TP`} />
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {zones.map((z) => {
            const on = focus === z.id;
            const tone = z.polarity === "against" ? "var(--red)" : z.polarity === "supports" ? "var(--blue)" : "var(--metal)";
            return (
              <g key={z.id} style={{ transition: "opacity 300ms" }} opacity={focus && !on ? 0.35 : 1}>
                <rect x={z.x1} y={z.y1} width={z.x2 - z.x1} height={Math.max(2, z.y2 - z.y1)} rx={3} fill={tone} fillOpacity={on ? 0.28 : 0.13} stroke={tone} strokeOpacity={on ? 0.9 : 0.4} strokeWidth={on ? 1.5 : 1} />
                <text x={z.x1 + 5} y={z.y1 + 12} fontSize={10} fontWeight={600} fill={tone} className="font-mono">
                  {z.id} FVG
                </text>
              </g>
            );
          })}
        </svg>
        {focus && !zones.some((z) => z.id === focus) && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-blue px-2.5 py-1 font-mono text-[11px] font-semibold text-white shadow-[var(--shadow-float)]">{focus}</div>
        )}
      </div>
    </div>
  );
}

function Legend({ swatch, label, dashed, block }: { swatch: string; label: string; dashed?: boolean; block?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn(block ? "h-2.5 w-3 rounded-[3px]" : "h-0.5 w-3.5 rounded-full", swatch, dashed && "[mask-image:repeating-linear-gradient(90deg,#000_0_3px,transparent_3px_5px)]")} />
      {label}
    </span>
  );
}
