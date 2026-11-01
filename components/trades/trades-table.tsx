"use client";

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Minus, Sparkles, Tag, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import { useLayoutEffect, useMemo, useRef, useState, useTransition, ViewTransition } from "react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Empty } from "@/components/ui/empty";
import { Select } from "@/components/ui/field";
import { Pnl, RVal } from "@/components/ui/pnl";
import { analyzeTrades } from "@/lib/actions/ai";
import { bulkSetSetup, restoreSetups } from "@/lib/actions/journal";
import { fmtDate, fmtDuration, fmtMoney, fmtPct, fmtR, fmtTime } from "@/lib/format";
import type { TradeRow } from "@/lib/queries/trades";
import { cn } from "@/lib/ui/cn";
import { spring } from "@/lib/ui/motion";
import { useStore } from "@/lib/ui/store";

const ROW_H = 60;
const COLS = "grid-cols-[28px_minmax(0,1fr)_auto] md:grid-cols-[28px_118px_minmax(120px,1fr)_96px_minmax(120px,1.2fr)_72px_112px_64px_28px]";

const SESSIONS = [
  ["asia", "Asia"],
  ["london", "London"],
  ["ny_am", "NY AM"],
  ["ny_pm", "NY PM"],
  ["off", "นอก session"],
] as const;

function useFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return { sp, set, pending };
}

