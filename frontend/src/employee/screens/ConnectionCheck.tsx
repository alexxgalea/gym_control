import { useQuery } from "@tanstack/react-query";
import { Wifi, WifiOff } from "lucide-react";
import { employeeApi } from "@/employee/api";
import { Logo } from "@/design/Logo";
import { ScreenHeader } from "@/design/ScreenHeader";
import { Skeleton } from "@/design/Skeleton";
import { StatusBadge } from "@/design/StatusBadge";
import { formatDateTime } from "@/lib/format";

/** `/status`: dacă telefonul e în rețeaua Sălii și ce oră are serverul (în ora Sălii). */
export function ConnectionCheck() {
  const { data, error, isPending } = useQuery({ queryKey: ["employee", "status"], queryFn: employeeApi.status });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <Logo size={40} />
      <ScreenHeader title="Verificare conexiune" description="Vezi dacă telefonul tău e în rețeaua Sălii." />
      {isPending && <Skeleton rows={2} />}
      {error && (
        <p role="alert" className="rounded-2xl bg-destructive/10 p-4 text-[15px] text-destructive">
          {error.message}
        </p>
      )}
      {data && (
        <section className="flex flex-col gap-5 rounded-2xl bg-card p-5">
          <div className="flex items-center gap-4">
            <span
              className={`flex size-14 shrink-0 items-center justify-center rounded-full ${
                data.in_hall ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
              }`}
            >
              {data.in_hall ? <Wifi className="size-7" aria-hidden /> : <WifiOff className="size-7" aria-hidden />}
            </span>
            <div className="min-w-0">
              <p className="text-lg font-semibold">{data.in_hall ? "Ești în rețeaua Sălii" : "Nu ești în rețeaua Sălii"}</p>
              {!data.in_hall && (
                <p className="mt-0.5 text-[15px] text-muted-foreground">
                  Conectează-te la Wi-Fi-ul Sălii și încearcă din nou.
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-border pt-4 text-[15px]">
            <span className="text-muted-foreground">Ora serverului</span>
            <StatusBadge>
              <span className="tabular-nums">
                {formatDateTime(data.server_time, data.time_zone, new Date(data.server_time))}
              </span>
            </StatusBadge>
          </div>
        </section>
      )}
    </main>
  );
}
