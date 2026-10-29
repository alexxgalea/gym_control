import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, adminApi, type Incident } from "@/api/client";
import { errorText, isShownError } from "@/lib/errors";
import { formatLocalDateTime } from "@/lib/format";
import { ErrorAlert } from "@/components/ErrorAlert";
import { useToast } from "@/components/toast";
import { Button } from "@/design/button";
import { ConfirmDialog } from "@/design/ConfirmDialog";
import { EmptyState } from "@/design/EmptyState";
import { ScreenHeader } from "@/design/ScreenHeader";
import { Sheet } from "@/design/Sheet";
import { Skeleton } from "@/design/Skeleton";
import { StatusBadge } from "@/design/StatusBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { INCIDENTS_KEY } from "@/lib/queryKeys";

export function Incidents() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const incidents = useQuery({ queryKey: INCIDENTS_KEY, queryFn: adminApi.incidents.list });
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState<Incident | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: INCIDENTS_KEY });
  const close = useMutation({
    mutationFn: (incident: Incident) => adminApi.incidents.close(incident.id),
    onSuccess: async () => {
      setClosing(null);
      toast("Incident închis");
      await refresh();
    },
    onError: async (error) => {
      setClosing(null);
      toast(errorText(error), "error");
      await refresh();
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader
        title="Incidente"
        description="Cât timp un Incident e deschis, datele din intervalul lui nu se șterg."
        actions={
          <Button onClick={() => setOpening(true)}>
            <Plus className="size-4" aria-hidden /> Deschide un Incident
          </Button>
        }
      />

      {incidents.isPending && <Skeleton />}
      {isShownError(incidents.error) && <ErrorAlert>{incidents.error.detail}</ErrorAlert>}
      {incidents.data?.length === 0 && (
        <EmptyState
          icon={ShieldCheck}
          text="Niciun Incident. Dacă se întâmplă ceva în Sală, deschide un Incident ca să-i protejezi datele de ștergere."
        />
      )}
      {incidents.data && incidents.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {incidents.data.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} onClose={() => setClosing(incident)} />
          ))}
        </ul>
      )}

      <OpenIncidentSheet
        open={opening}
        onClose={() => setOpening(false)}
        onOpened={async () => {
          setOpening(false);
          toast("Incident deschis");
          await refresh();
        }}
      />
      <ConfirmDialog
        open={closing !== null}
        onOpenChange={(next) => !next && setClosing(null)}
        title="Închizi Incidentul?"
        description="Datele din interval intră din nou sub Perioada de păstrare și pot fi șterse la următoarea rulare."
        confirmLabel="Închide Incidentul"
        destructive
        pending={close.isPending}
        onConfirm={() => closing && close.mutate(closing)}
      />
    </div>
  );
}

function IncidentCard({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const isOpen = incident.status === "open";
  const when = (local: string) => formatLocalDateTime(local, incident.timezone);
  return (
    <li
      data-status={incident.status}
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-card p-4 shadow-card"
    >
      <div className="min-w-0">
        <p className="font-semibold">
          {when(incident.start)} – {when(incident.end)}
        </p>
        {incident.note && <p className="mt-0.5 text-[15px]">{incident.note}</p>}
        <p className="mt-0.5 text-sm text-muted-foreground">Deschis de {incident.created_by}</p>
      </div>
      <div className="flex items-center gap-3">
        {isOpen ? (
          <StatusBadge tone="danger">Deschis</StatusBadge>
        ) : (
          <StatusBadge>
            Închis de {incident.closed_by}, {when(incident.closed_at!)}
          </StatusBadge>
        )}
        {isOpen && (
          <Button size="sm" variant="outline" onClick={onClose}>
            Închide
          </Button>
        )}
      </div>
    </li>
  );
}

type Errors = { start?: string; end?: string; note?: string; form?: string };

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

/** Data și ora din selectoare, în forma pe care o așteaptă serverul (`AAAA-LL-ZZTHH:MM`); goală dacă nu s-a ales nimic. */
const joinMoment = (date: string, time: string) => (date || time ? `${date}T${time}` : "");

function OpenIncidentSheet({
  open,
  onClose,
  onOpened,
}: {
  open: boolean;
  onClose: () => void;
  onOpened: () => void;
}) {
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const create = useMutation({
    mutationFn: adminApi.incidents.create,
    onSuccess: () => {
      setStartDate("");
      setStartTime("");
      setEndDate("");
      setEndTime("");
      setNote("");
      setErrors({});
      onOpened();
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.field === "start" || error.field === "end" || error.field === "note")) {
        setErrors({ [error.field]: error.detail });
      } else {
        setErrors({ form: errorText(error) });
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    create.mutate({ start: joinMoment(startDate, startTime), end: joinMoment(endDate, endTime), note });
  };

  const described = (name: keyof Errors) => ({
    "aria-invalid": errors[name] ? (true as const) : undefined,
    "aria-describedby": errors[name] ? `incident-${name}-error` : undefined,
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Incident nou"
      description="Cât timp Incidentul e deschis, datele din interval nu se șterg. Orele sunt cele ale Sălii."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <ErrorAlert>{errors.form}</ErrorAlert>}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">Începe</legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="incident-start-date">Data de început</Label>
              <Input
                id="incident-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                {...described("start")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="incident-start-time">Ora de început</Label>
              <Input
                id="incident-start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                {...described("start")}
              />
            </div>
          </div>
          <FieldError id="incident-start-error" message={errors.start} />
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">Se termină</legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="incident-end-date">Data de sfârșit</Label>
              <Input
                id="incident-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                {...described("end")}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="incident-end-time">Ora de sfârșit</Label>
              <Input
                id="incident-end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                {...described("end")}
              />
            </div>
          </div>
          <FieldError id="incident-end-error" message={errors.end} />
        </fieldset>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="incident-note">Notă (opțional)</Label>
          <Input
            id="incident-note"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            {...described("note")}
          />
          <FieldError id="incident-note-error" message={errors.note} />
        </div>
        <Button type="submit" disabled={create.isPending}>
          Deschide Incidentul
        </Button>
      </form>
    </Sheet>
  );
}
