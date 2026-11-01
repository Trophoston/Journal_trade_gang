"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, ChevronDown, MessageSquareText, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { ThinkingSteps } from "@/components/ai/ai-panel";
import { AdoptButton, ReportView } from "@/components/ai/report-view";
import { Button } from "@/components/ui/button";
import { Badge, Chip } from "@/components/ui/chip";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { preTradeCheck } from "@/lib/actions/ai";
import { removeRule } from "@/lib/actions/settings";
import type { ReportKind } from "@/lib/ai/types";
import { fmtDate, fmtTime } from "@/lib/format";
import type { CoachData, HistoryItem } from "@/lib/queries/coach";
import { cn } from "@/lib/ui/cn";
import { spring } from "@/lib/ui/motion";
import { useStore } from "@/lib/ui/store";

type Filter = "all" | ReportKind | "chat";

const KIND: Record<HistoryItem["kind"], { label: string; tone: "violet" | "blue" | "green" | "amber" | "metal" }> = {
  trade: { label: "เทรด", tone: "blue" },
  daily: { label: "รายวัน", tone: "green" },
  weekly: { label: "รายสัปดาห์", tone: "violet" },
  brief: { label: "Brief", tone: "amber" },
  pretrade: { label: "Pre-trade", tone: "metal" },
  chat: { label: "Chat", tone: "metal" },
};

/** Every AI result, newest first. Nothing here re-runs by itself; open one to read or ask about it. */
export function HistoryTimeline({ items, tz }: { items: HistoryItem[]; tz: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [limit, setLimit] = useState(30);
  const openChat = useStore((s) => s.openChat);
  const shown = items.filter((i) => filter === "all" || i.kind === filter);
  const groups: { day: string; items: HistoryItem[] }[] = [];
  for (const it of shown.slice(0, limit)) {
    const day = fmtDate(new Date(it.at), tz);
    const g = groups.at(-1);
    if (g?.day === day) g.items.push(it);
    else groups.push({ day, items: [it] });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto no-scrollbar">
        <Segmented
          label="กรองประวัติ"
          size="sm"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setOpen(null);
          }}
          options={[
            { value: "all", label: "ทั้งหมด" },
            { value: "trade", label: "เทรด" },
            { value: "daily", label: "รายวัน" },
            { value: "weekly", label: "รายสัปดาห์" },
            { value: "brief", label: "Brief" },
            { value: "pretrade", label: "Pre-trade" },
            { value: "chat", label: "แชต" },
          ]}
        />
      </div>
      {groups.length === 0 && <p className="py-6 text-center text-[13px] text-fg-3">ยังไม่มีอะไรที่นี่</p>}
      {groups.map((g) => (
        <div key={g.day} className="relative pl-5">
          <span className="absolute top-2 bottom-0 left-[5px] w-px bg-line-strong" />
          <span className="absolute top-[7px] left-0 size-[11px] rounded-full bg-surface ring-2 ring-violet/60" />
          <div className="mb-2 text-[12px] font-medium text-fg-3">{g.day}</div>
          <ul className="flex flex-col gap-1.5">
            {g.items.map((it) => {
              const isOpen = open === it.id;
              const k = KIND[it.kind];
              return (
                <motion.li key={it.id} layout="position" transition={spring.smooth} className={cn("rounded-[16px] ring-1 ring-inset transition-colors", isOpen ? "bg-surface-2/80 ring-line-strong" : "ring-transparent hover:bg-surface-3/50")}>
                  <button type="button" aria-expanded={isOpen} onClick={() => (it.kind === "chat" ? openChat({ scopeKey: it.scopeKey, title: it.title, threadId: it.id }) : setOpen(isOpen ? null : it.id))} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                    <Badge tone={k.tone} className="w-[74px] justify-center">
                      {k.label}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{it.title}</span>
                    <span className="num hidden text-[11px] text-fg-3 sm:inline">
                      {it.kind === "chat" ? `${it.messages} ข้อความ · ` : `v${it.version}${it.auto ? " · auto" : ""} · `}
                      {fmtTime(new Date(it.at), tz)}
                    </span>
                    {it.kind === "chat" ? <MessageSquareText className="size-4 text-fg-3" /> : <ChevronDown className={cn("size-4 text-fg-3 transition-transform duration-200", isOpen && "rotate-180")} />}
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.smooth} className="overflow-hidden">
                        <div className="border-t border-line px-4 pt-4 pb-4">
                          <ReportView kind={it.kind as ReportKind} content={it.content} />
                          <div className="mt-4 flex flex-wrap gap-2">
                            {it.href && (
                              <Link href={it.href} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-[13px] font-medium text-fg-2 ring-1 ring-line-strong ring-inset hover:bg-surface-3/60">
                                เปิด <ArrowUpRight className="size-3.5" />
                              </Link>
                            )}
                            <Button size="sm" variant="ghost" className="text-violet-ink" onClick={() => openChat({ scopeKey: it.scopeKey, reportId: it.id, title: it.title })}>
                              <MessageSquareText /> ถามเรื่องนี้
                            </Button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.li>
              );
            })}
          </ul>
        </div>
      ))}
      {shown.length > limit && (
        <Button variant="soft" size="sm" className="self-center" onClick={() => setLimit((l) => l + 30)}>
          ดูเพิ่ม
        </Button>
      )}
    </div>
  );
}

