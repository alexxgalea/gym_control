import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, GENERIC_ERROR, adminApi, type Anomaly } from "@/api/client";
import { ErrorAlert } from "@/components/ErrorAlert";
import { useToast } from "@/components/toast";
import { Button } from "@/design/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ANOMALIES_KEY, JOURNAL_KEY } from "@/lib/queryKeys";

type Field = "employee_id" | "entry_at" | "exit_at" | "reason";
type Errors = Partial<Record<Field | "form", string>>;

/** Eroarea serverului, la câmpul vizat (dacă îl cunoaștem), altfel la nivel de formular. */
function errorsOf(error: unknown): Errors {
  if (!(error instanceof ApiError)) return { form: GENERIC_ERROR };
  const fields: string[] = ["employee_id", "entry_at", "exit_at", "reason"];
  return error.field && fields.includes(error.field) ? { [error.field]: error.detail } : { form: error.detail };
}

function Row({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const aria = (id: string, error?: string) => ({
  "aria-invalid": error ? true : undefined,
  "aria-describedby": error ? `${id}-error` : undefined,
});

function FormError({ message }: { message?: string }) {
  return message ? (
    <ErrorAlert>
      {message}
    </ErrorAlert>
  ) : null;
}

/** Sesiunea scrie în Jurnal și poate rezolva Anomalii: ambele liste se reîncarcă. */
function useRefreshAfterSession() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: JOURNAL_KEY }),
      queryClient.invalidateQueries({ queryKey: ANOMALIES_KEY }),
    ]);
  };
}

/** Dialog „Sesiune manuală nouă”: Intrare și Ieșire în ora Sălii, motiv obligatoriu. */
export function AddSessionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>Sesiune manuală nouă</DialogTitle>
        <DialogDescription>
          Acoperă o Intrare sau Ieșire neînregistrată. Orele sunt în ora locală a Sălii; motivul este obligatoriu și
          apare în Jurnal, cu numele tău.
        </DialogDescription>
        <AddForm onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function AddForm({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshAfterSession();
  const employees = useQuery({ queryKey: ["admin", "employees"], queryFn: adminApi.employees.list });
  const [employeeId, setEmployeeId] = useState("");
  const [entryAt, setEntryAt] = useState("");
  const [exitAt, setExitAt] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const create = useMutation({
    mutationFn: adminApi.sessions.create,
    onSuccess: async () => {
      onClose(); // toast-ul stă în afara dialogului modal, deci dialogul se închide întâi
      toast("Sesiune manuală adăugată");
      await refresh();
    },
    onError: (error) => setErrors(errorsOf(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    create.mutate({
      employee_id: employeeId ? Number(employeeId) : null,
      entry_at: entryAt,
      exit_at: exitAt,
      reason,
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={errors.form} />
      <Row id="session-employee" label="Angajat" error={errors.employee_id}>
        <Select
          id="session-employee"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          {...aria("session-employee", errors.employee_id)}
        >
          <option value="">Alege un Angajat</option>
          {(employees.data ?? []).map((employee) => (
            <option key={employee.id} value={String(employee.id)}>
              {employee.name}
            </option>
          ))}
        </Select>
      </Row>
      <Row id="session-entry" label="Intrare" error={errors.entry_at}>
        <Input
          id="session-entry"
          type="datetime-local"
          value={entryAt}
          onChange={(e) => setEntryAt(e.target.value)}
          {...aria("session-entry", errors.entry_at)}
        />
      </Row>
      <Row id="session-exit" label="Ieșire" error={errors.exit_at}>
        <Input
          id="session-exit"
          type="datetime-local"
          value={exitAt}
          onChange={(e) => setExitAt(e.target.value)}
          {...aria("session-exit", errors.exit_at)}
        />
      </Row>
      <Row id="session-reason" label="Motiv" error={errors.reason}>
        <Input
          id="session-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          {...aria("session-reason", errors.reason)}
        />
      </Row>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Anulează
        </Button>
        <Button type="submit" disabled={create.isPending}>
          Adaugă Sesiunea
        </Button>
      </div>
    </form>
  );
}

/** Dialog „Corectează Sesiunea”: închide o Sesiune deschisă cu o Ieșire manuală (rezolvă Anomaliile ei). */
export function CorrectSessionDialog({ anomaly, onClose }: { anomaly: Anomaly | null; onClose: () => void }) {
  return (
    <Dialog open={anomaly !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>Corectează Sesiunea</DialogTitle>
        <DialogDescription>
          {anomaly?.employee_name}: Intrare la {anomaly?.entry_at} (ora locală), fără Ieșire. Ieșirea introdusă rezolvă
          Anomaliile Sesiunii; motivul este obligatoriu și apare în Jurnal, cu numele tău.
        </DialogDescription>
        {anomaly && <CorrectForm key={anomaly.session_id} sessionId={anomaly.session_id} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function CorrectForm({ sessionId, onClose }: { sessionId: number; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshAfterSession();
  const [exitAt, setExitAt] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const correct = useMutation({
    mutationFn: () => adminApi.sessions.correct(sessionId, { exit_at: exitAt, reason }),
    onSuccess: async () => {
      onClose();
      toast("Sesiune corectată");
      await refresh();
    },
    onError: async (error) => {
      setErrors(errorsOf(error));
      // 404/409: Sesiunea nu mai e deschisă; lista Anomaliilor trebuie reîncărcată
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) await refresh();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    correct.mutate();
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={errors.form} />
      <Row id="correct-exit" label="Ieșire" error={errors.exit_at}>
        <Input
          id="correct-exit"
          type="datetime-local"
          value={exitAt}
          onChange={(e) => setExitAt(e.target.value)}
          {...aria("correct-exit", errors.exit_at)}
        />
      </Row>
      <Row id="correct-reason" label="Motiv" error={errors.reason}>
        <Input
          id="correct-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          {...aria("correct-reason", errors.reason)}
        />
      </Row>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Anulează
        </Button>
        <Button type="submit" disabled={correct.isPending}>
          Corectează
        </Button>
      </div>
    </form>
  );
}
