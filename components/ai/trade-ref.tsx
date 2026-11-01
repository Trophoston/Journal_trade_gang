"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { Tip } from "@/components/ui/tooltip";
import { peekTrades, type TradePeek } from "@/lib/actions/search";
import { fmtDateTime, fmtDay, fmtDuration, fmtMoney, fmtR } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import { useStore } from "@/lib/ui/store";

const REASON: Record<string, string> = { sl: "โดน SL", tp: "ถึง TP", so: "Stop out", manual: "ปิดเอง", mobile: "ปิดจากมือถือ", web: "ปิดจากเว็บ", expert: "ปิดโดย EA", other: "อื่น ๆ" };

// One shared cache for every chip on the page. Ids requested in the same tick go in one call.
const cache = new Map<string, TradePeek | null>();
const listeners = new Set<() => void>();
let pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

function load(id: string) {
  if (cache.has(id) || pending.has(id)) return;
  pending.add(id);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const ids = [...pending];
    pending = new Set();
    const found = await peekTrades(ids).catch(() => [] as TradePeek[]);
    for (const id of ids) cache.set(id, found.find((t) => t.id === id) ?? null);
    for (const l of listeners) l();
  }, 20);
}

function usePeek(id: string) {
  useEffect(() => load(id), [id]);
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => cache.get(id),
    () => undefined,
  );
}

/** A trade the AI mentioned: reads as "XAUUSD Sell −$5.77", hovers to a summary, clicks through to the trade. */
export function TradeRef({ id }: { id: string }) {
  const t = usePeek(id);
  const tz = useStore((s) => s.meta.timezone);
  const missing = t === null;
  const tone = !t ? "text-fg-2" : t.net > 0 ? "text-green-ink" : t.net < 0 ? "text-red-ink" : "text-metal-ink";
  const chip = (
    <Link
      href={`/trades/${encodeURIComponent(id)}`}
      scroll={false}
      className={cn(
        "mx-0.5 inline-flex h-[20px] max-w-full translate-y-[-1px] items-center gap-1 rounded-[6px] bg-surface-3/80 px-1.5 align-middle text-[11.5px] font-medium whitespace-nowrap ring-1 ring-line ring-inset transition-colors hover:bg-blue-soft hover:ring-blue/30",
        missing && "pointer-events-none opacity-60",
      )}
    >
      {t ? (
        <>
          <span className="text-fg">{t.symbol}</span>
          <span className={t.side === "long" ? "text-green-ink" : "text-red-ink"}>{t.side === "long" ? "Buy" : "Sell"}</span>
          <span className={cn("num", tone)}>{fmtMoney(t.net, t.currency, { sign: true })}</span>
        </>
      ) : (
        <span className="num text-fg-3">#{id.split("_").at(-1)}</span>
      )}
    </Link>
  );
  if (!t) return chip;
  return (
    <Tip
      className="max-w-80 min-w-56"
      content={
        <span className="flex flex-col gap-2">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-semibold text-fg">
              {t.symbol} <span className={t.side === "long" ? "text-green-ink" : "text-red-ink"}>{t.side === "long" ? "Buy" : "Sell"}</span>
            </span>
            <span className={cn("num text-[13px] font-semibold", tone)}>{fmtMoney(t.net, t.currency, { sign: true })}</span>
          </span>
          <span className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
            <Fact k="เปิด" v={t.openedAt ? fmtDateTime(t.openedAt, tz) : fmtDay(t.day)} />
            <Fact k="R" v={t.r !== null ? fmtR(t.r) : "–"} />
            <Fact k="ถือ" v={fmtDuration(t.durationSec)} />
            <Fact k="Volume" v={`${t.volume} lot`} />
            {t.session && <Fact k="Session" v={t.session} />}
            {t.closeReason && <Fact k="ปิดโดย" v={REASON[t.closeReason] ?? t.closeReason} />}
            <Fact k="Setup" v={t.setup ?? "ยังไม่ติด tag"} />
          </span>
          <span className="flex items-center gap-1 text-[11.5px] text-blue-ink">
            กดเพื่อเปิดเทรด <ArrowUpRight className="size-3" />
          </span>
        </span>
      }
    >
      {chip}
    </Tip>
  );
}

/** Inline "XAUUSD Buy +$5.10" for a trade id, without its own link (for use inside another link). */
export function TradeSummary({ id }: { id: string }) {
  const t = usePeek(id);
  if (!t) return null;
  return (
    <span className="num font-medium">
      <span className="text-fg">{t.symbol}</span> <span className={t.side === "long" ? "text-green-ink" : "text-red-ink"}>{t.side === "long" ? "Buy" : "Sell"}</span>{" "}
      <span className={t.net > 0 ? "text-green-ink" : t.net < 0 ? "text-red-ink" : "text-metal-ink"}>{fmtMoney(t.net, t.currency, { sign: true })}</span>
    </span>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-[10.5px] text-fg-3">{k}</span>
      <span className="num truncate text-fg">{v}</span>
    </span>
  );
}
