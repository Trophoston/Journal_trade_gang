"use client";

import { ArrowRight, Check, CircleAlert, Clock, Newspaper, ShieldAlert, Target, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/chip";
import { adoptRule } from "@/lib/actions/settings";
import { DRIVER_LABEL, type Brief, type DailyReview, type PreTrade, type TradeAnalysis, type WeeklyReview } from "@/lib/ai/schemas";
import type { ReportKind } from "@/lib/ai/types";
import { cn } from "@/lib/ui/cn";
import { Cite } from "./cite";
import { TradeSummary } from "./trade-ref";

const VERDICT: Record<TradeAnalysis["verdict"], { label: string; tone: "green" | "amber" | "metal" | "red" }> = {
  good_win: { label: "ชนะแบบดี", tone: "green" },
  lucky_win: { label: "ชนะเพราะดวง", tone: "amber" },
  good_loss: { label: "แพ้แบบดี", tone: "metal" },
  bad_loss: { label: "แพ้แบบไม่ดี", tone: "red" },
  breakeven: { label: "Break-even", tone: "metal" },
};

function Section({ title, icon, children, className }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-fg-3 uppercase [&_svg]:size-3.5">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function List({ items, mark }: { items: string[]; mark: "good" | "bad" | "dot" | "rule" }) {
  if (!items.length) return <p className="text-[13px] text-fg-3">–</p>;
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-fg-2">
          <span className={cn("mt-[3px] grid size-4 shrink-0 place-items-center rounded-full [&_svg]:size-2.5", mark === "good" ? "bg-green-soft text-green-ink" : mark === "bad" ? "bg-red-soft text-red-ink" : mark === "rule" ? "bg-violet-soft text-violet-ink" : "bg-metal-soft text-fg-3")}>
            {mark === "good" ? <Check strokeWidth={3} /> : mark === "bad" ? <X strokeWidth={3} /> : mark === "rule" ? <Target strokeWidth={3} /> : <span className="size-1 rounded-full bg-current" />}
          </span>
          <Cite text={t} />
        </li>
      ))}
    </ul>
  );
}

export function AdoptButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (!text) return null;
  return (
    <button
      type="button"
      disabled={done || pending}
      onClick={() =>
        start(async () => {
          await adoptRule(text);
          setDone(true);
          toast.success("เพิ่มเข้ากฎของคุณแล้ว", { description: text });
        })
      }
      className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium transition-colors", done ? "bg-green-soft text-green-ink" : "bg-violet-soft text-violet-ink hover:bg-violet hover:text-white")}
    >
      {done ? <Check className="size-3.5" /> : <Target className="size-3.5" />}
      {done ? "รับเป็นกฎแล้ว" : "รับเป็นกฎ"}
    </button>
  );
}

function Score({ label, value, max = 10 }: { label: string; value: number; max?: number }) {
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-fg-3">{label}</span>
        <span className="num font-semibold text-fg">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full origin-left rounded-full bg-violet transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ transform: `scaleX(${pct})` }} />
      </div>
    </div>
  );
}

