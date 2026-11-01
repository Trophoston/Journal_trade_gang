"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, History, Loader2, MessageSquareText, RotateCcw, Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { runAi, reportVersions } from "@/lib/actions/ai";
import type { AiReport, ReportKind } from "@/lib/ai/types";
import { cn } from "@/lib/ui/cn";
import { spring } from "@/lib/ui/motion";
import { useStore } from "@/lib/ui/store";
import { CiteContext, type CiteMap } from "./cite";
import { AiOrb } from "./orb";
import { ReportView } from "./report-view";

export type SerializedReport = Omit<AiReport, "createdAt"> & { createdAt: string };

const DEFAULT_STEPS: Record<string, string[]> = {
  trade: ["กำลังอ่านเทรดและการเข้าออก", "กำลังสแกนแท่งเทียนหา sweep และ FVG", "กำลังเช็กปฏิทินเศรษฐกิจ", "กำลังเทียบกับประวัติของคุณ", "Gemini กำลังเขียนบทวิเคราะห์"],
  daily: ["กำลังรวบรวมเทรดวันนี้", "กำลังเช็กกฎและบันทึก journal", "Gemini กำลังเขียนรีวิวรายวัน"],
  weekly: ["กำลังรวบรวมทั้งสัปดาห์", "กำลังจัดอันดับ session ชั่วโมง และ setup", "กำลังเช็กกฎของสัปดาห์ก่อน", "Gemini กำลังเขียนรีวิวรายสัปดาห์"],
  brief: ["กำลังโหลด edge ของคุณตาม session", "กำลังเช็กปฏิทินข่าววันนี้", "Gemini กำลังเขียน Brief ของวันนี้"],
};

