import { cn } from "@/lib/ui/cn";

export function Empty({ icon, title, children, className }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      {icon && <div className="mb-1 grid size-11 place-items-center rounded-2xl bg-surface-3 text-fg-3 [&_svg]:size-5">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-sm text-[13px] text-fg-3">{children}</div>}
    </div>
  );
}
