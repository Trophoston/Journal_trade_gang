import { cn } from "@/lib/ui/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

/** Placeholder card for Suspense fallbacks; fades in late so fast loads never flash it. */
export function CardSkeleton({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div className={cn("glass-card appear-late p-5", className)} aria-busy>
      <Skeleton className="mb-4 h-4 w-28" />
      <Skeleton className="mb-3 h-8 w-40" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="mb-2 h-3" />
      ))}
    </div>
  );
}
