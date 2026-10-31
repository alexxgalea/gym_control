import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, CheckCircle2, FileText, ShieldCheck, TriangleAlert, UserPlus, type LucideIcon } from "lucide-react";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { adminApi, type Anomaly } from "@/api/client";
import { ErrorAlert } from "@/components/ErrorAlert";
import { EmptyState } from "@/design/EmptyState";
import { ScreenHeader } from "@/design/ScreenHeader";
import { Skeleton } from "@/design/Skeleton";
import { StatusBadge } from "@/design/StatusBadge";
import { isShownError } from "@/lib/errors";
import { formatDuration, formatLocalDateTime, formatLocalTime } from "@/lib/format";
import { ANOMALIES_KEY, INCIDENTS_KEY, IN_HALL_KEY } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { AnomalyActions } from "@/screens/AnomalyActions";
import { AddSessionDialog } from "@/screens/ManualSession";

/** Datele paginii se reîmprospătează la 30 de secunde și când revii în fereastră. */
const REFRESH = { refetchInterval: 30_000, refetchOnWindowFocus: true } as const;

/**
 * Pagina de gestiune (Acasă): o grilă de plăcuțe. Pe telefon, ordinea e cea din cod:
 * Acum în Sală, De verificat, Incidente, Acțiuni rapide.
 */
export function Home() {
  const [addingSession, setAddingSession] = useState(false);
  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader title="Acasă" description="Cine e acum în Sală și ce ai de verificat." />
      <DoorScreenWarning />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <InHallTile />
        <ToCheckTile />
        <IncidentsTile />
        <section aria-labelledby="actiuni-rapide" className="flex flex-col gap-3 lg:col-span-2">
          <h2 id="actiuni-rapide" className="text-lg font-semibold">
            Acțiuni rapide
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <QuickAction icon={FileText} to="/reports">
              Generează un Raport de prezență
            </QuickAction>
            <QuickAction icon={UserPlus} to="/employees?nou">
              Adaugă un Angajat nou
            </QuickAction>
            <QuickAction icon={CalendarPlus} onClick={() => setAddingSession(true)}>
              Adaugă o Sesiune manuală
            </QuickAction>
          </div>
        </section>
      </div>
      <AddSessionDialog open={addingSession} onClose={() => setAddingSession(false)} />
    </div>
  );
}

/** Fără Ecran de la ușă activ nimeni nu poate face Intrare sau Ieșire; dispare imediat ce unul e activat. */
function DoorScreenWarning() {
  const inHall = useQuery({ queryKey: IN_HALL_KEY, queryFn: adminApi.inHall, ...REFRESH });
  if (inHall.data?.door_screen_active !== false) return null;
  return (
    <div role="alert" className="flex items-start gap-3 rounded-2xl bg-warning/15 p-4 text-[15px]">
      <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
      <p>
        Niciun Ecran de la ușă nu este activat, deci nimeni nu poate face Intrare sau Ieșire.{" "}
        <Link to="/door-screen" className="font-semibold text-primary hover:underline">
          Activează Ecranul de la ușă
        </Link>
      </p>
    </div>
  );
}

const TILE = "flex flex-col gap-3 rounded-2xl p-5";

