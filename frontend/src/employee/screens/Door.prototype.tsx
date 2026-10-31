/*
 * PROTOTIP (ramura prototype/ecran-usa-si-meniu) — întrebarea: cum arată Ecranul de la ușă pe fundal închis, cu
 * QR-ul pe un card alb și cronometrul pe conturul cardului? Trei variante pe aceeași rută `/door`, cu datele reale
 * de la server, comutate cu `?variant=A|B|C` (0 = ecranul actual). `?stale=1` arată starea „codul nu se mai
 * actualizează”. Cod de aruncat: fără teste, fără grijă pentru telefonul vechi (vezi ADR-0005).
 */
import "@fontsource-variable/inter";
import "@/index.css";
import "./door.prototype.css";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import logoUrl from "@/design/logo.svg";
import type { DoorCode } from "@/employee/api";
import { cn } from "@/lib/utils";
import { LiveBackground } from "@/prototype/LiveBackground";

export const DOOR_VARIANTS = [
  { key: "A", name: "Aurora" },
  { key: "B", name: "Ghid pas cu pas" },
  { key: "C", name: "Halo, imersiv" },
  { key: "0", name: "Actual" },
] as const;

export type DoorVariantProps = { code: DoorCode | null; stale: boolean };

const WARNING = "Codul nu se mai actualizează. Verifică Wi-Fi-ul telefonului.";
const URGENT_SECONDS = 5;

