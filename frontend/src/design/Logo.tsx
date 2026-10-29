import { cn } from "@/lib/utils";
import logoUrl from "./logo.svg";

/** Logoul GymCtrl (fișierul `logo.svg`), cu numele alături dacă `wordmark` e activ. */
export function Logo({
  size = 32,
  wordmark = true,
  className,
}: {
  size?: number;
  wordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <img src={logoUrl} alt="GymCtrl" width={size} height={size} className="shrink-0" />
      {wordmark && (
        <span className="font-semibold tracking-tight" style={{ fontSize: Math.round(size * 0.56) }}>
          GymCtrl
        </span>
      )}
    </span>
  );
}
