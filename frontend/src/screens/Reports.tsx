import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { adminApi, reportQuery, type Report } from "@/api/client";
import { errorText, isShownError } from "@/lib/errors";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/design/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Mesajul de neacceptare și explicația intervalului vin de la server, ca textul „deschisă” din tabel; nu se dublează aici. */
function Disclaimer({ report }: { report: Report }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted p-3 text-sm">
      <p>{report.disclaimer}</p>
      <p className="text-muted-foreground">{report.scope_text}</p>
    </div>
  );
}

function ReportTable({ report }: { report: Report }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card print:rounded-none">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Angajat</th>
            <th className="px-4 py-3 font-medium">Intrare</th>
            <th className="px-4 py-3 font-medium">Ieșire</th>
            <th className="px-4 py-3 font-medium">Eticheta</th>
            <th className="px-4 py-3 font-medium">Metoda de validare</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                Nicio Sesiune în acest interval.
              </td>
            </tr>
          )}
          {report.rows.map((row, index) => (
            <tr key={index} className="border-t border-border">
              <td className="px-4 py-3 font-medium">{row.employee_name}</td>
              <td className="px-4 py-3">{row.entry}</td>
              <td className="px-4 py-3">
                {row.open ? (
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                    {report.open_text}
                  </span>
                ) : (
                  row.exit
                )}
              </td>
              <td className="px-4 py-3">{row.label}</td>
              <td className="px-4 py-3">{row.method_label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Reports() {
  const [params] = useSearchParams();
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState(params.get("to") ?? "");
  // intervalul pentru care s-a generat raportul afișat (linkurile CSV și tipărit îl folosesc pe el)
  const [applied, setApplied] = useState<{ from: string; to: string } | null>(null);
  // mutație, nu query: fiecare generare intră în Jurnal, deci nu se reia la refocus sau remontare
  const generate = useMutation({ mutationFn: (range: { from: string; to: string }) => adminApi.reports.generate(range.from, range.to) });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const range = { from, to };
    setApplied(range);
    generate.mutate(range);
  };

  const query = applied ? reportQuery(applied.from, applied.to) : "";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Raport de prezență</h1>
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="report-from">De la</Label>
          <Input id="report-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="report-to">Până la</Label>
          <Input id="report-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button type="submit" disabled={generate.isPending}>
          Generează Raportul
        </Button>
      </form>

      {isShownError(generate.error) && (
        <ErrorAlert>{errorText(generate.error)}</ErrorAlert>
      )}
      {generate.isPending && <p className="text-muted-foreground">Se generează…</p>}
      {generate.data && (
        <>
          <Disclaimer report={generate.data} />
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={`/api/admin/reports.csv?${query}`} download>
                <Download className="size-4" aria-hidden /> Export CSV
              </a>
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/reports/print?${query}`}>
                <Printer className="size-4" aria-hidden /> Versiune pentru tipărit
              </Link>
            </Button>
          </div>
          <ReportTable report={generate.data} />
        </>
      )}
    </div>
  );
}

/** Varianta tipărită: rută SPA fără Shell; `print:` ascunde butoanele la tipărire. */
export function PrintReport() {
  const [params] = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  // o singură generare per vizită (se înscrie în Jurnal): fără reluare la refocus
  const report = useQuery({
    queryKey: ["admin", "reports", "print", from, to],
    queryFn: () => adminApi.reports.generate(from, to),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const back = `/reports?${reportQuery(from, to)}`;

  return (
      <main className="mx-auto flex max-w-4xl flex-col gap-4 p-8 print:max-w-none print:p-0">
        <h1 className="text-2xl font-semibold">Raport de prezență</h1>
        {report.isPending && <p className="text-muted-foreground">Se generează…</p>}
        {isShownError(report.error) && (
          <>
            <ErrorAlert>{errorText(report.error)}</ErrorAlert>
            <Link className="text-sm text-primary underline print:hidden" to={back}>
              Înapoi
            </Link>
          </>
        )}
        {report.data && (
          <>
            <p className="text-sm">
              <strong>Interval (ora locală):</strong> {report.data.date_from} – {report.data.date_to}
              <br />
              <strong>Generat de:</strong> {report.data.generated_by}, {report.data.generated_at}
            </p>
            <Disclaimer report={report.data} />
            <div className="flex gap-2 print:hidden">
              <Button className="print:hidden" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden /> Tipărește
              </Button>
              <Button variant="outline" className="print:hidden" asChild>
                <Link to={back}>Înapoi</Link>
              </Button>
            </div>
            <ReportTable report={report.data} />
          </>
        )}
      </main>
  );
}
