import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import logoUrl from "@/design/logo.svg";
import { LiveBackground } from "@/design/LiveBackground";
import { EmployeeApiError, employeeApi, type DoorCode } from "@/employee/api";
import { cn } from "@/lib/utils";
import "./door.css";

/*
 * Ecranul de la ușă: telefonul fix, montat vertical, care arată QR-ul pentru Intrare și Ieșire. Rulează pe un telefon
 * nou (ADR-0005), deci folosește sistemul de design comun; pachetul `/door` rămâne totuși mic: fără react-query și
 * fără router, doar `fetch` și temporizatoare (`doorMain.tsx` îl montează direct).
 *
 * Aspect: fundal închis cu fundalul viu, QR-ul pe un card alb, un halou care se rotește încet în spate, iar
 * conturul cardului e cronometrul: se golește într-o perioadă a codului (animație CSS pornită „în urmă” cu secundele
 * deja trecute, vezi `door.css`), cu secundele rămase într-o insignă pe marginea de jos.
 */

/** Cât de des se cere codul când mai e mult până la schimbare; aproape de schimbare se cere chiar atunci. */
const MAX_POLL_MS = 10_000;
const RETRY_MS = 3_000;
/** Dacă nu s-a reușit nicio reîmprospătare în atâta timp (o perioadă a codului), ecranul avertizează. */
const STALE_MS = 30_000;

const WARNING = "Codul nu se mai actualizează. Verifică Wi-Fi-ul telefonului.";

type Blocked = "door_not_configured" | "door_token_invalid";

function isBlocked(error: unknown): error is EmployeeApiError & { reason: Blocked } {
  return (
    error instanceof EmployeeApiError && (error.reason === "door_not_configured" || error.reason === "door_token_invalid")
  );
}

/** Codul curent de la server, reîmprospătat periodic. `stale`: reîmprospătarea nu mai reușește. */
function useDoorCode() {
  const [code, setCode] = useState<DoorCode | null>(null);
  const [stale, setStale] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);

  useEffect(() => {
    let alive = true;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    let haveCode = false;

    const armStale = () => {
      clearTimeout(staleTimer);
      staleTimer = setTimeout(() => alive && setStale(true), STALE_MS);
    };

    const poll = () => {
      employeeApi.doorCode().then(
        (next) => {
          if (!alive) return;
          haveCode = true;
          // Același cod: păstrăm starea, ca inelul să nu pornească de la capăt.
          setCode((prev) => (prev && prev.url === next.url ? prev : next));
          setStale(false);
          setBlocked(null);
          armStale();
          pollTimer = setTimeout(poll, Math.min(next.remaining_seconds * 1000 + 500, MAX_POLL_MS));
        },
        (error: unknown) => {
          if (!alive) return;
          if (isBlocked(error)) {
            clearTimeout(staleTimer);
            setBlocked(error.reason);
            return; // se rezolvă doar printr-o nouă Activare din aplicație: nu mai insistăm
          }
          if (!haveCode) setStale(true); // niciun cod de arătat: nu lăsăm un ecran gol fără explicație
          pollTimer = setTimeout(poll, RETRY_MS);
        },
      );
    };

    armStale();
    poll();
    return () => {
      alive = false;
      clearTimeout(pollTimer);
      clearTimeout(staleTimer);
    };
  }, []);

  return { code, stale, blocked };
}

/** În ultimele secunde conturul și insigna se fac portocalii: codul e pe cale să se schimbe. */
const URGENT_SECONDS = 5;

/** Secundele rămase din codul curent, numărate local de la primirea lui (serverul dă `remaining_seconds`). */
function useSecondsLeft(code: DoorCode | null) {
  const [receivedAt, setReceivedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const at = Date.now();
    setReceivedAt(at);
    setNow(at);
  }, [code]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  if (!code) return 0;
  return Math.max(0, Math.ceil(code.remaining_seconds - (now - receivedAt) / 1000));
}