/** Secundele rămase din codul curent, numărate local de la primirea lui. */
function useCountdown(code: DoorCode | null) {
  const receivedAt = useMemo(() => Date.now(), [code?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  if (!code) return { remaining: 0, period: 30, elapsedAtReceipt: 0 };
  const remaining = Math.max(0, Math.ceil(code.remaining_seconds - (now - receivedAt) / 1000));
  return { remaining, period: code.period_seconds, elapsedAtReceipt: code.period_seconds - code.remaining_seconds };
}

/** Conturul-cronometru: un dreptunghi rotunjit care se golește; stă peste marginea cardului. */
function Contour({
  code,
  stale,
  radius,
  width = 6,
  track = "rgb(255 255 255 / 0.12)",
  color = "#60a5fa",
  urgent,
}: {
  code: DoorCode | null;
  stale: boolean;
  radius: number;
  width?: number;
  track?: string;
  color?: string;
  urgent: boolean;
}) {
  const { period, elapsedAtReceipt } = useCountdown(code);
  const half = width / 2;
  const rect = { x: half, y: half, rx: radius, style: { width: `calc(100% - ${width}px)`, height: `calc(100% - ${width}px)` } };
  return (
    <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
      <rect {...rect} fill="none" stroke={track} strokeWidth={width} />
      {code && (
        <rect
          key={code.url}
          {...rect}
          pathLength={100}
          fill="none"
          strokeWidth={width}
          strokeLinecap="round"
          className="proto-contour"
          stroke={stale ? "#6b7280" : urgent ? "#fb923c" : color}
          style={
            {
              ...rect.style,
              "--proto-duration": `${period}s`,
              "--proto-delay": `-${elapsedAtReceipt}s`,
              animationPlayState: stale ? "paused" : "running",
            } as CSSProperties
          }
        />
      )}
    </svg>
  );
}

function Qr({ code, stale }: DoorVariantProps) {
  if (!code) return <div className="size-full animate-pulse rounded-xl bg-neutral-200" />;
  return (
    <div
      key={code.url}
      role="img"
      aria-label="Cod QR pentru Intrare sau Ieșire"
      className={cn("proto-qr-in size-full [&_svg]:block [&_svg]:size-full", stale && "opacity-15")}
      dangerouslySetInnerHTML={{ __html: withViewBox(code.svg) }}
    />
  );
}

/** SVG-ul de la server are doar `width`/`height`, fără `viewBox`, deci nu se scalează. La implementare: `omitsize` în segno. */
function withViewBox(svg: string) {
  if (svg.includes("viewBox")) return svg;
  return svg.replace(/width="(\d+)" height="(\d+)"/, 'viewBox="0 0 $1 $2"');
}

function Warning({ className }: { className?: string }) {
  return (
    <p role="alert" className={cn("rounded-2xl bg-red-500/15 px-5 py-3.5 text-[17px] font-semibold text-red-200 ring-1 ring-red-400/30", className)}>
      {WARNING}
    </p>
  );
}

/* ───────────────────────── A · Aurora ─────────────────────────
 * Centrat, clasic: logo, titlu, cardul QR cu strălucire, sub el o pastilă „Cod nou în 12 s”.
 * Fundal: bleumarin cu trei pete de lumină care se mișcă foarte lent. */
export function DoorVariantA({ code, stale }: DoorVariantProps) {
  const { remaining } = useCountdown(code);
  const urgent = !stale && !!code && remaining <= URGENT_SECONDS;
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden bg-[#050a1c] px-6 text-center font-sans text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="proto-aurora-1 absolute -top-1/4 -left-1/4 size-[90vmax] rounded-full bg-[radial-gradient(circle,rgb(37_99_235/0.55),transparent_60%)] blur-3xl" />
        <div className="proto-aurora-2 absolute -right-1/3 -bottom-1/4 size-[80vmax] rounded-full bg-[radial-gradient(circle,rgb(14_165_233/0.35),transparent_60%)] blur-3xl" />
        <div className="proto-aurora-3 absolute top-1/3 left-1/4 size-[60vmax] rounded-full bg-[radial-gradient(circle,rgb(99_102_241/0.30),transparent_60%)] blur-3xl" />
      </div>

      <div className="relative flex items-center gap-3 text-[20px] font-semibold tracking-tight">
        <img src={logoUrl} alt="" width={40} height={40} className="rounded-xl shadow-[0_0_24px_rgb(37_99_235/0.6)]" />
        GymCtrl
      </div>
      <h1 className="relative mt-6 text-[30px] leading-tight font-bold tracking-tight">
        Scanează pentru
        <br />
        <span className="bg-gradient-to-r from-sky-300 to-blue-400 bg-clip-text text-transparent">Intrare / Ieșire</span>
      </h1>

      <div className="relative mt-8 aspect-square w-[min(80vw,52vh)] p-[14px]">
        <Contour code={code} stale={stale} radius={34} urgent={urgent} />
        <div className="size-full rounded-[24px] bg-white p-3 shadow-[0_0_60px_rgb(37_99_235/0.45),0_20px_50px_rgb(0_0_0/0.5)]">
          <Qr code={code} stale={stale} />
        </div>
      </div>

      {stale ? (
        <Warning className="relative mt-7 max-w-md" />
      ) : (
        <div
          className={cn(
            "relative mt-7 inline-flex items-center gap-2.5 rounded-full bg-white/10 px-5 py-2.5 text-[17px] font-medium ring-1 ring-white/15 backdrop-blur-md transition-colors",
            urgent && "bg-orange-500/20 text-orange-200 ring-orange-300/40",
          )}
        >
          <span className={cn("size-2 rounded-full bg-sky-400", urgent && "proto-pulse bg-orange-400")} />
          <span>
            Cod nou în <span className="tabular-nums">{remaining}</span> s
          </span>
        </div>
      )}
    </main>
  );
}

/* ───────────────────────── B · Ghid pas cu pas ─────────────────────────
 * Instrucțiunile vin în prim-plan: bară de sus cu logo și ceas, QR-ul mare, apoi un panou de sticlă cu cei
 * trei pași și secundele mari. Fundal: degradeu adânc cu o rază de lumină care trece încet. */
export function DoorVariantB({ code, stale }: DoorVariantProps) {
  const { remaining, period } = useCountdown(code);
  const urgent = !stale && !!code && remaining <= URGENT_SECONDS;
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);
  const steps = ["Deschide camera telefonului", "Îndreaptă-l spre cod", "Apasă Intrare sau Ieșire"];
  return (
    <main className="fixed inset-0 flex flex-col overflow-hidden bg-[linear-gradient(160deg,#0b1f4d_0%,#060b1d_55%,#0a1230_100%)] font-sans text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="proto-sheen absolute -top-1/2 left-0 h-[200%] w-1/3 bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
      </div>

      <header className="relative flex items-center justify-between px-6 pt-6">
        <div className="flex items-center gap-2.5 text-[18px] font-semibold">
          <img src={logoUrl} alt="" width={32} height={32} />
          GymCtrl
        </div>
        <div className="text-[18px] font-medium text-white/60 tabular-nums">
          {clock.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}
        </div>
      </header>

      <div className="relative flex flex-1 flex-col items-center justify-center px-6">
        <p className="text-[15px] font-semibold tracking-[0.2em] text-sky-300/80 uppercase">Intrare · Ieșire</p>
        <div className="relative mt-4 aspect-square w-[min(84vw,48vh)] p-[12px]">
          <Contour code={code} stale={stale} radius={30} width={5} color="#ffffff" urgent={urgent} />
          <div className="size-full rounded-[22px] bg-white p-3">
            <Qr code={code} stale={stale} />
          </div>
        </div>
      </div>

      <section className="relative m-4 mt-0 rounded-[28px] bg-white/[0.07] p-5 ring-1 ring-white/10 backdrop-blur-xl">
        {stale ? (
          <Warning />
        ) : (
          <div className="flex items-center gap-5">
            <ol className="flex flex-1 flex-col gap-3">
              {steps.map((step, index) => (
                <li key={step} className="flex items-center gap-3 text-[17px] font-medium">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-sky-400 text-[15px] font-bold">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <div className="flex w-20 flex-col items-center border-l border-white/10 pl-5">
              <span className={cn("text-[40px] leading-none font-bold tabular-nums", urgent && "text-orange-300")}>{remaining}</span>
              <span className="mt-1 text-[13px] text-white/55">din {period} s</span>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

/* ───────────────────────── C · Halo, imersiv ─────────────────────────
 * Aproape fără text: QR-ul ocupă tot lățimea, cu un halou conic care se rotește în spate. Secundele stau într-o
 * insignă așezată pe marginea de jos a conturului. Fundal: negru-bleumarin cu o grilă de puncte care alunecă. */
export function DoorVariantC({ code, stale }: DoorVariantProps) {
  const { remaining } = useCountdown(code);
  const urgent = !stale && !!code && remaining <= URGENT_SECONDS;
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-between overflow-hidden bg-[#03060f] pt-[max(2rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] font-sans text-white">
      <LiveBackground tone="door" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-[radial-gradient(ellipse_at_top,rgb(37_99_235/0.25),transparent_70%)]" />

      <h1 className="relative text-center text-[26px] leading-snug font-semibold text-white/90">
        Scanează codul
        <span className="block text-[17px] font-normal text-white/55">pentru Intrare sau Ieșire</span>
      </h1>

      <div className="relative aspect-square w-[min(84vw,56dvh)]">
        <div aria-hidden className="absolute -inset-[8%] grid place-items-center">
          <div
            className={cn(
              "proto-halo size-full rounded-full opacity-90 blur-3xl",
              "bg-[conic-gradient(from_0deg,#2563eb,#22d3ee,#a855f7,#2563eb,#22d3ee,#2563eb)]",
              stale && "opacity-20 grayscale",
            )}
          />
        </div>
        <div className="relative size-full p-[10px]">
          <Contour code={code} stale={stale} radius={36} width={7} color="#ffffff" track="rgb(255 255 255 / 0.18)" urgent={urgent} />
          <div className="size-full rounded-[28px] bg-white p-4 shadow-[0_30px_80px_rgb(0_0_0/0.6)]">
            <Qr code={code} stale={stale} />
          </div>
        </div>
        {!stale && code && (
          <div
            className={cn(
              "absolute -bottom-5 left-1/2 flex -translate-x-1/2 items-baseline gap-1 rounded-full bg-[#03060f] px-4 py-1.5 ring-2 ring-white/80",
              urgent && "ring-orange-400",
            )}
          >
            <span className={cn("text-[22px] font-bold tabular-nums", urgent && "text-orange-300")}>{remaining}</span>
            <span className="text-[13px] text-white/60">s</span>
          </div>
        )}
      </div>

      <div className="relative flex w-full flex-col items-center gap-4">
        {stale && <Warning className="max-w-md text-center" />}
        <div className="flex items-center gap-2 text-[15px] font-medium text-white/45">
          <img src={logoUrl} alt="" width={22} height={22} className="opacity-80" />
          GymCtrl
        </div>
      </div>
    </main>
  );
}
