import Link from "next/link";
import type { DayStat } from "@/lib/analytics/metrics";
import { fmtMoney, fmtMonth } from "@/lib/format";
import { cn } from "@/lib/ui/cn";
import { addDays, weekStartOf } from "@/lib/time/zone";

export function MiniCalendar({ month, days, currency, today }: { month: string; days: DayStat[]; currency: string; today: string }) {
  const first = `${month}-01`;
  const start = weekStartOf(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i)).filter((d, i) => i < 35 || d.startsWith(month));
  const by = new Map(days.map((d) => [d.day, d]));
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] font-medium text-fg-2">{fmtMonth(month)}</span>
        <Link href={`/calendar?m=${month}`} className="text-[12px] text-blue-ink hover:underline">
          เปิดปฏิทิน
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-fg-3">
        {["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"].map((d, i) => (
          <div key={i} className="pb-1">
            {d}
          </div>
        ))}
        {cells.map((d) => {
          const s = by.get(d);
          const inMonth = d.startsWith(month);
          return (
            <Link
              key={d}
              href={`/calendar?m=${month}&day=${d}`}
              title={s ? `${d}: ${fmtMoney(s.net, currency, { sign: true })} · ${s.count} เทรด` : d}
              className={cn(
                "flex aspect-square flex-col items-center justify-center rounded-[8px] text-[11px] transition-transform hover:scale-[1.06]",
                !inMonth && "opacity-30",
                s ? (s.net > 0 ? "bg-green-soft text-green-ink" : s.net < 0 ? "bg-red-soft text-red-ink" : "bg-metal-soft text-fg-2") : "text-fg-3",
                d === today && "ring-2 ring-blue ring-inset",
              )}
            >
              <span className="num leading-none font-medium">{Number(d.slice(8))}</span>
              {s && <span aria-hidden className="mt-0.5 leading-none">{s.net > 0 ? "▲" : s.net < 0 ? "▼" : "•"}</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
