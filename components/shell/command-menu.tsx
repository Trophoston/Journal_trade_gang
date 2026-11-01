"use client";

import { Command } from "cmdk";
import { Bot, CalendarCheck, Contrast, Droplets, MessageSquareText, Moon, Search, Sparkles } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/ui/toast";
import { runAi } from "@/lib/actions/ai";
import { searchTrades } from "@/lib/actions/search";
import { fmtDay, fmtMoney, fmtR } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import { useStore } from "@/lib/ui/store";
import { tradingDayOf } from "@/lib/time/zone";
import { setAppearance, useAppearance, useToggleTheme } from "./appearance";
import { NAV } from "./dock";

type Hit = Awaited<ReturnType<typeof searchTrades>>[number];

export function CommandMenu() {
  const open = useStore((s) => s.commandOpen);
  const setOpen = useStore((s) => s.setCommandOpen);
  const openChat = useStore((s) => s.openChat);
  const router = useRouter();
  const toggleTheme = useToggleTheme();
  const a = useAppearance();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [, start] = useTransition();
  const pathname = usePathname();
  // Runs started here follow the user in the AI tray, like runs from a page's AI panel.
  const track = (r: Awaited<ReturnType<typeof runAi>>, kind: "daily" | "brief") => {
    if (r.ok && r.status !== "exists") useStore.getState().patchJob(r.scopeKey, { jobId: r.jobId ?? "", kind, status: r.status, tracked: true, origin: pathname });
  };

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => start(async () => setHits(await searchTrades(q))), q ? 120 : 0);
    return () => clearTimeout(t);
  }, [q, open]);

  const run = (fn: () => void) => {
    setOpen(false);
    setQ("");
    fn();
  };

  const item = "flex h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 text-sm text-fg-2 data-[selected=true]:bg-surface-3 data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:shrink-0";
  const group = "px-2 pb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-fg-3 [&_[cmdk-group-heading]]:uppercase";

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="เมนูคำสั่ง"
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-[70] bg-black/25 backdrop-blur-[2px] data-[state=open]:animate-[appear_160ms_ease]"
      contentClassName="glass-chrome fixed top-[14vh] left-1/2 z-[71] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[24px] data-[state=open]:animate-[appear_160ms_ease]"
    >
      <div className="relative z-[2]">
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Search className="size-4 text-fg-3" />
          <Command.Input value={q} onValueChange={setQ} placeholder="ค้นหาเทรด หน้า และคำสั่ง…" className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3" />
          <kbd className="rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] text-fg-3">esc</kbd>
        </div>
        <Command.List className="max-h-[min(60vh,480px)] overflow-y-auto overscroll-contain py-1">
          <Command.Empty className="px-5 py-8 text-center text-sm text-fg-3">ไม่พบผลลัพธ์</Command.Empty>
          {hits.length > 0 && (
            <Command.Group heading={q ? "เทรด" : "เทรดล่าสุด"} className={group}>
              {hits.map((h) => (
                <Command.Item key={h.id} value={`trade-${h.id}`} onSelect={() => run(() => router.push(`/trades/${encodeURIComponent(h.id)}`))} className={item}>
                  <span className={cn("grid size-6 place-items-center rounded-md text-[10px] font-bold", h.side === "long" ? "bg-green-soft text-green-ink" : "bg-red-soft text-red-ink")}>{h.side === "long" ? "L" : "S"}</span>
                  <span className="font-medium text-fg">{h.symbol}</span>
                  <span className="truncate text-fg-3">
                    {fmtDay(h.day)}
                    {h.setup ? ` · ${h.setup}` : ""}
                  </span>
                  <span className={cn("num ml-auto", h.net >= 0 ? "text-green-ink" : "text-red-ink")}>
                    {fmtMoney(h.net, "USD", { sign: true })} {h.r !== null && <span className="text-fg-3">{fmtR(h.r)}</span>}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {!q && (
            <>
              <Command.Group heading="ไปที่" className={group}>
                {NAV.map((n) => (
                  <Command.Item key={n.href} value={`go ${n.label}`} onSelect={() => run(() => router.push(n.href))} className={item}>
                    <n.icon />
                    {n.label}
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="AI" className={group}>
                <Command.Item value="ask" onSelect={() => run(() => openChat({ scopeKey: "general", title: "ถามเรื่อง journal ของคุณ" }))} className={item}>
                  <MessageSquareText className="text-violet-ink" />
                  ถามเรื่อง journal ของคุณ
                  <kbd className="ml-auto text-[11px] text-fg-3">⌘J</kbd>
                </Command.Item>
                <Command.Item
                  value="daily"
                  onSelect={() =>
                    run(async () => {
                      const day = tradingDayOf(Date.now());
                      const r = await runAi("daily", { day });
                      track(r, "daily");
                      toast(r.ok ? "เข้าคิวรีวิวรายวันแล้ว" : "เข้าคิวไม่ได้", { description: r.ok ? fmtDay(day) : r.error });
                    })
                  }
                  className={item}
                >
                  <CalendarCheck className="text-violet-ink" />
                  รีวิววันนี้
                </Command.Item>
                <Command.Item value="brief" onSelect={() => run(async () => {
                  const r = await runAi("brief", { day: tradingDayOf(Date.now()) });
                  track(r, "brief");
                  toast(r.ok ? "เข้าคิว Brief เทรดถัดไปแล้ว" : "เข้าคิวไม่ได้", { description: r.ok ? undefined : r.error });
                })} className={item}>
                  <Sparkles className="text-violet-ink" />
                  สร้าง Brief เทรดถัดไปใหม่
                </Command.Item>
                <Command.Item value="pretrade" onSelect={() => run(() => router.push("/coach#pretrade"))} className={item}>
                  <Bot className="text-violet-ink" />
                  Pre-trade check
                </Command.Item>
              </Command.Group>
              <Command.Group heading="การแสดงผล" className={group}>
                <Command.Item value="theme" onSelect={() => run(() => toggleTheme())} className={item}>
                  <Moon />
                  สลับโหมดสว่าง / มืด
                </Command.Item>
                <Command.Item value="glass" onSelect={() => run(() => setAppearance({ glass: a.glass === "most" ? "mid" : a.glass === "mid" ? "none" : "most" }))} className={item}>
                  <Droplets />
                  Liquid glass: {a.glass === "most" ? "Mid" : a.glass === "mid" ? "None" : "Most"}
                </Command.Item>
                <Command.Item value="palette" onSelect={() => run(() => setAppearance({ palette: a.palette === "cb" ? "default" : "cb" }))} className={item}>
                  <Contrast />
                  {a.palette === "cb" ? "สีกำไร/ขาดทุน เขียว / แดง" : "สีกำไร/ขาดทุน สำหรับตาบอดสี"}
                </Command.Item>
              </Command.Group>
            </>
          )}
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