function TradeView({ c }: { c: TradeAnalysis }) {
  const v = VERDICT[c.verdict];
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone={v.tone}>{v.label}</Badge>
          <Badge tone="violet">{DRIVER_LABEL[c.primaryDriver.type]}</Badge>
          <Badge>confidence: {c.primaryDriver.confidence}</Badge>
        </div>
        <p className="text-[17px] leading-snug font-semibold tracking-tight text-balance">{c.headline}</p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-fg-2">
          <Cite text={c.primaryDriver.explanation} />
        </p>
      </div>
      {c.secondaryDrivers.length > 0 && (
        <Section title="ปัจจัยอื่นที่มีผล">
          <ul className="space-y-1.5">
            {c.secondaryDrivers.map((d, i) => (
              <li key={i} className="text-[13.5px] leading-relaxed text-fg-2">
                <span className="font-medium text-fg">{DRIVER_LABEL[d.type]}</span> · <Cite text={d.explanation} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Section title="สิ่งที่ทำได้ดี">
          <List items={c.wentWell} mark="good" />
        </Section>
        <Section title="สิ่งที่ควรปรับ">
          <List items={c.toImprove} mark="bad" />
        </Section>
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
        <Score label="Entry" value={c.scores.entry} />
        <Score label="Exit" value={c.scores.exit} />
        <Score label="Risk" value={c.scores.risk} />
        <Score label="วินัย" value={c.scores.discipline} />
      </div>
      <div className="rounded-[var(--radius-inner)] bg-violet-soft/70 p-3.5 ring-1 ring-violet/15 ring-inset">
        <div className="text-[11px] font-semibold tracking-wide text-violet-ink uppercase">บทเรียน</div>
        <p className="mt-1 text-[14px] leading-relaxed font-medium">
          <Cite text={c.lesson} />
        </p>
        {c.ruleSuggestion && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-violet/15 pt-3">
            <p className="text-[13px] text-fg-2">
              <span className="text-fg-3">กฎ: </span>
              {c.ruleSuggestion}
            </p>
            <AdoptButton text={c.ruleSuggestion} />
          </div>
        )}
      </div>
      {c.dataGaps.length > 0 && (
        <p className="flex gap-2 text-[12px] text-fg-3">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          Missing: {c.dataGaps.join(" · ")}
        </p>
      )}
    </div>
  );
}

function ScoreRing({ value }: { value: number }) {
  const r = 22;
  const len = 2 * Math.PI * r;
  return (
    <div className="relative grid size-14 shrink-0 place-items-center">
      <svg viewBox="0 0 56 56" className="absolute inset-0 -rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="5" />
        <circle cx="28" cy="28" r={r} fill="none" stroke="var(--violet)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(value / 100) * len} ${len}`} />
      </svg>
      <span className="num text-[15px] font-semibold">{value}</span>
    </div>
  );
}

function DailyView({ c }: { c: DailyReview }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-4">
        <ScoreRing value={c.score} />
        <div className="min-w-0">
          <p className="text-[17px] leading-snug font-semibold tracking-tight text-balance">{c.headline}</p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">
            <Cite text={c.summary} />
          </p>
        </div>
      </div>
      {(c.bestTradeId || c.worstTradeId) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {c.bestTradeId && <TradeLink id={c.bestTradeId} label="เทรดที่ดีที่สุด" why={c.bestTradeWhy} tone="green" />}
          {c.worstTradeId && <TradeLink id={c.worstTradeId} label="เทรดที่แย่ที่สุด" why={c.worstTradeWhy} tone="red" />}
        </div>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Section title="สิ่งที่ทำได้ดี">
          <List items={c.wentWell} mark="good" />
        </Section>
        <Section title="สิ่งที่ควรปรับ">
          <List items={c.toImprove} mark="bad" />
        </Section>
      </div>
      {c.ruleBreaks.length > 0 && (
        <Section title="ทำผิดกฎ" icon={<ShieldAlert />}>
          <List items={c.ruleBreaks} mark="bad" />
        </Section>
      )}
      {c.emotionalNote && (
        <Section title="Mindset">
          <p className="text-[13.5px] text-fg-2"><Cite text={c.emotionalNote} /></p>
        </Section>
      )}
      <div className="rounded-[var(--radius-inner)] bg-violet-soft/70 p-3.5 ring-1 ring-violet/15 ring-inset">
        <div className="text-[11px] font-semibold tracking-wide text-violet-ink uppercase">บทเรียนสำคัญ</div>
        <p className="mt-1 text-[14px] font-medium"><Cite text={c.keyLesson} /></p>
        {c.tomorrowFocus.length > 0 && (
          <div className="mt-3 border-t border-violet/15 pt-3">
            <div className="mb-1.5 text-[12px] text-fg-3">พรุ่งนี้</div>
            <List items={c.tomorrowFocus} mark="rule" />
          </div>
        )}
      </div>
    </div>
  );
}

function TradeLink({ id, label, why, tone }: { id: string; label: string; why: string; tone: "green" | "red" }) {
  return (
    <Link href={`/trades/${encodeURIComponent(id)}`} className="group flex items-start gap-3 rounded-[var(--radius-inner)] bg-surface-2/70 p-3 ring-1 ring-line ring-inset transition-colors hover:bg-surface-3">
      <span className={cn("mt-1 size-2 shrink-0 rounded-full", tone === "green" ? "bg-green" : "bg-red")} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-fg-3">
          {label}
          <TradeSummary id={id} />
        </span>
        <span className="block text-[13px] text-fg-2">{why}</span>
      </span>
      <ArrowRight className="mt-1 size-4 text-fg-3 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function WindowTable({ rows, tone }: { rows: WeeklyReview["strongTimes"]; tone: "green" | "red" }) {
  if (!rows.length) return <p className="text-[13px] text-fg-3">ข้อมูลยังไม่พอ</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="rounded-[12px] bg-surface-2/70 px-3 py-2 ring-1 ring-line ring-inset">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn("text-[13px] font-medium", tone === "green" ? "text-green-ink" : "text-red-ink")}>{r.window}</span>
            <span className="num text-[12px] text-fg-3">{r.stat}</span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-fg-2"><Cite text={r.comment} /></p>
        </li>
      ))}
    </ul>
  );
}

