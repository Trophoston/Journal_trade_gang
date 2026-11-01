import { fmtPct } from "@/lib/format";

/** Win-rate half gauge: wins (green) · break-even (metal) · losses (red), 2px surface gaps between segments. */
export function WinGauge({ wins, losses, be }: { wins: number; losses: number; be: number }) {
  const total = wins + losses + be;
  const r = 70;
  const cx = 90;
  const cy = 84;
  const len = Math.PI * r;
  const gap = total > 0 ? 2 : 0;
  const seg = (n: number) => (total ? (n / total) * len : 0);
  const segs = [
    { n: wins, color: "var(--green)" },
    { n: be, color: "var(--metal)" },
    { n: losses, color: "var(--red)" },
  ].filter((s) => s.n > 0);
  let offset = 0;
  const rate = wins + losses ? (wins / (wins + losses)) * 100 : null;
  return (
    <div className="relative mx-auto w-full max-w-[220px]">
      <svg viewBox="0 0 180 96" className="w-full" role="img" aria-label={`Win rate ${fmtPct(rate, 1)}: ชนะ ${wins} แพ้ ${losses} เสมอ ${be}`}>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="var(--surface-3)" strokeWidth={12} strokeLinecap="round" />
        {segs.map((s, i) => {
          const l = Math.max(0, seg(s.n) - (i < segs.length - 1 ? gap : 0));
          const el = (
            <path key={i} d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={s.color} strokeWidth={12} strokeLinecap={segs.length === 1 ? "round" : "butt"} strokeDasharray={`${l} ${len}`} strokeDashoffset={-offset} style={{ transition: "stroke-dasharray 700ms cubic-bezier(0.22,1,0.36,1)" }} />
          );
          offset += seg(s.n);
          return el;
        })}
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="num text-[26px] leading-none font-semibold tracking-tight">{fmtPct(rate, 1)}</div>
      </div>
    </div>
  );
}
