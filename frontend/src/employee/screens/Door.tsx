import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import logoUrl from "@/design/logo.svg";
import { EmployeeApiError, employeeApi, type DoorCode } from "@/employee/api";
import "./door.css";

/*
 * Ecranul de la ușă. Rulează pe un telefon vechi, deci (ADR-0003, „Ținta de build”):
 * - fără biblioteca de animații și fără componentele din sistemul de design care o folosesc;
 * - inelul-cronometru e o animație CSS, pornită „în urmă” cu secundele deja trecute (vezi `door.css`);
 * - fără react-query și fără router: doar `fetch` și temporizatoare (`doorMain.tsx` o montează direct). Pe un
 *   browser vechi, orice modul în plus încărcat la pornire e un risc (de ex. react-query citește `globalThis`).
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
function useDoorCode(enabled: boolean) {
  const [code, setCode] = useState<DoorCode | null>(null);
  const [stale, setStale] = useState(false);
  const [blocked, setBlocked] = useState<Blocked | null>(null);

  useEffect(() => {
    if (!enabled) return;
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
            return; // se rezolvă doar deschizând linkul de configurare: nu mai insistăm
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
  }, [enabled]);

  return { code, stale, blocked };
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="door-screen">
      <div className="door-brand">
        <img src={logoUrl} alt="GymCtrl" width={36} height={36} />
        <span>GymCtrl</span>
      </div>
      {children}
    </main>
  );
}

function Explanation({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Frame>
      <h1 className="door-title">{title}</h1>
      <p className="door-text">{children}</p>
    </Frame>
  );
}

const RING_RADIUS = 104;

/** `/door` și `/door?k=<token>`: QR mare, negru pe alb, cu un inel-cronometru în jurul lui. */
export function Door({ setupToken }: { setupToken: string | null }) {
  const configuredWith = setupToken; // serverul redirecționează `?k=` doar când tokenul e corect
  const { code, stale, blocked } = useDoorCode(configuredWith === null);

  if (configuredWith !== null || blocked === "door_token_invalid") {
    return (
      <Explanation title="Link de configurare greșit">
        Linkul de configurare nu este corect sau nu mai e valabil. Cere Adminului linkul exact și deschide-l din nou pe
        acest telefon.
      </Explanation>
    );
  }
  if (blocked === "door_not_configured") {
    return (
      <Explanation title="Telefon neconfigurat">
        Acest telefon nu este configurat ca Ecran de la ușă. Cere Adminului linkul de configurare și deschide-l o
        singură dată pe acest telefon.
      </Explanation>
    );
  }

  const elapsed = code ? code.period_seconds - code.remaining_seconds : 0;
  return (
    <Frame>
      <h1 className="door-title">Scanează pentru Intrare / Ieșire</h1>
      {/* variabilele CSS leagă inelul de secundele rămase; `data-state` îl oprește când reîmprospătarea pică */}
      <div
        role="timer"
        aria-label="Timp rămas până la schimbarea codului"
        className="door-ring-box"
        data-state={code && !stale ? "running" : "stopped"}
        style={
          {
            "--door-ring-duration": `${code ? code.period_seconds : 30}s`,
            "--door-ring-delay": `-${elapsed}s`,
          } as CSSProperties
        }
      >
        <svg className="door-ring" viewBox="0 0 220 220" aria-hidden="true" focusable="false">
          <circle className="door-ring-track" cx="110" cy="110" r={RING_RADIUS} />
          {code && (
            // `key`: la un cod nou, animația pornește din nou
            <circle
              key={code.url}
              className="door-ring-progress"
              cx="110"
              cy="110"
              r={RING_RADIUS}
              transform="rotate(-90 110 110)"
            />
          )}
        </svg>
        {code && (
          <div
            key={code.url}
            role="img"
            aria-label="Cod QR pentru Intrare sau Ieșire"
            className={stale ? "door-qr door-qr-stale" : "door-qr"}
            dangerouslySetInnerHTML={{ __html: code.svg }}
          />
        )}
      </div>
      {stale ? (
        <p role="alert" className="door-warning">
          {WARNING}
        </p>
      ) : (
        <p className="door-text">Codul se schimbă automat la 30 de secunde.</p>
      )}
    </Frame>
  );
}
