/*
 * PROTOTIP (ramura prototype/ecran-usa-si-meniu): fundalul „viu”, după modelul busteniultrarace.ro/inscriere:
 * particule mici care urcă lent de jos în sus și se sting, câteva bule mari și moi, plus un degradeu care
 * „respiră” (se mărește și se mută foarte încet). Doar `transform`/`opacity`, fără canvas; oprit la „reduce motion”.
 */
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import "./live-background.css";

/** Generator determinist: aceleași poziții la fiecare randare (fără sărituri la re-randare). */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seeded(7);
const DOTS = Array.from({ length: 26 }, () => ({
  left: random() * 100,
  duration: 9 + random() * 7,
  delay: -random() * 16, // întârziere negativă: la încărcare particulele sunt deja pe drum, nu pornesc toate de jos
  scale: 0.5 + random() * 1.3,
  sway: (random() - 0.5) * 60,
  opacity: 0.35 + random() * 0.4,
}));
const BUBBLES = Array.from({ length: 7 }, () => ({
  left: random() * 100,
  size: 40 + random() * 110,
  duration: 22 + random() * 14,
  delay: -random() * 36,
  sway: (random() - 0.5) * 120,
  opacity: 0.18 + random() * 0.2,
}));

export function LiveBackground({ tone = "app", className }: { tone?: "app" | "door"; className?: string }) {
  return (
    <div aria-hidden className={cn("live-bg", tone === "door" && "live-bg--door", className)}>
      <div className="live-bg__wash" />
      {BUBBLES.map((bubble, index) => (
        <span
          key={`b${index}`}
          className="live-bg__bubble"
          style={
            {
              left: `${bubble.left}%`,
              width: bubble.size,
              height: bubble.size,
              "--d": `${bubble.duration}s`,
              "--delay": `${bubble.delay}s`,
              "--sway": `${bubble.sway}px`,
              "--o": bubble.opacity,
            } as CSSProperties
          }
        />
      ))}
      {DOTS.map((dot, index) => (
        <span
          key={`d${index}`}
          className="live-bg__dot"
          style={
            {
              left: `${dot.left}%`,
              "--d": `${dot.duration}s`,
              "--delay": `${dot.delay}s`,
              "--s": dot.scale,
              "--sway": `${dot.sway}px`,
              "--o": dot.opacity,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