const SETUP_VERDICT = { keep: "green", refine: "amber", drop: "red", not_enough_data: "metal" } as const;

function WeeklyView({ c }: { c: WeeklyReview }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-4">
        <ScoreRing value={c.score} />
        <div className="min-w-0">
          <p className="text-[17px] leading-snug font-semibold tracking-tight text-balance">{c.headline}</p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-2">
            <Cite text={c.summary} />
          </p>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Section title="จุดแข็ง">
          <List items={c.strengths.map((s) => `${s.title} — ${s.detail} ${s.evidence}`)} mark="good" />
        </Section>
        <Section title="จุดอ่อน">
          <List items={c.weaknesses.map((s) => `${s.title} — ${s.detail} ${s.evidence}`)} mark="bad" />
        </Section>
        <Section title="ช่วงเวลาที่ดี" icon={<Clock />}>
          <WindowTable rows={c.strongTimes} tone="green" />
        </Section>
        <Section title="ช่วงเวลาที่แย่" icon={<Clock />}>
          <WindowTable rows={c.weakTimes} tone="red" />
        </Section>
      </div>
      {c.setups.length > 0 && (
        <Section title="Setups">
          <ul className="space-y-1.5">
            {c.setups.map((s, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2 text-[13.5px] text-fg-2">
                <span className="font-medium text-fg">{s.name}</span>
                <Badge tone={SETUP_VERDICT[s.verdict]}>{s.verdict.replace(/_/g, " ")}</Badge>
                <Cite text={s.comment} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {c.mistakesCost.length > 0 && (
        <Section title="ข้อผิดพลาดทำให้เสียเท่าไร">
          <ul className="space-y-1.5">
            {c.mistakesCost.map((m, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2 text-[13.5px] text-fg-2">
                <span className="font-medium text-fg">{m.mistake}</span>
                <span className="num text-red-ink">{m.cost}</span>
                <Cite text={m.comment} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {c.behavior.length > 0 && (
        <Section title="พฤติกรรม">
          <List items={c.behavior} mark="dot" />
        </Section>
      )}
      <Section title="แผนของสัปดาห์ก่อน">
        <p className="text-[13.5px] text-fg-2"><Cite text={c.lastWeekPlanCheck} /></p>
      </Section>
      <div className="rounded-[var(--radius-inner)] bg-violet-soft/70 p-3.5 ring-1 ring-violet/15 ring-inset">
        <div className="text-[11px] font-semibold tracking-wide text-violet-ink uppercase">สัปดาห์หน้า · {c.focus}</div>
        <ul className="mt-2 space-y-2">
          {c.nextWeekRules.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px] font-medium">
              <span>{r}</span>
              <AdoptButton text={r} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const STANCE = {
  go: { label: "Go", sub: "สภาพตลาดเข้าทาง edge ของคุณ", tone: "bg-green-soft text-green-ink ring-green/25" },
  caution: { label: "Caution", sub: "ลด size และเทรดเฉพาะ setup A+", tone: "bg-[color-mix(in_oklab,var(--amber)_15%,transparent)] text-fg ring-[color-mix(in_oklab,var(--amber)_35%,transparent)]" },
  stop: { label: "Stop", sub: "กฎของคุณบอกว่าพอแล้วสำหรับวันนี้", tone: "bg-red-soft text-red-ink ring-red/25" },
};

export function BriefView({ c, compact }: { c: Brief; compact?: boolean }) {
  const s = STANCE[c.stance];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className={cn("inline-flex h-9 items-center rounded-[12px] px-3.5 text-[15px] font-semibold ring-1 ring-inset", s.tone)}>{s.label}</span>
        <p className="min-w-0 text-[15px] leading-snug font-semibold tracking-tight text-balance">{c.headline}</p>
      </div>
      {c.bestWindows.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {c.bestWindows.slice(0, compact ? 2 : 3).map((w, i) => (
            <div key={i} className="rounded-[12px] bg-surface-2/70 px-3 py-2 ring-1 ring-line ring-inset">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium">{w.window}</span>
                <span className="num text-[12px] text-fg-3">{w.localTime}</span>
              </div>
              <div className="mt-0.5 text-[12px] text-fg-3"><Cite text={w.why} /></div>
            </div>
          ))}
        </div>
      )}
      {!compact && c.reasons.length > 0 && <List items={c.reasons} mark="dot" />}
      {c.newsWatch.length > 0 && (
        <Section title="ข่าวที่ต้องจับตา" icon={<Newspaper />}>
          <ul className="space-y-1">
            {c.newsWatch.slice(0, compact ? 2 : 5).map((n, i) => (
              <li key={i} className="flex gap-2 text-[13px] text-fg-2">
                <span className="num w-11 shrink-0 font-medium text-fg">{n.time}</span>
                <span className="min-w-0">
                  {n.event} <span className="text-fg-3">· {n.advice}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {!compact && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Section title="Checklist">
            <List items={c.checklist} mark="rule" />
          </Section>
          <Section title="สิ่งที่ควรเลี่ยง" icon={<TriangleAlert />}>
            <List items={c.avoid} mark="bad" />
          </Section>
        </div>
      )}
    </div>
  );
}

const FIT = { "A+": "bg-green-soft text-green-ink", B: "bg-blue-soft text-blue-ink", C: "bg-[color-mix(in_oklab,var(--amber)_15%,transparent)] text-fg", skip: "bg-red-soft text-red-ink" };

function PreTradeView({ c }: { c: PreTrade }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className={cn("grid h-11 min-w-11 place-items-center rounded-[14px] px-2 text-lg font-bold", FIT[c.fit])}>{c.fit}</span>
        <p className="text-[16px] leading-snug font-semibold tracking-tight">{c.headline}</p>
      </div>
      <p className="text-[13.5px] text-fg-2">
        <Cite text={c.historicalMatch} />
      </p>
      <div className="grid gap-5 sm:grid-cols-2">
        <Section title="เหตุผล">
          <List items={c.reasons} mark="dot" />
        </Section>
        <Section title="ความเสี่ยง">
          <List items={c.risks} mark="bad" />
        </Section>
      </div>
      {c.adjustments.length > 0 && (
        <Section title="ปรับอะไร">
          <List items={c.adjustments} mark="rule" />
        </Section>
      )}
    </div>
  );
}

export function ReportView({ kind, content }: { kind: ReportKind; content: unknown }) {
  if (!content || typeof content !== "object") {
    return <p className="text-sm text-fg-3">รายงานนี้บันทึกไว้ในรูปแบบเก่า</p>;
  }
  if (kind === "trade") return <TradeView c={content as TradeAnalysis} />;
  if (kind === "daily") return <DailyView c={content as DailyReview} />;
  if (kind === "weekly") return <WeeklyView c={content as WeeklyReview} />;
  if (kind === "brief") return <BriefView c={content as Brief} />;
  return <PreTradeView c={content as PreTrade} />;
}
