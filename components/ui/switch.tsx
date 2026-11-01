"use client";

import { Switch as S } from "radix-ui";
import { cn } from "@/lib/ui/cn";

export function Switch({ checked, onCheckedChange, label, tone = "blue", disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; tone?: "blue" | "violet"; disabled?: boolean }) {
  return (
    <S.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      disabled={disabled}
      className={cn("relative inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-surface-3 ring-1 ring-line-strong ring-inset transition-colors duration-200 disabled:opacity-50", checked && (tone === "violet" ? "bg-violet ring-transparent" : "bg-blue ring-transparent"))}
    >
      <S.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] data-[state=checked]:translate-x-[18px]" />
    </S.Root>
  );
}
