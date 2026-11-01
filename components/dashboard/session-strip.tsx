"use client";

import { Tip } from "@/components/ui/tooltip";
import { fmtNum, fmtPct, fmtTime } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import { useNow } from "@/lib/ui/use-now";

interface Span {
  id: string;
  label: string;
  start: number;
  end: number;
  kzStart?: number;
  kzEnd?: number;
  n: number;
  avgR: number | null;
  winRate: number | null;
}
interface News {
  id: string;
  t: number;
  currency: string;
  name: string;
  importance: string;
}

function inMin(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 60 ? `${m} นาที` : `${Math.floor(m / 60)} ชม. ${String(m % 60).padStart(2, "0")} นาที`;
}

/** 24 h of the trading day in local time: sessions, killzones, your edge in each, news pins and a now marker. */
export function SessionStrip({ sessions, news, tz, minSample, title }: { sessions: Span[]; news: News[]; tz: string; minSample: number; title: string }) {
  const now = useNow();
  if (!sessions.length) return null;
  const start = Math.min(...sessions.map((s) => s.start)) - 60 * 60_000;
  const end = start + 24 * 3_600_000;
  const pos = (t: number) => `${Math.min(100, Math.max(0, ((t - start) / (end - start)) * 100))}%`;
  const ticks = Array.from({ length: 9 }, (_, i) => start + i * 3 * 3_600_000);
  const dayNews = news.filter((n) => n.t >= start && n.t <= end);

  let next = "";
  if (now) {
    const upcoming = sessions.flatMap((s) => (s.kzStart ? [{ label: `${s.label} killzone`, t: s.kzStart }] : [])).filter((x) => x.t > now).sort((a, b) => a.t - b.t)[0];
    const activeKz = sessions.find((s) => s.kzStart && s.kzEnd && now >= s.kzStart && now < s.kzEnd);
    const nextNews = news.filter((n) => n.t > now && n.importance === "high").sort((a, b) => a.t - b.t)[0];
    next = [activeKz ? `ตอนนี้อยู่ใน ${activeKz.label} killzone` : upcoming ? `${upcoming.label} อีก ${inMin(upcoming.t - now)}` : "", nextNews ? `ข่าว ${nextNews.currency} ${nextNews.name} อีก ${inMin(nextNews.t - now)}` : ""].filter(Boolean).join(" · ");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[13px] font-medium text-fg-2">{title}</div>
        <div className="num min-h-5 text-[13px] text-fg">{next || " "}</div>
      </div>
      <div className="relative h-[58px]">
        <div className="absolute inset-x-0 top-0 h-10 rounded-[12px] bg-surface-3/60 ring-1 ring-line ring-inset" />
        {sessions.map((s) => {
          const good = s.n >= minSample && (s.avgR ?? 0) > 0.1;
          const bad = s.n >= minSample && (s.avgR ?? 0) < -0.05;
          return (
            <Tip
              key={s.id}
              content={
                <span>
                  <span className="font-medium text-fg">{s.label}</span> {fmtTime(s.start, tz)}–{fmtTime(s.end, tz)}
                  {s.kzStart && s.kzEnd && (
                    <span className="block">
                      Killzone {fmtTime(s.kzStart, tz)}–{fmtTime(s.kzEnd, tz)}
                    </span>
                  )}
                  <span className="mt-1 block">{s.n ? `สถิติของคุณ: n=${s.n} · win ${fmtPct((s.winRate ?? 0) * 100, 0)} · เฉลี่ย ${fmtNum(s.avgR, 2, true)}R${s.n < minSample ? " (ข้อมูลยังน้อย)" : ""}` : "ยังไม่มีเทรดใน session นี้"}</span>
                </span>
              }
            >
              <button
                type="button"
                className={cn("absolute top-1 flex h-8 items-center overflow-hidden rounded-[9px] px-2 text-left text-[11px] font-medium ring-1 ring-inset", good ? "bg-green-soft text-green-ink ring-green/20" : bad ? "bg-red-soft text-red-ink ring-red/20" : "bg-metal-soft text-fg-2 ring-line")}
                style={{ left: pos(s.start), width: `calc(${pos(s.end)} - ${pos(s.start)})` }}
              >
                {s.kzStart && s.kzEnd && <span className={cn("absolute inset-y-0 opacity-60", good ? "bg-green/25" : bad ? "bg-red/20" : "bg-metal/20")} style={{ left: `${((s.kzStart - s.start) / (s.end - s.start)) * 100}%`, width: `${((s.kzEnd - s.kzStart) / (s.end - s.start)) * 100}%` }} />}
                <span className="relative truncate">
                  {s.label}
                  {s.n > 0 && <span className="num ml-1 opacity-75">{fmtNum(s.avgR, 2, true)}R</span>}
                </span>
              </button>
            </Tip>
          );
        })}
        {dayNews.map((n) => (
          <Tip key={n.id} content={<span><span className="font-medium text-fg">{fmtTime(n.t, tz)} {n.currency}</span> {n.name} · {n.importance}</span>}>
            <button type="button" aria-label={`${n.currency} ${n.name}`} className="absolute top-[30px] -ml-[5px] size-[10px] rotate-45 rounded-[2px] ring-2 ring-surface" style={{ left: pos(n.t), background: n.importance === "high" ? "var(--amber)" : "color-mix(in oklab, var(--amber) 45%, var(--surface))" }} />
          </Tip>
        ))}
        {now && now >= start && now <= end && (
          <div className="pointer-events-none absolute -top-1 bottom-4 w-[2px] -translate-x-1/2 rounded-full bg-blue" style={{ left: pos(now) }}>
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-full bg-blue" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-3">
          {ticks.map((t, i) => (
            <span key={t} className={cn("num absolute text-[10px] text-fg-3", i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: pos(t) }}>
              {fmtTime(t, tz)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
