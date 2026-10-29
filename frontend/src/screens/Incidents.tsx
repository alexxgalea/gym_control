import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, adminApi, type Incident } from "@/api/client";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const INCIDENTS_KEY = ["admin", "incidents"] as const;
const GENERIC_ERROR = "A apărut o eroare. Încearcă din nou.";
const errorText = (error: unknown) => (error instanceof ApiError ? error.detail : GENERIC_ERROR);

export function Incidents() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const incidents = useQuery({ queryKey: INCIDENTS_KEY, queryFn: adminApi.incidents.list });
  const [marking, setMarking] = useState(false);
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
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Incidente</h1>
        <Button onClick={() => setMarking(true)}>
          <Plus className="size-4" aria-hidden /> Marchează Incident
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Un Incident marchează un interval cu o pagubă sau o problemă. Datele din el nu se șterg (retenție) cât timp
        Incidentul e deschis. Orele sunt în ora locală.
      </p>

      {incidents.isPending && <p className="text-muted-foreground">Se încarcă…</p>}
      {incidents.isError && incidents.error instanceof ApiError && incidents.error.status !== 401 && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {incidents.error.detail}
        </p>
      )}
      {incidents.data && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Interval</th>
                <th className="px-4 py-3 font-medium">Notă</th>
                <th className="px-4 py-3 font-medium">Stare</th>
                <th className="px-4 py-3 font-medium">Marcat de</th>
                <th className="px-4 py-3 text-right font-medium">Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {incidents.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    Nu există Incidente.
                  </td>
                </tr>
              )}
              {incidents.data.map((incident) => {
                const isOpen = incident.status === "open";
                return (
                  <tr
                    key={incident.id}
                    data-status={incident.status}
                    className={cn("border-t border-border", isOpen ? "bg-destructive/5" : "text-muted-foreground")}
                  >
                    <td className="px-4 py-3">
                      {incident.start} – {incident.end}
                    </td>
                    <td className="px-4 py-3">{incident.note}</td>
                    <td className="px-4 py-3">
                      {isOpen ? (
                        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                          Deschis
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                          Închis ({incident.closed_at}, {incident.closed_by})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{incident.created_by}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        {isOpen && (
                          <Button size="sm" variant="outline" onClick={() => setClosing(incident)}>
                            Închide
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <MarkIncidentDialog
        open={marking}
        onClose={() => setMarking(false)}
        onMarked={async () => {
          setMarking(false);
          toast("Incident marcat");
          await refresh();
        }}
      />
      <Dialog open={closing !== null} onOpenChange={(next) => !next && setClosing(null)}>
        <DialogContent role="alertdialog">
          <DialogTitle>Închizi Incidentul?</DialogTitle>
          <DialogDescription>
            Datele din intervalul {closing?.start} – {closing?.end} reintră în retenția normală și pot fi șterse la
            următoarea rulare.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setClosing(null)}>
              Anulează
            </Button>
            <Button disabled={close.isPending} onClick={() => closing && close.mutate(closing)}>
              Închide Incidentul
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
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

function MarkIncidentDialog({
  open,
  onClose,
  onMarked,
}: {
  open: boolean;
  onClose: () => void;
  onMarked: () => void;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const create = useMutation({
    mutationFn: adminApi.incidents.create,
    onSuccess: () => {
      setStart("");
      setEnd("");
      setNote("");
      setErrors({});
      onMarked();
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
    create.mutate({ start, end, note });
  };

  const field = (name: "start" | "end" | "note") => ({
    "aria-invalid": errors[name] ? (true as const) : undefined,
    "aria-describedby": errors[name] ? `incident-${name}-error` : undefined,
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>Incident nou</DialogTitle>
        <DialogDescription>Datele din interval nu se vor șterge cât Incidentul e deschis. Orele sunt în ora locală.</DialogDescription>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {errors.form && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="incident-start">De la</Label>
            <Input
              id="incident-start"
              type="datetime-local"
              autoFocus
              value={start}
              onChange={(e) => setStart(e.target.value)}
              {...field("start")}
            />
            <FieldError id="incident-start-error" message={errors.start} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="incident-end">Până la</Label>
            <Input
              id="incident-end"
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              {...field("end")}
            />
            <FieldError id="incident-end-error" message={errors.end} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="incident-note">Notă (opțional)</Label>
            <Input
              id="incident-note"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              {...field("note")}
            />
            <FieldError id="incident-note-error" message={errors.note} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Anulează
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Marchează
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
