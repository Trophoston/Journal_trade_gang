"use client";

import { Popover } from "radix-ui";
import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { Segmented } from "@/components/ui/segmented";
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, type Appearance } from "@/lib/ui/appearance";
import { buttonClass } from "@/components/ui/button";

const listeners = new Set<() => void>();
let cached: Appearance | null = null;

function read(): Appearance {
  if (cached) return cached;
  try {
    cached = { ...DEFAULT_APPEARANCE, ...JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? "{}") };
  } catch {
    cached = { ...DEFAULT_APPEARANCE };
  }
  return cached!;
}

function prefersDark() {
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(a: Appearance) {
  const d = document.documentElement;
  d.classList.toggle("dark", a.theme === "dark" || (a.theme === "system" && prefersDark()));
  d.dataset.glass = a.glass;
  d.dataset.glassUser = "1";
  if (a.motion === "system") delete d.dataset.motion;
  else d.dataset.motion = a.motion;
  d.dataset.palette = a.palette;
}

function motionAllowed() {
  const m = document.documentElement.dataset.motion;
  if (m === "off" || m === "reduced") return false;
  if (m === "full") return true;
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Save + apply. A theme change plays a circular reveal from the pointer. */
export function setAppearance(patch: Partial<Appearance>, origin?: { x: number; y: number }) {
  const next = { ...read(), ...patch };
  cached = next;
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
  } catch {
    // private mode: keep it for this page only
  }
  const d = document.documentElement;
  const darkNow = d.classList.contains("dark");
  const darkNext = next.theme === "dark" || (next.theme === "system" && prefersDark());
  if (patch.theme && darkNow !== darkNext && document.startViewTransition && motionAllowed() && !document.hidden) {
    const x = origin?.x ?? innerWidth - 40;
    const y = origin?.y ?? 40;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    d.dataset.themeSwitching = "";
    const vt = document.startViewTransition(() => apply(next));
    vt.ready
      .then(() =>
        d.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] }, { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" }),
      )
      .catch(() => {});
    vt.finished.finally(() => delete d.dataset.themeSwitching);
  } else {
    apply(next);
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => {
    if (read().theme === "system") apply(read());
    l();
  };
  mq.addEventListener("change", onScheme);
  return () => {
    listeners.delete(l);
    mq.removeEventListener("change", onScheme);
  };
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_APPEARANCE);
}

export function useToggleTheme() {
  return useCallback((e?: { clientX: number; clientY: number }) => {
    const dark = document.documentElement.classList.contains("dark");
    setAppearance({ theme: dark ? "light" : "dark" }, e ? { x: e.clientX, y: e.clientY } : undefined);
  }, []);
}

export function AppearanceMenu() {
  const a = useAppearance();
  return (
    <Popover.Root>
      <Popover.Trigger className={buttonClass("ghost", "icon")} aria-label="การแสดงผล">
        <Palette />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={10} collisionPadding={12} className="glass-chrome z-[80] w-[300px] rounded-[20px] p-4 data-[state=open]:animate-[appear_160ms_ease]">
          <div className="relative z-[2] flex flex-col gap-4">
            <Row label="ธีม">
              <Segmented
                label="ธีม"
                size="sm"
                value={a.theme}
                onChange={(theme) => setAppearance({ theme })}
                options={[
                  { value: "system", label: <Monitor />, title: "ตามระบบ" },
                  { value: "light", label: <Sun />, title: "สว่าง" },
                  { value: "dark", label: <Moon />, title: "มืด" },
                ]}
              />
            </Row>
            <Row label="Liquid glass" hint="ระดับความเบลอและความโปร่งใสของพื้นผิว">
              <Segmented
                label="Liquid glass"
                size="sm"
                value={a.glass}
                onChange={(glass) => setAppearance({ glass })}
                options={[
                  { value: "most", label: "Most" },
                  { value: "mid", label: "Mid" },
                  { value: "none", label: "None" },
                ]}
              />
            </Row>
            <Row label="แอนิเมชัน">
              <Segmented
                label="แอนิเมชัน"
                size="sm"
                value={a.motion}
                onChange={(motion) => setAppearance({ motion })}
                options={[
                  { value: "system", label: "อัตโนมัติ" },
                  { value: "full", label: "เต็ม" },
                  { value: "reduced", label: "น้อย" },
                  { value: "off", label: "ปิด" },
                ]}
              />
            </Row>
            <Row label="สีกำไร / ขาดทุน" hint="โหมดตาบอดสีจะเปลี่ยนเขียว/แดง เป็นน้ำเงิน/ส้ม">
              <Segmented
                label="สีกำไรและขาดทุน"
                size="sm"
                value={a.palette}
                onChange={(palette) => setAppearance({ palette })}
                options={[
                  { value: "default", label: "เขียว / แดง" },
                  { value: "cb", label: "น้ำเงิน / ส้ม" },
                ]}
              />
            </Row>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[12px] font-medium text-fg-2">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-fg-3">{hint}</div>}
    </div>
  );
}
