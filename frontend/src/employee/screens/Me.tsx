import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DoorOpen, LogIn, LogOut, QrCode, ShieldAlert, SmartphoneNfc, WifiOff } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Logo } from "@/design/Logo";
import { Skeleton } from "@/design/Skeleton";
import { Button } from "@/design/button";
import { formatDateTime } from "@/lib/format";
import { EmployeeApiError, employeeApi, type EventResult, type MeState } from "@/employee/api";

/** După cât timp petrecut în Sală inelul e plin (decizie de design: o zi de lucru). */
const FULL_RING_MS = 8 * 3600 * 1000;
const SUCCESS_MS = 2000;

type Problem = { reason: string | null; detail: string };

const toProblem = (error: unknown): Problem =>
  error instanceof EmployeeApiError
    ? { reason: error.reason, detail: error.detail }
    : { reason: null, detail: "A apărut o eroare. Încearcă din nou." };

/** `/me?t=<cod>`: ecranul Angajatului, un inel cu un buton rotund mare (Intrare sau Ieșire). */
export function Me() {
  const [params, setParams] = useSearchParams();
  const code = params.get("t") ?? "";
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ["employee", "me"], queryFn: employeeApi.me });
  const [success, setSuccess] = useState<EventResult | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const record = useMutation({
    mutationFn: (inside: boolean) => (inside ? employeeApi.exit(code) : employeeApi.entry(code)),
    onSuccess: (result) => {
      setProblem(null);
      setSuccess(result);
    },
    onError: (error) => setProblem(toProblem(error)),
  });

  // După ~2 secunde confirmarea face loc stării noi.
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => {
      setSuccess(null);
      // codul scanat e bun pentru o singură acțiune: următoarea Intrare sau Ieșire cere o nouă scanare
      setParams({}, { replace: true });
      void queryClient.invalidateQueries({ queryKey: ["employee", "me"] });
    }, SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [success, queryClient, setParams]);

  const failure = problem ?? (state.error ? toProblem(state.error) : null);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center gap-6 px-4 py-8">
      <Logo size={40} />
      {state.isPending && <Skeleton rows={3} />}
      {failure && <ProblemScreen problem={failure} onBack={problem ? () => setProblem(null) : undefined} />}
      {!failure && state.data && (
        <Main state={state.data} code={code} success={success} busy={record.isPending} onPress={record.mutate} />
      )}
    </main>
  );
}

function Main({
  state,
  code,
  success,
  busy,
  onPress,
}: {
  state: MeState;
  code: string;
  success: EventResult | null;
  busy: boolean;
  onPress: (inside: boolean) => void;
}) {
  const inside = state.inside_since !== null;
  const now = new Date(state.server_time);
  const elapsed = inside ? now.getTime() - new Date(state.inside_since!).getTime() : 0;
  const progress = success ? 1 : Math.min(Math.max(elapsed / FULL_RING_MS, 0), 1);
  const stateLine = inside
    ? `În Sală din ${formatDateTime(state.inside_since!, state.time_zone, now)}`
    : "În afara Sălii";

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">{state.name}</h1>
      <Ring progress={progress} done={!!success}>
        {success ? (
          <Tick />
        ) : code ? (
          <Button
            size="lg"
            className="size-44 flex-col rounded-full text-2xl shadow-lg"
            disabled={busy}
            onClick={() => onPress(inside)}
          >
            {inside ? <LogOut className="size-9" aria-hidden /> : <LogIn className="size-9" aria-hidden />}
            {inside ? "Ieșire" : "Intrare"}
          </Button>
        ) : (
          <span className="flex size-44 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <QrCode className="size-16" strokeWidth={1.5} aria-hidden />
          </span>
        )}
      </Ring>
      {success ? (
        <p role="status" className="text-center text-lg font-semibold text-success">
          {success.message}
        </p>
      ) : (
        <>
          <p className="text-lg font-semibold">{stateLine}</p>
          {!code && (
            <p className="text-center text-[15px] text-muted-foreground">
              Scanează codul de la ușă ca să faci Intrare sau Ieșire.
            </p>
          )}
        </>
      )}
    </>
  );
}

function Ring({ progress, done, children }: { progress: number; done: boolean; children: React.ReactNode }) {
  return (
    <div className="relative flex size-64 items-center justify-center">
      <svg viewBox="0 0 256 256" className="pointer-events-none absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="128" cy="128" r="108" fill="none" strokeWidth="12" className="stroke-muted" />
        <motion.circle
          cx="128"
          cy="128"
          r="108"
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          className={done ? "stroke-success" : "stroke-primary"}
          initial={false}
          animate={{ pathLength: progress }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </svg>
      {children}
    </div>
  );
}

function Tick() {
  return (
    <span className="flex size-44 items-center justify-center rounded-full bg-success/15 text-success">
      <svg viewBox="0 0 24 24" className="size-20" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
        <motion.path
          d="M5 12.5l4.5 4.5L19 7.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        />
      </svg>
    </span>
  );
}

const SCREENS: Record<string, { icon: typeof WifiOff; title: string; hint: string }> = {
  not_in_hall_network: {
    icon: WifiOff,
    title: "Nu ești în rețeaua Sălii",
    hint: "Conectează-te la Wi-Fi-ul Sălii și încearcă din nou.",
  },
  phone_not_activated: {
    icon: SmartphoneNfc,
    title: "Telefonul nu este activat",
    hint: "Cere Adminului un link de activare.",
  },
  code_invalid: {
    icon: QrCode,
    title: "Codul nu mai e valabil",
    hint: "Scanează din nou codul de la ușă.",
  },
  no_open_entry: {
    icon: ShieldAlert,
    title: "Nu putem înregistra Ieșirea",
    hint: "Nu ai o Intrare deschisă azi. Se ocupă Adminul: îți corectează el Sesiunea.",
  },
  already_inside: {
    icon: DoorOpen,
    title: "Ești deja în Sală",
    hint: "Dacă ai uitat să faci Ieșire, se ocupă Adminul.",
  },
};

function ProblemScreen({ problem, onBack }: { problem: Problem; onBack?: () => void }) {
  const screen = SCREENS[problem.reason ?? ""] ?? {
    icon: ShieldAlert,
    title: "Ceva nu a mers",
    hint: problem.detail,
  };
  const Icon = screen.icon;
  return (
    <section role="alert" className="flex flex-col items-center gap-4 rounded-2xl bg-card p-6 text-center">
      <span className="flex size-20 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <Icon className="size-10" strokeWidth={1.75} aria-hidden />
      </span>
      <h1 className="text-xl font-bold">{screen.title}</h1>
      <p className="text-[15px] text-muted-foreground">{screen.hint}</p>
      {onBack && (
        <Button variant="outline" onClick={onBack}>
          {problem.reason === "not_in_hall_network" ? "Încearcă din nou" : "Înapoi"}
        </Button>
      )}
    </section>
  );
}
