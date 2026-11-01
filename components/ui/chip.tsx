import { cn } from "@/lib/ui/cn";

type Tone = "metal" | "green" | "red" | "blue" | "violet" | "amber";
const TONE: Record<Tone, string> = {
  metal: "bg-metal-soft text-fg-2",
  green: "bg-green-soft text-green-ink",
  red: "bg-red-soft text-red-ink",
  blue: "bg-blue-soft text-blue-ink",
  violet: "bg-violet-soft text-violet-ink",
  amber: "bg-[color-mix(in_oklab,var(--amber)_16%,transparent)] text-[color-mix(in_oklab,var(--amber)_80%,var(--fg))]",
};

export function Badge({ tone = "metal", className, children, ...rest }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap [&_svg]:size-3.5", TONE[tone], className)} {...rest}>
      {children}
    </span>
  );
}

/** Toggle chip (tags, filters). */
export function Chip({ active, tone = "blue", className, type = "button", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; tone?: Tone }) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap ring-1 ring-inset transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.96] [&_svg]:size-3.5",
        active ? cn(TONE[tone], "ring-transparent") : "text-fg-2 ring-line-strong hover:bg-surface-3/70 hover:text-fg",
        className,
      )}
      {...rest}
    />
  );
}
