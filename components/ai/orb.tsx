import { cn } from "@/lib/ui/cn";

/** Violet "thinking" orb. Spins only while busy; a single transform animation. */
export function AiOrb({ size = 28, busy, className }: { size?: number; busy?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      {busy && <span className="absolute inset-0 rounded-full bg-violet/40" style={{ animation: "pulse-ring 1.6s ease-out infinite" }} />}
      <span
        className="absolute inset-0 rounded-full"
        style={{
          background: "conic-gradient(from 0deg, var(--violet), var(--blue), #c4b5fd, var(--violet))",
          animation: busy ? "orb-spin 1.6s linear infinite" : undefined,
          boxShadow: "inset 0 1px 2px rgb(255 255 255 / 0.5), 0 2px 10px -2px var(--violet)",
        }}
      />
      <span className="absolute inset-[22%] rounded-full bg-white/35 blur-[1px]" />
    </span>
  );
}