export function TradesTable({ rows, currency, tz, symbols, setups }: { rows: TradeRow[]; currency: string; tz: string; symbols: string[]; setups: string[] }) {
  // TanStack Virtual mutates its instance; the React Compiler would memoize the rows away.
  "use no memo";
  const { sp, set, pending } = useFilters();
  const pathname = usePathname();
  const setPreview = useStore((s) => s.setPreview);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [busy, startBusy] = useTransition();

  useLayoutEffect(() => {
    setOffset(listRef.current?.offsetTop ?? 0);
  }, []);

  const virt = useWindowVirtualizer({ count: rows.length, estimateSize: () => ROW_H, overscan: 12, scrollMargin: offset, initialRect: { width: 1200, height: 1000 } });

  // Drop selections that the current filter hides.
  const visible = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  const sel = [...selected].filter((id) => visible.has(id));
  const allOn = rows.length > 0 && sel.length === rows.length;

  const sum = useMemo(() => {
    let net = 0, r = 0, w = 0, l = 0;
    for (const t of rows) {
      net += t.net;
      r += t.r ?? 0;
      if (t.outcome === "win") w++;
      else if (t.outcome === "loss") l++;
    }
    return { net, r, wr: w + l ? (w / (w + l)) * 100 : null };
  }, [rows]);

  const openId = pathname.startsWith("/trades/") ? decodeURIComponent(pathname.slice(8)) : null;
  const active = (k: string) => sp.get(k) ?? "";

  const applySetup = (setup: string | null) =>
    startBusy(async () => {
      const ids = sel;
      const prev = await bulkSetSetup(ids, setup);
      setSelected(new Set());
      toast.success(setup ? `ตั้ง setup “${setup}” ให้ ${ids.length} เทรด` : `ล้าง setup ของ ${ids.length} เทรด`, {
        action: { label: "เลิกทำ", onClick: () => restoreSetups(prev) },
      });
    });

  const tradeLabel = (id: string) => {
    const t = rows.find((r) => r.id === id);
    return t ? `${t.symbol} ${t.side === "long" ? "Buy" : "Sell"}` : undefined;
  };

  const analyze = () =>
    startBusy(async () => {
      const r = await analyzeTrades(sel);
      setSelected(new Set());
      const { patchJob } = useStore.getState();
      for (const key of r.keys) patchJob(key, { jobId: "", kind: "trade", status: "queued", tracked: true, origin: pathname, label: tradeLabel(key.slice(6)) });
      toast(r.queued ? `เข้าคิววิเคราะห์ AI ${r.queued} เทรด` : "เทรดเหล่านี้มีบทวิเคราะห์แล้ว", {
        description: r.skipped ? `ข้าม ${r.skipped} เทรด (วิเคราะห์แล้วหรือกำลังรัน) กด Re-analyze ในหน้าเทรดเพื่อสร้างเวอร์ชันใหม่` : "ผลจะขึ้นในแต่ละเทรดเมื่อเสร็จ",
      });
    });

  const filtersOn = ["symbol", "setup", "session", "side", "outcome", "review", "from", "to"].some((k) => sp.get(k));

  return (
    <div className="flex flex-col gap-4">
      {/* Filters — one row above the table */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="group" aria-label="ผลลัพธ์">
          {[
            ["", "ทั้งหมด"],
            ["win", "ชนะ"],
            ["loss", "แพ้"],
            ["be", "เสมอ"],
          ].map(([v, l]) => (
            <Chip key={v} active={active("outcome") === v} tone={v === "win" ? "green" : v === "loss" ? "red" : v === "be" ? "metal" : "blue"} onClick={() => set({ outcome: v || null })}>
              {l}
            </Chip>
          ))}
        </div>
        <span className="mx-1 hidden h-5 w-px bg-line-strong sm:block" />
        <Chip active={active("review") === "1"} tone="amber" onClick={() => set({ review: active("review") ? null : "1" })}>
          รอรีวิว
        </Chip>
        <Chip active={active("side") === "long"} tone="green" onClick={() => set({ side: active("side") === "long" ? null : "long" })}>
          Buy
        </Chip>
        <Chip active={active("side") === "short"} tone="red" onClick={() => set({ side: active("side") === "short" ? null : "short" })}>
          Sell
        </Chip>
        <Select aria-label="Symbol" value={active("symbol")} onChange={(e) => set({ symbol: e.target.value })} className="h-8 w-auto min-w-[112px] text-[13px]">
          <option value="">ทุก symbol</option>
          {symbols.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <Select aria-label="Session" value={active("session")} onChange={(e) => set({ session: e.target.value })} className="h-8 w-auto min-w-[120px] text-[13px]">
          <option value="">ทุก session</option>
          {SESSIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Select aria-label="Setup" value={active("setup")} onChange={(e) => set({ setup: e.target.value })} className="h-8 w-auto min-w-[140px] text-[13px]">
          <option value="">ทุก setup</option>
          <option value="__none">ยังไม่มี setup</option>
          {setups.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        {filtersOn && (
          <Button variant="ghost" size="sm" onClick={() => set({ symbol: null, setup: null, session: null, side: null, outcome: null, review: null, from: null, to: null })}>
            <X /> ล้าง
          </Button>
        )}
      </div>

      {/* Summary of what's filtered */}
      <div className={cn("flex flex-wrap items-baseline gap-x-6 gap-y-1 px-1 text-[13px] text-fg-3 transition-opacity", pending && "opacity-50")}>
        <span>
          <span className="num font-semibold text-fg">{rows.length}</span> เทรด
        </span>
        <span>
          Net <Pnl value={sum.net} currency={currency} className="font-semibold" />
        </span>
        <span>
          Win rate <span className="num font-semibold text-fg">{fmtPct(sum.wr, 0)}</span>
        </span>
        <span>
          รวม <span className={cn("num font-semibold", sum.r >= 0 ? "text-green-ink" : "text-red-ink")}>{fmtR(sum.r, 1)}</span>
        </span>
      </div>

      <div className="glass-solid overflow-hidden rounded-[var(--radius-card)]">
        <div role="table" aria-label="เทรดที่ปิดแล้ว" aria-rowcount={rows.length + 1} className="relative z-[2]">
          <div role="row" className={cn("grid items-center gap-3 border-b border-line px-4 py-2.5 text-[11px] font-medium text-fg-3", COLS)}>
            <span role="columnheader">
              <Box checked={allOn ? true : sel.length ? "mixed" : false} label="เลือกทั้งหมด" onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.id)))} />
            </span>
            <span role="columnheader" className="hidden md:block">
              ปิดเมื่อ
            </span>
            <span role="columnheader">Symbol</span>
            <span role="columnheader" className="hidden md:block">
              Session
            </span>
            <span role="columnheader" className="hidden md:block">
              Setup
            </span>
            <span role="columnheader" className="hidden text-right md:block">
              R
            </span>
            <span role="columnheader" className="text-right">
              P&L
            </span>
            <span role="columnheader" className="hidden text-right md:block">
              ถือ
            </span>
            <span role="columnheader" className="hidden md:block">
              <span className="sr-only">AI</span>
            </span>
          </div>

          {rows.length === 0 ? (
            <Empty title={filtersOn ? "ไม่มีเทรดที่ตรงกับตัวกรอง" : "ยังไม่มีเทรดที่ปิด"}>{filtersOn ? "ลองล้างตัวกรองบางอัน" : "เทรดจะขึ้นที่นี่ทันทีที่ MT5 ปิดออเดอร์"}</Empty>
          ) : (
            <div ref={listRef} style={{ height: virt.getTotalSize(), position: "relative" }}>
              {virt.getVirtualItems().map((v) => {
                const t = rows[v.index];
                const isOn = selected.has(t.id);
                const href = `/trades/${encodeURIComponent(t.id)}`;
                const row = (
                  <div
                    role="row"
                    aria-rowindex={v.index + 2}
                    className={cn("group relative grid h-full items-center gap-3 border-b border-line px-4 transition-colors", COLS, isOn ? "bg-blue-soft" : "hover:bg-surface-3/60")}
                  >
                    <span role="cell">
                      <Box
                        checked={isOn}
                        label={`เลือก ${t.symbol} ${fmtDate(t.closedAt, tz)}`}
                        onChange={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(t.id)) n.delete(t.id);
                            else n.add(t.id);
                            return n;
                          })
                        }
                      />
                    </span>
                    <span role="cell" className="num hidden text-[12.5px] md:block">
                      <span className="block text-fg">{fmtDate(t.closedAt, tz)}</span>
                      <span className="block text-[11px] text-fg-3">
                        {fmtTime(t.openedAt, tz)}–{fmtTime(t.closedAt, tz)}
                      </span>
                    </span>
                    <Link
                      role="cell"
                      href={href}
                      scroll={false}
                      onClick={() => setPreview({ id: t.id, symbol: t.symbol, side: t.side, net: t.net, r: t.r, outcome: t.outcome, openedAt: t.openedAt, closedAt: t.closedAt, session: t.sessionLabel })}
                      className="flex min-w-0 items-center gap-2.5 after:absolute after:inset-0 after:content-['']"
                    >
                      <span className={cn("grid size-7 shrink-0 place-items-center rounded-[8px] text-[10px] font-bold", t.side === "long" ? "bg-green-soft text-green-ink" : "bg-red-soft text-red-ink")}>{t.side === "long" ? "L" : "S"}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-medium">{t.symbol}</span>
                        <span className="num block truncate text-[11px] text-fg-3 md:hidden">
                          {fmtDate(t.closedAt, tz)} · {t.sessionLabel}
                        </span>
                        <span className="num hidden text-[11px] text-fg-3 md:block">{t.volume} lot</span>
                      </span>
                    </Link>
                    <span role="cell" className="hidden truncate text-[12.5px] text-fg-2 md:block">
                      {t.sessionLabel}
                    </span>
                    <span role="cell" className="hidden min-w-0 md:block">
                      {t.setup ? <span className="block truncate text-[12.5px] text-fg-2">{t.setup}</span> : <span className="text-[12px] text-amber">ยังไม่แท็ก</span>}
                      {t.mistakes.length > 0 && <span className="block truncate text-[11px] text-red-ink">{t.mistakes.join(", ")}</span>}
                    </span>
                    <span role="cell" className="hidden text-right text-[13px] md:block">
                      <RVal value={t.r} />
                    </span>
                    <span role="cell" className="text-right">
                      <Pnl value={t.net} currency={currency} className="text-[13.5px] font-medium" arrow={false} />
                      <RVal value={t.r} className="block text-[11px] md:hidden" />
                    </span>
                    <span role="cell" className="num hidden text-right text-[12px] text-fg-3 md:block">
                      {fmtDuration(t.durationSec)}
                    </span>
                    <span role="cell" className="hidden md:block">
                      {t.analyzed && <Sparkles className="size-3.5 text-violet-ink" aria-label="มีบทวิเคราะห์ AI แล้ว" />}
                    </span>
                  </div>
                );
                return (
                  <div key={t.id} className="absolute inset-x-0 top-0" style={{ height: v.size, transform: `translateY(${v.start - virt.options.scrollMargin}px)` }}>
                    {openId === t.id ? (
                      row
                    ) : (
                      <ViewTransition name={`trade-${t.id}`} share="morph" default="none">
                        {row}
                      </ViewTransition>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bulk actions for the selection */}
      <AnimatePresence>
        {sel.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={spring.snappy}
            className="glass-chrome fixed inset-x-0 bottom-24 z-30 mx-auto flex w-fit items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4 md:bottom-6"
            role="toolbar"
            aria-label="เทรดที่เลือก"
          >
            <span className="relative z-[2] text-[13px] font-medium whitespace-nowrap">
              เลือก {sel.length} · <span className="num">{fmtMoney(rows.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.net, 0), currency, { sign: true })}</span>
            </span>
            <div className="relative z-[2] flex items-center gap-1">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-fg-2 hover:bg-surface-3/70 hover:text-fg disabled:opacity-50" disabled={busy}>
                  <Tag className="size-4" /> Setup <ChevronDown className="size-3.5" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content side="top" sideOffset={10} className="glass-chrome z-50 min-w-[220px] rounded-[16px] p-1.5">
                    <div className="relative z-[2]">
                      {setups.map((s) => (
                        <DropdownMenu.Item key={s} onSelect={() => applySetup(s)} className="cursor-default rounded-[10px] px-3 py-2 text-[13px] outline-none data-[highlighted]:bg-blue-soft data-[highlighted]:text-blue-ink">
                          {s}
                        </DropdownMenu.Item>
                      ))}
                      <DropdownMenu.Separator className="my-1 h-px bg-line" />
                      <DropdownMenu.Item onSelect={() => applySetup(null)} className="cursor-default rounded-[10px] px-3 py-2 text-[13px] text-fg-3 outline-none data-[highlighted]:bg-surface-3">
                        ล้าง setup
                      </DropdownMenu.Item>
                    </div>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <Button variant="ai" size="sm" className="rounded-full" onClick={analyze} disabled={busy}>
                <Sparkles /> วิเคราะห์
              </Button>
              <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="ยกเลิกการเลือก" onClick={() => setSelected(new Set())}>
                <X />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Box({ checked, onChange, label }: { checked: boolean | "mixed"; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn("relative z-[1] grid size-[18px] place-items-center rounded-[6px] ring-1 ring-inset transition-colors [&_svg]:size-3", checked ? "bg-blue text-white ring-blue" : "ring-line-strong hover:ring-fg-3")}
    >
      {checked === "mixed" ? <Minus strokeWidth={3} /> : checked ? <Check strokeWidth={3} /> : null}
    </button>
  );
}
