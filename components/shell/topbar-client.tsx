"use client";

import { DropdownMenu } from "radix-ui";
import { Check, ChevronDown, MessageSquareText, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/chip";
import { Ticker } from "@/components/ui/ticker";
import { setActiveAccount } from "@/lib/actions/settings";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import { useStore, type Meta } from "@/lib/ui/store";
import { AppearanceMenu } from "./appearance";
import { AiOrb } from "@/components/ai/orb";

interface Props {
  timezone: string;
  tags: Meta["tags"];
  queued: number;
  /** Runs the user started that are still queued or running, so the AI tray survives a reload. */
  userJobs: { jobId: string; scopeKey: string; kind: string; status: "queued" | "running"; step: number; steps: string[] }[];
  accounts: { id: string; name: string; login: number; server: string; source: "mt5" | "demo"; tradeMode: string }[];
  active: { id: string; name: string; login: number; server: string; source: "mt5" | "demo"; currency: string; scale: number; balance: number; equity: number; floating: number; lastSeenAt: number } | null;
}

export function useConnected(accountId: string | undefined, lastSeenAt: number) {
  const liveAt = useStore((s) => (accountId ? s.live[accountId]?.at : undefined));
  const flag = useStore((s) => (accountId ? s.live[accountId]?.connected : undefined));
  // 0 until mounted: the server and the browser would read different clocks and disagree on the dot.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  const at = Math.max(liveAt ?? 0, lastSeenAt);
  // The server announces connect/disconnect (MetaApi only polls every 20 s, so a short window would flicker).
  // The time window is only a fallback for before the first event, or if the live stream itself drops.
  const connected = !now ? false : flag === false ? false : flag ? now - at < 90_000 : now - at < 30_000;
  return { connected, at };
}

function ago(ms: number) {
  if (!ms) return "ยังไม่เคย";
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return "เมื่อสักครู่";
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} ชม.ที่แล้ว` : `${Math.round(h / 24)} วันที่แล้ว`;
}

export function TopBarClient({ timezone, tags, queued, userJobs, accounts, active }: Props) {
  const setMeta = useStore((s) => s.setMeta);
  const setCommandOpen = useStore((s) => s.setCommandOpen);
  const openChat = useStore((s) => s.openChat);
  const live = useStore((s) => (active ? s.live[active.id] : undefined));
  const running = useStore((s) => Object.values(s.jobs).filter((j) => j.status === "running").length);
  const { connected, at } = useConnected(active?.id, active?.lastSeenAt ?? 0);

  // Once per page load: later refreshes can lag the live events and would revive finished runs.
  const [seed] = useState(userJobs);
  useEffect(() => {
    const { jobs, patchJob } = useStore.getState();
    for (const { scopeKey, ...j } of seed) if (!jobs[scopeKey]) patchJob(scopeKey, { ...j, tracked: true });
  }, [seed]);

  useEffect(() => {
    setMeta({ timezone, tags, accountId: active?.id, currency: active?.currency ?? "USD" });
  }, [setMeta, timezone, tags, active?.id, active?.currency]);

  const scale = active?.scale ?? 1;
  const equity = (live?.equity ?? active?.equity ?? 0) * scale;
  const floating = (live?.floating ?? active?.floating ?? 0) * scale;
  const currency = active?.currency ?? "USD";

  return (
    <header style={{ viewTransitionName: "app-chrome" }} className="sticky top-0 z-30 px-4 pt-3 pb-2 md:px-6">
      <div className="glass-chrome mx-auto flex h-14 max-w-[1440px] items-center gap-2 rounded-[20px] px-2 pl-3">
        <div className="relative z-[2] flex min-w-0 flex-1 items-center gap-2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="flex min-w-0 items-center gap-2.5 rounded-[12px] px-2 py-1.5 text-left transition-colors hover:bg-surface-3/70">
              <span className="relative grid size-2.5 shrink-0 place-items-center">
                {connected && <span className="absolute inset-0 rounded-full bg-green" style={{ animation: "pulse-ring 1.8s ease-out infinite" }} />}
                <span className={cn("relative size-2.5 rounded-full", connected ? "bg-green" : "bg-metal")} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm leading-tight font-medium">{active ? active.name : "ยังไม่มีบัญชี"}</span>
                <span className="block truncate text-[11px] leading-tight text-fg-3">
                  {active ? (connected ? `Live · ${active.server}` : active.source === "demo" ? "ข้อมูลตัวอย่าง" : `MT5 offline · ล่าสุด ${ago(at)}`) : "เชื่อม MT5 ได้ที่ตั้งค่า"}
                </span>
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-fg-3" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="start" sideOffset={10} className="glass-chrome z-[80] min-w-[260px] rounded-[18px] p-1.5 data-[state=open]:animate-[appear_140ms_ease]">
                <div className="relative z-[2]">
                  <DropdownMenu.Label className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-fg-3 uppercase">บัญชี</DropdownMenu.Label>
                  {accounts.map((a) => (
                    <DropdownMenu.Item key={a.id} onSelect={() => setActiveAccount(a.id)} className="flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.name}</span>
                        <span className="block truncate text-[11px] text-fg-3">
                          {a.login} · {a.server}
                        </span>
                      </span>
                      {a.source === "demo" ? <Badge>ตัวอย่าง</Badge> : <Badge tone={a.tradeMode === "real" ? "green" : "blue"}>{a.tradeMode === "real" ? "Real" : a.tradeMode === "demo" ? "Demo" : a.tradeMode}</Badge>}
                      {a.id === active?.id && <Check className="size-4 text-blue" />}
                    </DropdownMenu.Item>
                  ))}
                  <DropdownMenu.Separator className="my-1 h-px bg-line" />
                  <DropdownMenu.Item asChild className="flex cursor-pointer items-center rounded-[12px] px-3 py-2 text-sm text-blue-ink outline-none data-[highlighted]:bg-surface-3">
                    <Link href="/settings#connection">เชื่อมบัญชี MT5 เพิ่ม…</Link>
                  </DropdownMenu.Item>
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {active && (
            <div className="ml-1 hidden items-baseline gap-2 rounded-[12px] px-2 lg:flex">
              <span className="text-[12px] text-fg-3">Equity</span>
              <Ticker value={equity} format={(n) => fmtMoney(n, currency)} className="num text-sm font-semibold" />
              {Math.abs(floating) > 0.004 && (
                <span className={cn("num text-[12px]", floating > 0 ? "text-green-ink" : "text-red-ink")}>
                  {floating > 0 ? "▲" : "▼"} <Ticker value={floating} format={(n) => fmtMoney(n, currency, { sign: true })} />
                </span>
              )}
            </div>
          )}
        </div>

        <button onClick={() => setCommandOpen(true)} className="relative z-[2] hidden h-10 w-[min(340px,30vw)] items-center gap-2 rounded-[12px] bg-surface-3/70 px-3 text-sm text-fg-3 ring-1 ring-line ring-inset transition-colors hover:text-fg-2 sm:flex">
          <Search className="size-4" />
          ค้นหาหรือไปที่…
          <kbd className="ml-auto rounded-md bg-surface px-1.5 py-0.5 text-[11px] ring-1 ring-line">⌘K</kbd>
        </button>
        <button onClick={() => setCommandOpen(true)} aria-label="ค้นหา" className={cn(buttonClass("ghost", "icon"), "relative z-[2] sm:hidden")}>
          <Search />
        </button>

        <div className="relative z-[2] flex items-center gap-1">
          {(running > 0 || queued > 0) && (
            <Link href="/coach" className="flex h-10 items-center gap-2 rounded-[12px] px-2.5 text-[12px] font-medium text-violet-ink hover:bg-violet-soft" title="คิวงาน AI">
              <AiOrb size={18} busy={running > 0} />
              <span className="hidden sm:inline">{running > 0 ? "AI กำลังทำงาน" : `รอคิว ${queued}`}</span>
            </Link>
          )}
          <AppearanceMenu />
          <button onClick={() => openChat({ scopeKey: "general", title: "ถามเกี่ยวกับบันทึกเทรด" })} className={cn(buttonClass("ghost", "icon"), "text-violet-ink")} aria-label="เปิดแชท AI (⌘J)">
            <MessageSquareText />
          </button>
        </div>
      </div>
    </header>
  );
}