export function ThinkingSteps({ steps, step }: { steps: string[]; step: number }) {
  return (
    <div className="flex items-start gap-4 py-2" role="status" aria-live="polite">
      <AiOrb size={36} busy />
      <ol className="min-w-0 flex-1 space-y-1.5">
        {steps.map((s, i) => {
          const state = i < step ? "done" : i === step ? "now" : "next";
          return (
            <motion.li key={s} initial={{ opacity: 0, y: 4 }} animate={{ opacity: state === "next" ? 0.45 : 1, y: 0 }} transition={{ ...spring.smooth, delay: i * 0.04 }} className="flex items-center gap-2 text-[13px]">
              <span className={cn("grid size-4 place-items-center rounded-full [&_svg]:size-2.5", state === "done" ? "bg-violet text-white" : state === "now" ? "text-violet-ink" : "bg-surface-3")}>
                {state === "done" ? <Check strokeWidth={3} /> : state === "now" ? <Loader2 className="!size-4 animate-spin" /> : null}
              </span>
              <span className={state === "now" ? "font-medium text-fg" : "text-fg-2"}>{s}</span>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

function when(iso: string, tz: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/**
 * The AI block on any page: shows the saved report, live progress while a job runs,
 * and the user-controlled actions (Analyze / Re-analyze / Ask).
 */
export function AiPanel({
  kind,
  payload,
  scopeKey,
  report,
  versions = report ? 1 : 0,
  cites = {},
  title,
  emptyNote,
  compact,
  className,
  label,
}: {
  kind: Exclude<ReportKind, "pretrade">;
  payload: Record<string, string>;
  scopeKey: string;
  report: SerializedReport | null;
  versions?: number;
  cites?: CiteMap;
  title: string;
  emptyNote?: string;
  compact?: boolean;
  className?: string;
  /** Names this run in the AI tray, e.g. "XAUUSD Buy · 30 ต.ค.". */
  label?: string;
}) {
  const job = useStore((s) => s.jobs[scopeKey]);
  const tz = useStore((s) => s.meta.timezone);
  const openChat = useStore((s) => s.openChat);
  const patchJob = useStore((s) => s.patchJob);
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [shown, setShown] = useState<SerializedReport | null>(null);
  const [all, setAll] = useState<SerializedReport[] | null>(null);
  const current = shown ?? report;
  const running = job?.status === "running" || pending;

  const run = () =>
    start(async () => {
      const r = await runAi(kind, payload);
      if (!r.ok) {
        toast.error("เริ่ม AI ไม่ได้", { description: r.error });
        return;
      }
      setShown(null);
      if (r.status === "exists") return;
      patchJob(scopeKey, { jobId: r.jobId ?? "", kind, step: 0, steps: DEFAULT_STEPS[kind] ?? [], status: r.status, tracked: true, origin: pathname, label, error: undefined });
    });

  const loadVersions = () =>
    start(async () => {
      setAll((await reportVersions(scopeKey)) as unknown as SerializedReport[]);
    });

  return (
    <CiteContext.Provider value={cites}>
      <div className={cn("flex min-w-0 flex-col", className)}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Sparkles className="size-4 shrink-0 text-violet-ink" />
            <div className="min-w-0">
              <h3 className="truncate text-[13px] font-medium text-violet-ink">{title}</h3>
              {current && (
                <div className="truncate text-[11px] text-fg-3">
                  v{current.version} · {current.model} · {when(current.createdAt, tz)}
                  {current.auto ? " · auto" : ""}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {versions > 1 && (
              <Button variant="ghost" size="icon-sm" aria-label="เวอร์ชันก่อนหน้า" onClick={loadVersions} title="เวอร์ชันก่อนหน้า">
                <History />
              </Button>
            )}
            {current && (
              <Button variant="ghost" size="sm" className="text-violet-ink" onClick={() => openChat({ scopeKey, reportId: current._id, title: current.title })}>
                <MessageSquareText />
                ถาม
              </Button>
            )}
            {current && (
              <Button variant="ghost" size="icon-sm" aria-label="วิเคราะห์ใหม่ (บันทึกเป็นเวอร์ชันใหม่)" title="วิเคราะห์ใหม่ (บันทึกเป็นเวอร์ชันใหม่)" onClick={run} disabled={running}>
                <RotateCcw />
              </Button>
            )}
          </div>
        </div>

        {all && all.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {all.map((r) => (
              <button key={r._id} onClick={() => setShown(r)} className={cn("rounded-full px-2.5 py-1 text-[12px] ring-1 ring-inset", (current?._id ?? "") === r._id ? "bg-violet-soft text-violet-ink ring-transparent" : "text-fg-3 ring-line")}>
                v{r.version} · {when(r.createdAt, tz)}
              </button>
            ))}
          </div>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {running ? (
            <motion.div key="run" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={spring.smooth}>
              <ThinkingSteps steps={job?.steps?.length ? job.steps : (DEFAULT_STEPS[kind] ?? [])} step={job?.step ?? 0} />
            </motion.div>
          ) : current ? (
            <motion.div key={current._id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={spring.smooth}>
              {compact && current.kind === "brief" ? (
                <ReportView kind="brief" content={current.content} />
              ) : (
                <ReportView kind={current.kind} content={current.content} />
              )}
              {current.sources?.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {current.sources.map((s) => (
                    <a key={s.uri} href={s.uri} target="_blank" rel="noreferrer" className="max-w-[220px] truncate rounded-full bg-surface-3 px-2.5 py-1 text-[11px] text-fg-2 hover:text-fg">
                      {s.title || new URL(s.uri).hostname}
                    </a>
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-start gap-3 py-1">
              {job?.status === "failed" && <p className="text-[13px] text-red-ink">{job.error}</p>}
              <p className="text-[13px] text-fg-3">{emptyNote ?? "ยังไม่ได้วิเคราะห์"}</p>
              <Button variant="ai" size="sm" onClick={run}>
                <Sparkles />
                วิเคราะห์ตอนนี้
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        <p className="mt-4 text-[11px] text-fg-3">คำแนะนำ AI จาก journal ของคุณ ไม่ใช่คำแนะนำทางการเงิน</p>
      </div>
    </CiteContext.Provider>
  );
}
