import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Plus, Upload, Users } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, adminApi, type Employee, type EnrollLink, type ImportReport } from "@/api/client";
import { errorText, isShownError } from "@/lib/errors";
import { ErrorAlert } from "@/components/ErrorAlert";
import { useToast } from "@/components/toast";
import { Button } from "@/design/button";
import { ConfirmDialog } from "@/design/ConfirmDialog";
import { EmptyState } from "@/design/EmptyState";
import { ScreenHeader } from "@/design/ScreenHeader";
import { Sheet } from "@/design/Sheet";
import { Skeleton } from "@/design/Skeleton";
import { StatusBadge } from "@/design/StatusBadge";
import { EMPLOYEES_KEY } from "@/lib/queryKeys";
import { AddSessionDialog } from "@/screens/ManualSession";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";


export function Employees() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const employees = useQuery({ queryKey: EMPLOYEES_KEY, queryFn: adminApi.employees.list });
  // „Adaugă un Angajat nou” din pagina de gestiune deschide direct foaia (`/employees?nou`)
  const [searchParams, setSearchParams] = useSearchParams();
  const [adding, setAdding] = useState(searchParams.has("nou"));
  useEffect(() => {
    if (searchParams.has("nou")) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);
  const [importing, setImporting] = useState(false);
  const [addingSession, setAddingSession] = useState(false);
  const [issued, setIssued] = useState<EnrollLink | null>(null);
  const [replacing, setReplacing] = useState<Employee | null>(null);
  const [revoking, setRevoking] = useState<Employee | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: EMPLOYEES_KEY });
  const activate = useMutation({
    mutationFn: (employee: Employee) => adminApi.employees.enrollLink(employee.id),
    onSuccess: (link) => {
      setReplacing(null);
      setIssued(link);
    },
    onError: (error) => {
      setReplacing(null);
      toast(errorText(error), "error");
    },
  });
  const revoke = useMutation({
    mutationFn: (employee: Employee) => adminApi.employees.revoke(employee.id),
    onSuccess: async () => {
      setRevoking(null);
      toast("Telefon scos din uz");
      await refresh();
    },
    onError: (error) => {
      setRevoking(null);
      toast(errorText(error), "error");
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader
        title="Angajați"
        description="Aici adaugi Angajații și le activezi telefonul, ca să poată face Intrare și Ieșire."
        actions={
          <>
            <Button variant="outline" onClick={() => setAddingSession(true)}>
              Sesiune manuală nouă
            </Button>
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload className="size-4" aria-hidden /> Importă listă din Excel
            </Button>
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden /> Adaugă un Angajat nou
            </Button>
          </>
        }
      />

      {employees.isPending && <Skeleton />}
      {isShownError(employees.error) && <ErrorAlert>{employees.error.detail}</ErrorAlert>}
      {employees.data?.length === 0 && <EmptyState icon={Users} text="Niciun Angajat încă." />}
      {employees.data && employees.data.length > 0 && (
        <ul className="overflow-hidden rounded-2xl border border-border bg-card">
          {employees.data.map((employee) => (
            <li
              key={employee.id}
              className="flex flex-col gap-3 border-t border-border p-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold">{employee.name}</p>
                <p className="truncate text-sm text-muted-foreground">{employee.email}</p>
                <div className="mt-1.5">
                  <StatusBadge tone={employee.enrolled ? "success" : "neutral"}>
                    {employee.enrolled ? "Telefon activat" : "Telefon neactivat"}
                  </StatusBadge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={activate.isPending}
                  onClick={() => (employee.enrolled ? setReplacing(employee) : activate.mutate(employee))}
                >
                  {employee.enrolled ? "Activează alt telefon" : "Activează telefonul"}
                </Button>
                {employee.enrolled && (
                  <Button size="sm" variant="destructive" onClick={() => setRevoking(employee)}>
                    Scoate telefonul din uz
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddEmployeeSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={async (employee) => {
          setAdding(false);
          await refresh();
          activate.mutate(employee); // fluxul continuă direct cu Activare telefon
        }}
      />
      <AddSessionDialog open={addingSession} onClose={() => setAddingSession(false)} />
      <ImportSheet open={importing} onClose={() => setImporting(false)} onImported={refresh} />
      <ActivationSheet link={issued} onClose={() => setIssued(null)} />
      <ConfirmDialog
        open={replacing !== null}
        onOpenChange={(open) => !open && setReplacing(null)}
        title="Activezi alt telefon?"
        description={`Telefonul activat acum de ${replacing?.name} nu va mai funcționa după ce activezi altul.`}
        confirmLabel="Activează alt telefon"
        pending={activate.isPending}
        onConfirm={() => replacing && activate.mutate(replacing)}
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Scoți telefonul din uz?"
        description={`Telefonul lui ${revoking?.name} nu va mai putea face Intrare sau Ieșire până la o nouă Activare telefon.`}
        confirmLabel="Scoate telefonul din uz"
        destructive
        pending={revoke.isPending}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
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

function AddEmployeeSheet({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (employee: Employee) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; form?: string }>({});
  const create = useMutation({
    mutationFn: adminApi.employees.create,
    onSuccess: (employee) => {
      setName("");
      setEmail("");
      setErrors({});
      onAdded(employee);
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
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Angajat nou"
      description="După salvare, activezi direct telefonul Angajatului."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {errors.form && <ErrorAlert>{errors.form}</ErrorAlert>}
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
        <Button type="submit" disabled={create.isPending}>
          Salvează și activează telefonul
        </Button>
      </form>
    </Sheet>
  );
}

function ActivationSheet({ link, onClose }: { link: EnrollLink | null; onClose: () => void }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const close = () => {
    setCopied(null);
    onClose();
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.link);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <Sheet
      open={link !== null}
      onOpenChange={(open) => !open && close()}
      title={`Activare telefon pentru ${link?.name ?? ""}`}
      description="Angajatul scanează codul QR cu telefonul lui."
    >
      {link && (
        <div className="flex flex-col items-center gap-4">
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(link.qr_svg)}`}
            alt={`Cod QR de activare pentru ${link.name}`}
            className="size-64 max-w-full rounded-2xl bg-white p-3"
          />
          <p className="text-center text-sm text-muted-foreground">
            Linkul expiră în {link.hours} de ore și merge o singură dată
          </p>
          <Button variant="outline" onClick={copy}>
            {copied === "ok" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}{" "}
            Copiază linkul
          </Button>
          {copied === "ok" && <p role="status">Link copiat</p>}
          {copied === "failed" && (
            <ErrorAlert>Nu s-a putut copia linkul. Cere un link nou și încearcă din nou.</ErrorAlert>
          )}
          <Button onClick={close}>Gata</Button>
        </div>
      )}
    </Sheet>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ImportSheet({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const importCsv = useMutation({
    mutationFn: adminApi.employees.importCsv,
    onSuccess: (result) => {
      setReport(result);
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
      setError("Alege un fișier cu lista.");
      return;
    }
    importCsv.mutate(file);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && close()}
      title="Importă listă din Excel"
      description="Lista are două coloane: nume și email. Pe primul rând scrie „nume” și „email”, apoi câte un Angajat pe rând. Salvează fișierul din Excel ca CSV."
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <div className="flex flex-col gap-2">
          <Label htmlFor="employees-csv">Fișierul cu lista</Label>
          <Input
            id="employees-csv"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        {report && (
          <div className="flex flex-col gap-2 text-sm">
            <p role="status" className="font-medium">
              {plural(report.created, "Angajat importat", "Angajați importați")}
            </p>
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
        <Button type="submit" disabled={importCsv.isPending}>
          Importă Angajații
        </Button>
      </form>
    </Sheet>
  );
}