/** Cadrul comun: fundalul închis și viu, marginile sigure ale telefonului, logoul jos. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="fixed inset-0 flex flex-col items-center justify-between overflow-hidden bg-[#03060f] pt-[max(2rem,env(safe-area-inset-top))] pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))] text-center font-sans text-white [color-scheme:dark]">
      <LiveBackground tone="dark" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-[radial-gradient(ellipse_at_top,rgb(37_99_235/0.25),transparent_70%)]"
      />
      {children}
      <div className="relative flex items-center gap-2 text-[15px] font-medium text-white/45">
        <img src={logoUrl} alt="GymCtrl" width={22} height={22} className="opacity-80" />
        <span aria-hidden>GymCtrl</span>
      </div>
    </main>
  );
}

function Explanation({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Frame>
      <div className="relative my-auto flex max-w-md flex-col gap-3">
        <h1 className="text-[26px] leading-snug font-semibold">{title}</h1>
        <p className="text-[17px] leading-relaxed text-white/70">{children}</p>
      </div>
    </Frame>
  );
}

/** `/door`: QR mare, negru pe alb, cu conturul-cronometru; doar pentru telefonul activat. */
export function Door() {
  const { code, stale, blocked } = useDoorCode();
  const secondsLeft = useSecondsLeft(code);

  if (blocked === "door_token_invalid") {
    return (
      <Explanation title="Acest telefon nu mai este Ecranul de la ușă">
        Acest telefon a fost înlocuit sau scos din uz. Cere Adminului un link nou de activare, dacă e cazul.
      </Explanation>
    );
  }
  if (blocked === "door_not_configured") {
    return (
      <Explanation title="Telefon neactivat">
        Acest telefon nu este activat ca Ecran de la ușă. Cere Adminului să activeze Ecranul de la ușă din aplicație și
        deschide linkul primit pe acest telefon.
      </Explanation>
    );
  }

  const running = !!code && !stale;
  const urgent = running && secondsLeft <= URGENT_SECONDS;
  const elapsed = code ? code.period_seconds - code.remaining_seconds : 0;
  return (
    <Frame>
      <h1 className="relative text-[26px] leading-snug font-semibold text-white/90">
        Scanează codul
        <span className="block text-[17px] font-normal text-white/55">pentru Intrare sau Ieșire</span>
      </h1>

      {/* variabilele CSS leagă conturul de secundele rămase; `data-state` îl oprește când reîmprospătarea pică */}
      <div
        role="timer"
        aria-label="Timp rămas până la schimbarea codului"
        data-state={running ? "running" : "stopped"}
        data-urgent={urgent || undefined}
        className="door-timer relative aspect-square w-[min(84vw,56dvh)]"
        style={
          {
            "--door-contour-duration": `${code ? code.period_seconds : 30}s`,
            "--door-contour-delay": `-${elapsed}s`,
          } as CSSProperties
        }
      >
        <div aria-hidden className="absolute -inset-[8%] grid place-items-center">
          <div className={cn("door-halo size-full rounded-full opacity-90 blur-3xl", !running && "opacity-20 grayscale")} />
        </div>
        <div className="relative size-full p-[10px]">
          <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden focusable="false">
            <rect className="door-contour-track" x="3.5" y="3.5" rx="36" />
            {code && (
              // `key`: la un cod nou, animația pornește din nou
              <rect key={code.url} className="door-contour" x="3.5" y="3.5" rx="36" pathLength={100} />
            )}
          </svg>
          <div className="size-full rounded-[28px] bg-white p-4 shadow-[0_30px_80px_rgb(0_0_0/0.6)]">
            {code ? (
              <div
                key={code.url}
                role="img"
                aria-label="Cod QR pentru Intrare sau Ieșire"
                className={cn("door-qr size-full [&_svg]:block [&_svg]:size-full", stale && "opacity-15")}
                dangerouslySetInnerHTML={{ __html: code.svg }}
              />
            ) : (
              <div className="size-full animate-pulse rounded-xl bg-neutral-200" />
            )}
          </div>
        </div>
        {running && (
          <div className="door-seconds absolute -bottom-5 left-1/2 flex -translate-x-1/2 items-baseline gap-1 rounded-full bg-[#03060f] px-4 py-1.5 ring-2">
            <span className="text-[22px] font-bold tabular-nums">{secondsLeft}</span>
            <span className="text-[13px] text-white/60">s</span>
          </div>
        )}
      </div>

      {stale ? (
        <p
          role="alert"
          className="relative max-w-md rounded-2xl bg-red-500/15 px-5 py-3.5 text-[17px] font-semibold text-red-200 ring-1 ring-red-400/30"
        >
          {WARNING}
        </p>
      ) : (
        // ține locul avertismentului, ca QR-ul să nu sară când apare
        <span aria-hidden className="h-0" />
      )}
    </Frame>
  );
}
