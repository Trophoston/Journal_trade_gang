"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { MotionConfig } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Toaster } from "sonner";
import { toast } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { quickTag } from "@/lib/actions/journal";
import { fmtMoney, fmtR } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import { isJobHere, jobHref, KIND_LABEL } from "@/lib/ui/jobs";
import { useStore } from "@/lib/ui/store";
import type { LiveEvent } from "@/lib/live/bus";
import { AiTray } from "./ai-tray";
import { useAppearance } from "./appearance";

export function Providers({ children }: { children: React.ReactNode }) {
  const a = useAppearance();
  const reduced = a.motion === "off" || a.motion === "reduced" ? "always" : a.motion === "full" ? "never" : "user";
  return (
    <MotionConfig reducedMotion={reduced}>
      <TooltipProvider>
        {children}
        <SheenTracker />
        <LiveEvents />
        <Shortcuts />
        <AiTray />
        <Alerts />
      </TooltipProvider>
    </MotionConfig>
  );
}

/**
 * Feeds the pointer position to the card sheen. It is written once on <html>, never on the cards:
 * cards inside a still-streaming Suspense boundary aren't hydrated yet, and touching their style
 * would make React report a hydration mismatch.
 */
function SheenTracker() {
  useEffect(() => {
    let frame = 0;
    const root = document.documentElement;
    const onMove = (e: PointerEvent) => {
      if (root.dataset.glass !== "most" || e.pointerType !== "mouse") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty("--mx", `${e.clientX}px`);
        root.style.setProperty("--my", `${e.clientY}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);
  return null;
}

function Shortcuts() {
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(!useStore.getState().commandOpen);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        const s = useStore.getState();
        if (s.chat.open) s.closeChat();
        else s.openChat({ scopeKey: "general", title: "ถามเรื่อง journal ของคุณ" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommandOpen]);
  return null;
}

/** Toasts stack above the AI tray, so neither covers the other. */
function Alerts() {
  const trayH = useStore((s) => s.trayH);
  return <Toaster position="bottom-right" offset={{ bottom: 20 + trayH, right: 20 }} mobileOffset={{ bottom: 12 + trayH, right: 12, left: 12 }} gap={10} visibleToasts={3} toastOptions={{ unstyled: true }} />;
}

const sideLabel = (side: string) => (side === "long" ? "Buy" : side === "short" ? "Sell" : side);

/** Server-Sent Events → client store, toasts and data refreshes. */
function LiveEvents() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const { setLive, patchJob } = useStore.getState();
    // A refresh animates new content in with a view transition, and browsers abort those in a
    // hidden tab ("Transition was aborted… Document hidden"). Hold it until the tab is visible.
    let pending = false;
    const refreshSoon = (ms = 800) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (document.hidden) pending = true;
        else router.refresh();
      }, ms);
    };
    const onVisible = () => {
      if (!document.hidden && pending) {
        pending = false;
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const es = new EventSource("/api/events");
    es.onmessage = (msg) => {
      let e: LiveEvent;
      try {
        e = JSON.parse(msg.data);
      } catch {
        return;
      }
      switch (e.type) {
        case "heartbeat":
          setLive(e.accountId, { balance: e.balance, equity: e.equity, floating: e.floating, margin: e.margin, positions: e.positions, connected: true, at: e.at });
          break;
        case "ea.status":
          // A disconnect keeps the last time data arrived, so "last seen" stays truthful.
          setLive(e.accountId, e.connected ? { connected: true, at: e.at } : { connected: false });
          // One card per account: a reconnect replaces the "disconnected" card instead of stacking.
          connectionAlert(e);
          if (e.connected) refreshSoon(300);
          break;
        case "trade.opened":
          toast.show("live", `เปิด ${e.symbol} ${sideLabel(e.side)}`, { description: "Live จาก MT5", icon: e.side === "short" ? <TrendingDown /> : <TrendingUp /> });
          refreshSoon();
          break;
        case "trade.closed":
          closedAlert(e, (href) => router.push(href));
          refreshSoon();
          break;
        case "trades.changed":
          refreshSoon(1200);
          break;
        case "ai.progress":
          patchJob(e.scopeKey, { jobId: e.jobId, kind: e.kind, step: e.step, steps: e.steps, status: "running" });
          break;
        case "ai.done": {
          const job = useStore.getState().jobs[e.scopeKey];
          patchJob(e.scopeKey, { jobId: e.jobId, kind: e.kind, step: 99, status: "done", reportId: e.reportId });
          refreshSoon(200);
          // A run the user started is reported by the AI tray while they're on another page,
          // and by its own panel when they're on its page. Background runs get a toast.
          if (job?.tracked) break;
          toast.ai(`${KIND_LABEL[e.kind] ?? "AI"} เสร็จแล้ว`, { description: e.title, action: { label: "เปิด", onClick: () => router.push(jobHref(e.scopeKey)) } });
          setTimeout(() => useStore.getState().setJob(e.scopeKey, null), 4000);
          break;
        }
        case "ai.failed": {
          const job = useStore.getState().jobs[e.scopeKey];
          patchJob(e.scopeKey, { jobId: e.jobId, kind: e.kind, status: "failed", error: e.error });
          if (job?.tracked && !isJobHere(e.scopeKey, job.origin, window.location.pathname)) break;
          toast.error(`${KIND_LABEL[e.kind] ?? "AI"} ทำไม่เสร็จ`, { description: e.error });
          break;
        }
      }
    };
    return () => {
      es.close();
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer.current);
    };
  }, [router]);
  return null;
}

/** One card per account: a reconnect replaces the "disconnected" card instead of stacking. */
function connectionAlert(e: Extract<LiveEvent, { type: "ea.status" }>) {
  const who = [e.name, e.login].filter(Boolean).join(" · ") || "บัญชี MT5";
  const how = e.via === "metaapi" ? "MetaApi" : "EA";
  const why = e.connected
    ? `Live ผ่าน ${how} เทรดและ equity อัปเดตแบบ real time`
    : (e.reason ??
      (e.via === "metaapi" ? "MetaApi ไม่ตอบสนอง เทรดที่เกิดระหว่างนี้จะ sync เมื่อกลับมา" : "ไม่มีข้อมูลจาก EA เปิด MT5 และติด EA ไว้บนกราฟหรือยัง? เทรดที่เกิดระหว่างนี้จะ sync เมื่อเชื่อมต่อใหม่"));
  toast.show(e.connected ? "live" : "error", e.connected ? "เชื่อมต่อ MT5 แล้ว" : "MT5 หลุดการเชื่อมต่อ", {
    id: `conn-${e.accountId}`,
    duration: e.connected ? 5_000 : Infinity,
    description: (
      <>
        <span className="block truncate font-medium text-fg">{who}</span>
        {why}
      </>
    ),
  });
}

function closedAlert(e: Extract<LiveEvent, { type: "trade.closed" }>, open: (href: string) => void) {
  const win = e.net > 0;
  const loss = e.net < 0;
  toast.show(win ? "success" : loss ? "error" : "info", `ปิด ${e.symbol} ${sideLabel(e.side)}`, {
    duration: 14_000,
    icon: loss ? <TrendingDown /> : <TrendingUp />,
    aside: (
      <span className={cn("num shrink-0 text-[14px] font-semibold", win ? "text-green-ink" : loss ? "text-red-ink" : "text-metal-ink")}>
        {win ? "▲" : loss ? "▼" : ""} {fmtMoney(e.net, e.currency, { sign: true })}
        {e.r != null && <span className="ml-1 text-[12px] font-normal text-fg-3">{fmtR(e.r)}</span>}
      </span>
    ),
    description: "ติด tag เลย AI จะวิเคราะห์ทันทีที่ติด tag หรือ 30 นาทีหลังปิดเทรด",
    children: <QuickTags tradeId={e.tradeId} />,
    action: { label: "เปิดเทรด", onClick: () => open(`/trades/${encodeURIComponent(e.tradeId)}`) },
  });
}

function QuickTags({ tradeId }: { tradeId: string }) {
  const tags = useStore((s) => s.meta.tags);
  const tag = async (t: { setup?: string; emotion?: string }) => {
    await quickTag(tradeId, t);
    toast.success("ติด tag แล้ว", { description: t.setup ?? t.emotion, duration: 2000 });
  };
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {tags.setups.slice(0, 3).map((s) => (
        <button key={s} onClick={() => tag({ setup: s })} className="rounded-full bg-blue-soft px-2.5 py-1 text-[12px] font-medium text-blue-ink transition-transform active:scale-95">
          {s}
        </button>
      ))}
      {tags.emotions.slice(0, 4).map((s) => (
        <button key={s} onClick={() => tag({ emotion: s })} className="rounded-full bg-metal-soft px-2.5 py-1 text-[12px] font-medium text-fg-2 transition-transform active:scale-95">
          {s}
        </button>
      ))}
    </div>
  );
}
