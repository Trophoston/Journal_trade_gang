import { cn } from "@/lib/ui/cn";

/** Chart hover card: sits beside the point, flips to the left near the right edge. */
export function ChartTip({ x, y, width, children, className }: { x: number; y: number; width: number; children: React.ReactNode; className?: string }) {
  const W = 176;
  const raw = x + 14 + W > width ? x - 14 - W : x + 14;
  const left = Math.min(Math.max(raw, 0), Math.max(0, width - W));
  return (
    <div className={cn("glass-chrome pointer-events-none absolute z-10 rounded-[12px] px-3 py-2 text-[12px]", className)} style={{ left, top: Math.max(0, y - 24), width: W }}>
      <div className="relative z-[2]">{children}</div>
    </div>
  );
}