function InHallTile() {
  const inHall = useQuery({ queryKey: IN_HALL_KEY, queryFn: adminApi.inHall, ...REFRESH });
  const people = inHall.data?.people ?? [];
  return (
    <section aria-labelledby="acum-in-sala" className={cn(TILE, "bg-gradient-brand shadow-card")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="acum-in-sala" className="text-lg font-semibold">
          Acum în Sală
        </h2>
        {inHall.data && <CountUp value={people.length} />}
      </div>
      {inHall.isPending && <Skeleton rows={2} className="[&>div]:bg-white/20" />}
      {isShownError(inHall.error) && <ErrorAlert>{inHall.error.detail}</ErrorAlert>}
      {inHall.data && people.length === 0 && <p className="text-[15px] text-white/80">Nimeni în Sală acum</p>}
      {people.length > 0 && (
        <ul className="flex flex-col divide-y divide-white/15">
          {people.map((person) => (
            <li key={person.session_id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0 truncate font-medium">{person.employee_name}</span>
              <span className="shrink-0 text-sm tabular-nums text-white/80">
                de la {formatLocalTime(person.entry_at)} · de {formatDuration(person.minutes)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Numărul mare din plăcuță; crește animat (fără animație la „Reduce motion”). */
function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const controls = animate(shown, value, { duration: 0.8, ease: "easeOut", onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
    // `shown` e doar punctul de pornire al animației
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced]);
  return (
    <span className="text-5xl font-bold tabular-nums leading-none">{reduced ? value : shown}</span>
  );
}

function ToCheckTile() {
  const anomalies = useQuery({ queryKey: ANOMALIES_KEY, queryFn: adminApi.anomalies.list, ...REFRESH });
  return (
    <section aria-labelledby="de-verificat" className={cn(TILE, "bg-card shadow-card lg:row-span-2")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="de-verificat" className="text-lg font-semibold">
          De verificat
        </h2>
        {anomalies.data && anomalies.data.length > 0 && <StatusBadge tone="warning">{anomalies.data.length}</StatusBadge>}
      </div>
      {anomalies.isPending && <Skeleton rows={3} />}
      {isShownError(anomalies.error) && <ErrorAlert>{anomalies.error.detail}</ErrorAlert>}
      {anomalies.data?.length === 0 && <EmptyState icon={CheckCircle2} text="Nicio Anomalie de verificat" />}
      {anomalies.data && anomalies.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {anomalies.data.map((anomaly) => (
            <ToCheckRow key={anomaly.id} anomaly={anomaly} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ToCheckRow({ anomaly }: { anomaly: Anomaly }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl bg-muted p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{anomaly.employee_name}</span>
        <StatusBadge tone="warning">{anomaly.label}</StatusBadge>
      </div>
      <p className="text-sm text-muted-foreground">
        <time>{formatLocalDateTime(anomaly.at, anomaly.timezone)}</time>
      </p>
      <div className="flex flex-wrap gap-2">
        <AnomalyActions anomaly={anomaly} />
      </div>
    </li>
  );
}

function IncidentsTile() {
  const incidents = useQuery({ queryKey: INCIDENTS_KEY, queryFn: adminApi.incidents.list, ...REFRESH });
  const open = incidents.data?.filter((incident) => incident.status === "open") ?? [];
  return (
    <section aria-labelledby="incidente-deschise" className={cn(TILE, "bg-card shadow-card")}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="incidente-deschise" className="text-lg font-semibold">
          Incidente deschise
        </h2>
        {incidents.data && <span className="text-3xl font-bold tabular-nums leading-none">{open.length}</span>}
      </div>
      {incidents.isPending && <Skeleton rows={1} />}
      {isShownError(incidents.error) && <ErrorAlert>{incidents.error.detail}</ErrorAlert>}
      {incidents.data && open.length === 0 && (
        <EmptyState icon={ShieldCheck} text="Niciun Incident deschis" />
      )}
      {open.length > 0 && (
        <>
          <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {open.map((incident) => (
              <li key={incident.id} className="truncate">
                {formatLocalDateTime(incident.start, incident.timezone)} – {formatLocalDateTime(incident.end, incident.timezone)}
                {incident.note && <> · {incident.note}</>}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">Datele din aceste intervale sunt protejate de ștergere.</p>
        </>
      )}
      <Link to="/incidents" className="text-sm font-semibold text-primary hover:underline">
        Vezi Incidentele
      </Link>
    </section>
  );
}

const ACTION = "flex min-h-28 flex-col items-start justify-between gap-3 rounded-2xl bg-card p-4 text-left text-[15px] font-semibold shadow-card hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function QuickAction({
  icon: Icon,
  to,
  onClick,
  children,
}: {
  icon: LucideIcon;
  to?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const content = (
    <>
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      {children}
    </>
  );
  return to ? (
    <Link to={to} className={ACTION}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cn(ACTION, "cursor-pointer")}>
      {content}
    </button>
  );
}
