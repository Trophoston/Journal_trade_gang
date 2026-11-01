"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { CalendarDays, ChartSpline, LayoutGrid, Rows3, Settings, Sparkles } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/ui/cn";
import { spring } from "@/lib/ui/motion";

export const NAV = [
  { href: "/", label: "ภาพรวม", icon: LayoutGrid, key: "1" },
  { href: "/calendar", label: "ปฏิทิน", icon: CalendarDays, key: "2" },
  { href: "/trades", label: "เทรด", icon: Rows3, key: "3" },
  { href: "/insights", label: "Insights", icon: ChartSpline, key: "4" },
  { href: "/coach", label: "โค้ช AI", icon: Sparkles, key: "5", ai: true },
  { href: "/settings", label: "ตั้งค่า", icon: Settings, key: "6" },
] as const;

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

/** The pathname is unknown while prerendering a dynamic route, so the active marker streams in. */
export function Dock() {
  return (
    <Suspense fallback={<DockView path="" />}>
      <LiveDock />
    </Suspense>
  );
}

function LiveDock() {
  return <DockView path={usePathname()} />;
}

function DockView({ path }: { path: string }) {
  return (
    <>
      <nav aria-label="เมนูหลัก" style={{ viewTransitionName: "app-dock" }} className="glass-chrome fixed top-1/2 left-4 z-40 hidden -translate-y-1/2 flex-col items-center gap-1 rounded-[26px] p-2 md:flex">
        <Link href="/" aria-label="หน้าแรก Trade Gang" className="relative z-[2] mb-2 grid size-11 place-items-center rounded-[16px] bg-[conic-gradient(from_210deg,var(--blue),var(--violet),var(--green),var(--blue))] text-[13px] font-bold tracking-tight text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35)]">
          TG
        </Link>
        {NAV.map((n) => {
          const active = isActive(path, n.href);
          return (
            <Tip key={n.href} side="right" content={<span className="text-fg">{n.label}</span>}>
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                aria-label={n.label}
                className={cn("relative z-[2] grid size-11 place-items-center rounded-[14px] transition-colors duration-150 [&_svg]:size-[19px]", active ? (n.href === "/coach" ? "text-violet-ink" : "text-fg") : "text-fg-3 hover:text-fg")}
              >
                {active && <motion.span layoutId="dock-active" transition={spring.snappy} className="absolute inset-0 -z-10 rounded-[14px] bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.08),0_4px_14px_-4px_rgb(0_0_0/0.18)] ring-1 ring-line" />}
                <n.icon strokeWidth={active ? 2.2 : 1.8} />
              </Link>
            </Tip>
          );
        })}
      </nav>
      <nav aria-label="เมนูหลัก" className="glass-chrome fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-[24px] p-1.5 md:hidden">
        {NAV.map((n) => {
          const active = isActive(path, n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cn("relative z-[2] flex h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-[18px] text-[10px] font-medium [&_svg]:size-5", active ? "text-fg" : "text-fg-3")}>
              {active && <motion.span layoutId="dock-active-m" transition={spring.snappy} className="absolute inset-0 -z-10 rounded-[18px] bg-surface ring-1 ring-line" />}
              <n.icon strokeWidth={active ? 2.2 : 1.8} />
              {n.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
