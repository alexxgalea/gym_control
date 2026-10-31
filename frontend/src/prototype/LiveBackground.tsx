/*
 * PROTOTIP (ramura prototype/ecran-usa-si-meniu): fundalul „viu”. Runda 3: bulele au fost prea mult, deci câteva
 * efecte mai fine, comutate cu `?bg=` (a doua bară roz):
 *   aurora · pete de culoare care se mută foarte lent, nimic altceva
 *   puncte · o grilă fină de puncte, luminată de un „reflector” care plimbă încet
 *   linii  · câteva linii subțiri, ondulate, care plutesc (ca liniile de nivel de pe o hartă)
 *   rare   · 8 particule mici și palide, foarte lente (versiunea minimă a celor de la busteniultrarace.ro)
 *   bule   · runda 2, pentru comparație
 *   fara   · fără fundal animat
 * Doar `transform`/`opacity`/`mask-position`, fără canvas; totul se oprește la „reduce motion”.
 */
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { PrototypeSwitcher, usePrototypeVariant } from "./PrototypeSwitcher";
import "./live-background.css";

export const BG_VARIANTS = [
  { key: "aurora", name: "Fundal: aurora lentă" },
  { key: "puncte", name: "Fundal: puncte și reflector" },
  { key: "linii", name: "Fundal: linii care plutesc" },
  { key: "rare", name: "Fundal: particule rare" },
  { key: "bule", name: "Fundal: bule (runda 2)" },
  { key: "fara", name: "Fundal: fără" },
] as const;

/** Generator determinist: aceleași poziții la fiecare randare. */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function particles(count: number, seed: number, slow: boolean) {
  const random = seeded(seed);
  return Array.from({ length: count }, () => ({
    left: random() * 100,
    duration: slow ? 18 + random() * 12 : 9 + random() * 7,
    delay: -random() * 30,
    scale: slow ? 0.5 + random() * 0.5 : 0.5 + random() * 1.3,
    sway: (random() - 0.5) * (slow ? 30 : 60),
    opacity: slow ? 0.18 + random() * 0.17 : 0.35 + random() * 0.4,
  }));
}
const DOTS = particles(26, 7, false);
const RARE = particles(8, 11, true);
const random = seeded(3);
const BUBBLES = Array.from({ length: 7 }, () => ({
  left: random() * 100,
  size: 40 + random() * 110,
  duration: 22 + random() * 14,
  delay: -random() * 36,
  sway: (random() - 0.5) * 120,
  opacity: 0.18 + random() * 0.2,
}));

function Particles({ items }: { items: typeof DOTS }) {
  return items.map((dot, index) => (
    <span
      key={index}
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
  ));
}

/** Liniile ondulate: trasee lungi pe toată lățimea; fiecare plutește în ritmul ei. */
const LINES = [
  "M-50 120 C 80 60, 180 200, 300 130 S 480 60, 560 140",
  "M-50 300 C 60 240, 200 380, 320 300 S 470 250, 560 320",
  "M-50 520 C 90 460, 210 600, 330 520 S 480 450, 560 540",
  "M-50 700 C 70 650, 190 780, 310 700 S 470 640, 560 720",
];

export function LiveBackground({ tone = "app", className }: { tone?: "app" | "door"; className?: string }) {
  const mode = usePrototypeVariant("bg", BG_VARIANTS.map((v) => v.key));
  return (
    <>
      <div aria-hidden className={cn("live-bg", tone === "door" && "live-bg--door", className)}>
        {mode !== "fara" && <div className={cn("live-bg__wash", mode === "aurora" && "live-bg__wash--aurora")} />}
        {mode === "aurora" && (
          <>
            <div className="live-bg__blob live-bg__blob--1" />
            <div className="live-bg__blob live-bg__blob--2" />
          </>
        )}
        {mode === "puncte" && <div className="live-bg__grid" />}
        {mode === "linii" && (
          <svg className="live-bg__lines" viewBox="0 0 500 800" preserveAspectRatio="xMidYMid slice">
            {LINES.map((d, index) => (
              <path key={index} d={d} className="live-bg__line" style={{ "--i": index } as CSSProperties} />
            ))}
          </svg>
        )}
        {mode === "rare" && <Particles items={RARE} />}
        {mode === "bule" && (
          <>
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
            <Particles items={DOTS} />
          </>
        )}
      </div>
      <PrototypeSwitcher scope="bg" variants={BG_VARIANTS} position="top" offset={tone === "door" ? 12 : 60} />
    </>
  );
}
