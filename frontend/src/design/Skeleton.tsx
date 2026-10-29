import { cn } from "@/lib/utils";

/** Schelet de încărcare: arată forma conținutului în loc de „Se încarcă…”. Pulsul se oprește la „Reduce motion”. */
export function Skeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Se încarcă" aria-busy="true" className={cn("flex flex-col gap-3", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      ))}
    </div>
  );
}