const PRE_KEY = "pretrade:local";
const PRE_STEPS = ["กำลังเทียบประวัติของ setup นี้", "กำลังเช็กกฎและผลวันนี้", "กำลังเช็กปฏิทินข่าว", "Gemini กำลังชั่งน้ำหนักเทรดนี้"];

/** Ask before you click Buy: how have trades like this gone for you? */
export function PreTradeForm({ form }: { form: CoachData["form"] }) {
  const [symbol, setSymbol] = useState(form.symbols[0] ?? "XAUUSD");
  const [side, setSide] = useState<"long" | "short">("long");
  const [setup, setSetup] = useState(form.setups[0] ?? "");
  const [conf, setConf] = useState<string[]>([]);
  const [risk, setRisk] = useState(String(form.riskPct));
  const [notes, setNotes] = useState("");
  // Lives in the store, not component state: leaving the page mid-check keeps it running,
  // the AI tray shows its progress, and the result is here when you come back.
  const job = useStore((s) => s.jobs[PRE_KEY]);
  const pending = job?.status === "running";
  const result = job?.status === "done" ? job.result : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const { patchJob, setJob } = useStore.getState();
    const base = { jobId: "", kind: "pretrade" } as const;
    patchJob(PRE_KEY, { ...base, status: "running", step: 0, steps: PRE_STEPS, tracked: true, origin: "/coach", label: `${symbol} ${side === "long" ? "Buy" : "Sell"}${setup ? ` · ${setup}` : ""}`, result: undefined, error: undefined });
    // The check is a single request, so the steps advance on a timer while it runs.
    const tick = setInterval(() => {
      const j = useStore.getState().jobs[PRE_KEY];
      if (j?.status !== "running") return clearInterval(tick);
      patchJob(PRE_KEY, { ...base, step: Math.min(j.step + 1, PRE_STEPS.length - 1) });
    }, 2500);
    void preTradeCheck({ symbol, side, setup: setup || undefined, confluences: conf, riskPct: Number(risk) || undefined, notes: notes || undefined }).then(
      (r) => {
        clearInterval(tick);
        if (r.ok) return patchJob(PRE_KEY, { ...base, jobId: r.report._id, status: "done", result: r.report.content });
        if (window.location.pathname !== "/coach") return patchJob(PRE_KEY, { ...base, status: "failed", error: r.error });
        setJob(PRE_KEY, null);
        toast.error("Pre-trade check ล้มเหลว", { description: r.error });
      },
      () => {
        clearInterval(tick);
        patchJob(PRE_KEY, { ...base, status: "failed", error: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" });
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <AnimatePresence mode="wait" initial={false}>
        {pending ? (
          <motion.div key="run" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ThinkingSteps steps={PRE_STEPS} step={job?.step ?? 0} />
          </motion.div>
        ) : result ? (
          <motion.div key="res" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.smooth} className="flex flex-col gap-3">
            <ReportView kind="pretrade" content={result} />
            <Button variant="soft" size="sm" className="self-start" onClick={() => useStore.getState().setJob(PRE_KEY, null)}>
              เช็กเทรดอื่น
            </Button>
          </motion.div>
        ) : (
          <motion.form key="form" onSubmit={submit} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Symbol">
                <Input list="tg-symbols" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} required maxLength={20} />
                <datalist id="tg-symbols">
                  {form.symbols.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
              <Field label="ทิศทาง">
                <Segmented
                  label="ทิศทาง"
                  value={side}
                  onChange={setSide}
                  className="w-full [&>button]:flex-1"
                  options={[
                    { value: "long", label: <span className="text-green-ink">Buy</span> },
                    { value: "short", label: <span className="text-red-ink">Sell</span> },
                  ]}
                />
              </Field>
            </div>
            <div className="grid grid-cols-[1fr_96px] gap-3">
              <Field label="Setup">
                <Select value={setup} onChange={(e) => setSetup(e.target.value)}>
                  <option value="">ไม่มี setup</option>
                  {form.setups.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Risk %">
                <Input type="number" inputMode="decimal" step="0.1" min="0" max="20" value={risk} onChange={(e) => setRisk(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-fg-2">Confluences</span>
              <div className="flex flex-wrap gap-1.5">
                {form.confluences.map((cf) => (
                  <Chip key={cf} active={conf.includes(cf)} onClick={() => setConf((c) => (c.includes(cf) ? c.filter((x) => x !== cf) : [...c, cf]))} className="h-7 px-2.5 text-[12px]">
                    {cf}
                  </Chip>
                ))}
              </div>
            </div>
            <Field label="สิ่งที่คุณเห็น">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="min-h-16" placeholder="Asia low swept, M5 MSS, entry in the FVG…" maxLength={1000} />
            </Field>
            <Button type="submit" variant="ai" className="mt-1">
              <ShieldCheck /> เช็กเทรดนี้
            </Button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

export function LessonsList({ lessons, tz }: { lessons: CoachData["lessons"]; tz: string }) {
  if (!lessons.length) return <p className="text-[13px] text-fg-3">บทเรียนจะขึ้นที่นี่หลังโค้ชรีวิวเทรดและสัปดาห์ของคุณ</p>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {lessons.map((l) => (
        <li key={l.text} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
          <p className="text-[13.5px] leading-relaxed text-fg">{l.text}</p>
          {l.rule && l.rule !== l.text && <p className="text-[12.5px] text-violet-ink">Rule: {l.rule}</p>}
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-fg-3">
              {l.href ? (
                <Link href={l.href} className="hover:text-fg-2 hover:underline">
                  {l.from}
                </Link>
              ) : (
                l.from
              )}{" "}
              · {fmtDate(new Date(l.at), tz)}
            </span>
            {l.adopted ? <Badge tone="violet">อยู่ในกฎแล้ว</Badge> : <AdoptButton text={l.rule || l.text} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CustomRules({ rules }: { rules: string[] }) {
  const [list, setList] = useState(rules);
  const [pending, start] = useTransition();
  if (!list.length) return <p className="text-[13px] text-fg-3">รับบทเรียนมาเป็นกฎข้อแรก โค้ชจะเช็กทุกเทรดกับกฎเหล่านี้</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      <AnimatePresence initial={false}>
        {list.map((r, i) => (
          <motion.li key={r} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={spring.snappy} className="group flex items-start gap-2.5 rounded-[12px] bg-surface-2/70 px-3 py-2 ring-1 ring-line ring-inset">
            <span className="num mt-px grid size-5 shrink-0 place-items-center rounded-full bg-violet-soft text-[11px] font-semibold text-violet-ink">{i + 1}</span>
            <span className="min-w-0 flex-1 text-[13px] leading-relaxed">{r}</span>
            <button
              type="button"
              aria-label={`ลบกฎ: ${r}`}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setList((l) => l.filter((x) => x !== r));
                  await removeRule(r);
                  toast("ลบกฎแล้ว", { description: r });
                })
              }
              className="grid size-6 shrink-0 place-items-center rounded-full text-fg-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface-3 hover:text-fg focus-visible:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
