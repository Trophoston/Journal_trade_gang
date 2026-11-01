"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Check, ChevronDown, CircleAlert, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AiOrb } from "@/components/ai/orb";
import { cn } from "@/lib/ui/cn";
import { isJobHere, jobDetail, jobHref, KIND_LABEL } from "@/lib/ui/jobs";
import { spring } from "@/lib/ui/motion";
import { useStore, type JobState } from "@/lib/ui/store";

/**
 * AI runs the user started, shown at the bottom right while they're on another page:
 * live steps while it works, then "done · open" or the error. Hidden on the run's own page,
 * where its panel already shows the same thing.
 */
export function AiTray() {
  const pathname = usePathname();
  const jobs = useStore((s) => s.jobs);
  const setJob = useStore((s) => s.setJob);
  const setTrayH = useStore((s) => s.setTrayH);
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  const items = Object.entries(jobs).filter(([key, j]) => j.tracked && !isJobHere(key, j.origin, pathname));
  const working = items.filter(([, j]) => j.status === "running" || j.status === "queued").length;

  // Arriving on a run's page counts as seeing its result; the pre-trade form keeps its own result.
  useEffect(() => {
    for (const [key, j] of Object.entries(jobs))
      if (j.tracked && j.kind !== "pretrade" && (j.status === "done" || j.status === "failed") && isJobHere(key, j.origin, pathname)) setJob(key, null);
  }, [jobs, pathname, setJob]);

  // A new run opens the tray again.
  const count = items.length;
  const last = useRef(count);
  useEffect(() => {
    if (count > last.current) setOpen(true);
    last.current = count;
  }, [count]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return setTrayH(0);
    const ro = new ResizeObserver(() => setTrayH(el.offsetHeight ? el.offsetHeight + 10 : 0));
    ro.observe(el);
    return () => {
      ro.disconnect();
      setTrayH(0);
    };
  }, [count > 0, setTrayH]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          ref={ref}
          key="tray"
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={spring.smooth}
          role="region"
          aria-label="งาน AI"
          className="glass-chrome ai-wash fixed right-3 bottom-3 z-40 w-[min(356px,calc(100vw-24px))] overflow-hidden rounded-[18px] sm:right-5 sm:bottom-5"
        >
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="relative z-[2] flex w-full items-center gap-2.5 px-3.5 py-3 text-left">
            <AiOrb size={20} busy={working > 0} />
            <span className="min-w-0 flex-1 text-[13.5px] font-medium text-violet-ink">{working > 0 ? `AI กำลังทำงาน ${working} งาน` : "งาน AI เสร็จแล้ว"}</span>
            <ChevronDown className={cn("size-4 text-fg-3 transition-transform", !open && "rotate-180")} />
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.ul key="list" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring.smooth} className="relative z-[2] max-h-[min(300px,50vh)] overflow-y-auto">
                <AnimatePresence initial={false}>
                  {items.map(([key, j]) => (
                    <TrayItem key={key} scopeKey={key} job={j} onClose={() => setJob(key, null)} />
                  ))}
                </AnimatePresence>
              </motion.ul>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TrayItem({ scopeKey, job, onClose }: { scopeKey: string; job: JobState; onClose: () => void }) {
  const router = useRouter();
  const href = job.origin && job.kind === "pretrade" ? job.origin : jobHref(scopeKey);
  const name = KIND_LABEL[job.kind] ?? "AI";
  const detail = job.label ?? jobDetail(scopeKey);
  const steps = job.steps.length;
  const step = Math.min(job.step, Math.max(0, steps - 1));
  const progress = job.status === "queued" ? 0 : steps ? (step + 0.5) / steps : 0.3;
  const go = () => {
    router.push(href);
    if (job.status === "done" || job.status === "failed") onClose();
  };

  return (
    <motion.li layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={spring.smooth} className="border-t border-line">
      <div className="flex items-start gap-2.5 px-3.5 py-3">
        <button onClick={go} className="group min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5 text-[13px] font-medium">
            <span className="truncate">{name}</span>
            {detail && <span className="truncate font-normal text-fg-3">· {detail}</span>}
            <ArrowUpRight className="size-3.5 shrink-0 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
          {job.status === "done" ? (
            <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-green-ink">
              <Check className="size-3.5" strokeWidth={3} /> เสร็จแล้ว · กดเพื่อเปิด
            </div>
          ) : job.status === "failed" ? (
            <div className="mt-1 flex items-start gap-1.5 text-[12.5px] text-red-ink">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span className="line-clamp-2">ไม่สำเร็จ{job.error ? ` · ${job.error}` : ""}</span>
            </div>
          ) : (
            <>
              <div className="mt-1 truncate text-[12.5px] text-fg-2">{job.status === "queued" ? "รอคิว…" : (job.steps[step] ?? "กำลังทำงาน…")}</div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-violet-soft">
                <motion.div className="h-full rounded-full bg-violet" initial={false} animate={{ width: `${Math.max(6, progress * 100)}%` }} transition={spring.gentle} />
              </div>
            </>
          )}
        </button>
        {(job.status === "done" || job.status === "failed") && (
          <button aria-label="ซ่อน" onClick={onClose} className="-mt-0.5 rounded-full p-1.5 text-fg-3 hover:bg-surface-3 hover:text-fg">
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </motion.li>
  );
}
