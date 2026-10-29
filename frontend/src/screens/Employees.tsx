import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ApiError, adminApi, type Employee, type EnrollLink, type ImportReport } from "@/api/client";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AddSessionDialog } from "@/screens/ManualSession";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMPLOYEES_KEY = ["admin", "employees"] as const;
const GENERIC_ERROR = "A apărut o eroare. Încearcă din nou.";
const errorText = (error: unknown) => (error instanceof ApiError ? error.detail : GENERIC_ERROR);

export function Employees() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const employees = useQuery({ queryKey: EMPLOYEES_KEY, queryFn: adminApi.employees.list });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [addingSession, setAddingSession] = useState(false);
  const [issued, setIssued] = useState<EnrollLink | null>(null);
  const [revoking, setRevoking] = useState<Employee | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: EMPLOYEES_KEY });
  const generate = useMutation({
    mutationFn: (employee: Employee) => adminApi.employees.enrollLink(employee.id),
    onSuccess: (link) => setIssued(link),
    onError: (error) => toast(errorText(error), "error"),
  });
  const revoke = useMutation({
    mutationFn: (employee: Employee) => adminApi.employees.revoke(employee.id),
    onSuccess: async () => {
      setRevoking(null);
      toast("Dispozitiv revocat");
      await refresh();
    },
    onError: (error) => {
      setRevoking(null);
      toast(errorText(error), "error");
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">
          Angajați{employees.data ? ` (${employees.data.length})` : ""}
        </h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAddingSession(true)}>
            Sesiune manuală nouă
          </Button>
          <Button variant="outline" onClick={() => setImporting(true)}>
            <Upload className="size-4" aria-hidden /> Importă CSV
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden /> Adaugă Angajat
          </Button>
        </div>
      </div>

      {employees.isPending && <p className="text-muted-foreground">Se încarcă…</p>}
      {employees.isError && employees.error instanceof ApiError && employees.error.status !== 401 && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {employees.error.detail}
        </p>
      )}
      {employees.data && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Nume</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Dispozitiv</th>
                <th className="px-4 py-3 text-right font-medium">Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {employees.data.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    Niciun Angajat încă.
                  </td>
                </tr>
              )}
              {employees.data.map((employee) => (
                <tr key={employee.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{employee.name}</td>
                  <td className="px-4 py-3">{employee.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        employee.enrolled
                          ? "rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                          : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      }
                    >
                      {employee.enrolled ? "Înrolat" : "Neînrolat"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" disabled={generate.isPending} onClick={() => generate.mutate(employee)}>
                        {employee.enrolled ? "Re-înrolează" : "Generează link"}
                      </Button>
                      {employee.enrolled && (
                        <Button size="sm" variant="outline" onClick={() => setRevoking(employee)}>
                          Revocă
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddEmployeeDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={async () => {
          setAdding(false);
          toast("Angajat adăugat");
          await refresh();
        }}
      />
      <AddSessionDialog open={addingSession} onClose={() => setAddingSession(false)} />
      <ImportCsvDialog open={importing} onClose={() => setImporting(false)} onImported={refresh} />
      <EnrollLinkDialog link={issued} onClose={() => setIssued(null)} />
      <Dialog open={revoking !== null} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent role="alertdialog">
          <DialogTitle>Revoci dispozitivul?</DialogTitle>
          <DialogDescription>
            Telefonul lui {revoking?.name} nu va mai putea face Intrare sau Ieșire până la o nouă înrolare.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRevoking(null)}>
              Anulează
            </Button>
            <Button disabled={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking)}>
              Revocă dispozitivul
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function AddEmployeeDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; form?: string }>({});
  const create = useMutation({
    mutationFn: adminApi.employees.create,
    onSuccess: () => {
      setName("");
      setEmail("");
      setErrors({});
      onAdded();
    },
    onError: (error) => {
      if (error instanceof ApiError && (error.field === "name" || error.field === "email")) {
        setErrors({ [error.field]: error.detail });
      } else {
        setErrors({ form: errorText(error) });
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setErrors({});
    create.mutate({ name, email });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>Angajat nou</DialogTitle>
        <DialogDescription>Adaugă un Angajat; linkul de înrolare îl generezi apoi din listă.</DialogDescription>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {errors.form && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="employee-name">Nume</Label>
            <Input
              id="employee-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "employee-name-error" : undefined}
            />
            <FieldError id="employee-name-error" message={errors.name} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="employee-email">Email</Label>
            <Input
              id="employee-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "employee-email-error" : undefined}
            />
            <FieldError id="employee-email-error" message={errors.email} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Anulează
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Adaugă
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EnrollLinkDialog({ link, onClose }: { link: EnrollLink | null; onClose: () => void }) {
  const toast = useToast();
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.link);
      onClose(); // toast-ul stă în afara dialogului modal, deci dialogul se închide întâi
      toast("Link copiat");
    } catch {
      toast("Nu s-a putut copia; selectează linkul și copiază-l manual.", "error");
    }
  };
  return (
    <Dialog open={link !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Link de înrolare pentru {link?.name}</DialogTitle>
        <DialogDescription>
          Trimite-l Angajatului; se deschide pe telefonul lui, o singură dată, în {link?.hours} de ore. Nu va mai fi
          afișat.
        </DialogDescription>
        <code className="rounded-md border border-border bg-muted p-3 text-sm break-all select-all">{link?.link}</code>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Închide
          </Button>
          <Button onClick={copy}>
            <Copy className="size-4" aria-hidden /> Copiază linkul
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ImportCsvDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const importCsv = useMutation({
    mutationFn: adminApi.employees.importCsv,
    onSuccess: (result) => {
      setReport(result);
      toast(`${plural(result.created, "Angajat importat", "Angajați importați")}`);
      onImported();
    },
    onError: (e) => setError(errorText(e)),
  });

  const close = () => {
    setFile(null);
    setError(null);
    setReport(null);
    onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setReport(null);
    if (!file) {
      setError("Alege un fișier CSV.");
      return;
    }
    importCsv.mutate(file);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        <DialogTitle>Import Angajați din CSV</DialogTitle>
        <DialogDescription>
          Fișier cu antetul „nume,email” pe primul rând, separat prin virgulă sau punct și virgulă. Rândurile valide se
          importă; cele invalide sunt listate cu numărul rândului.
        </DialogDescription>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="employees-csv">Fișier CSV</Label>
            <Input
              id="employees-csv"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          {report && (
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-medium">{plural(report.created, "Angajat importat", "Angajați importați")}</p>
              {report.errors.length > 0 && (
                <>
                  <p className="text-destructive">{plural(report.errors.length, "rând respins", "rânduri respinse")}:</p>
                  <ul className="max-h-48 list-disc overflow-auto pl-5 text-destructive">
                    {report.errors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Închide
            </Button>
            <Button type="submit" disabled={importCsv.isPending}>
              Importă
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
