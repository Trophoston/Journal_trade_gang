import { cn } from "@/lib/ui/cn";

type Variant = "primary" | "soft" | "ghost" | "ai" | "danger" | "outline";
type Size = "sm" | "md" | "icon" | "icon-sm";

const VARIANT: Record<Variant, string> = {
  primary: "bg-blue text-white shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_6px_16px_-8px_var(--blue)] hover:brightness-110",
  soft: "bg-surface-3/80 text-fg hover:bg-surface-3 ring-1 ring-line ring-inset",
  ghost: "text-fg-2 hover:bg-surface-3/70 hover:text-fg",
  outline: "text-fg ring-1 ring-line-strong ring-inset hover:bg-surface-3/60",
  ai: "bg-violet text-white shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_6px_18px_-8px_var(--violet)] hover:brightness-110",
  danger: "bg-red-soft text-red-ink hover:bg-red hover:text-white",
};
const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  icon: "size-10 justify-center",
  "icon-sm": "size-8 justify-center",
};

export function buttonClass(variant: Variant = "soft", size: Size = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 select-none items-center rounded-[var(--radius-control)] font-medium whitespace-nowrap transition-[transform,background-color,color,filter,box-shadow] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

export function Button({ variant, size, className, type = "button", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}
