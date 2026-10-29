import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
  neutral: "bg-muted text-muted-foreground",
} as const;

/** Etichetă de stare (de exemplu „Telefon activat”). Verdele și roșul apar doar aici, pentru stări. */
export function StatusBadge({ tone = "neutral", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", TONES[tone])}>
      {children}
    </span>
  );
}
