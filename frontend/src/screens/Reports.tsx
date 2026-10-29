import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarX, Download, Info, Printer } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { adminApi, reportQuery, type Report } from "@/api/client";
import { errorText, isShownError } from "@/lib/errors";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/design/button";
import { EmptyState } from "@/design/EmptyState";
import { Logo } from "@/design/Logo";
import { ScreenHeader } from "@/design/ScreenHeader";
import { Skeleton } from "@/design/Skeleton";
import { StatusBadge } from "@/design/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Mesajul de neacceptare și explicația intervalului vin de la server, ca textul „Sesiune deschisă”; nu se dublează aici. */
function Disclaimer({ report }: { report: Report }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 text-sm print:rounded-none">
      <p>{report.disclaimer}</p>
      <p className="text-muted-foreground">{report.scope_text}</p>
    </div>
  );
}

const COLUMNS = "md:grid md:grid-cols-[1.4fr_1fr_1fr_1.4fr_1fr] md:items-center md:gap-4";

/** Un câmp al rândului: pe telefon (card) are eticheta lui, pe ecran lat eticheta e în antetul tabelului. */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="cell" className="flex items-baseline justify-between gap-3 md:block">
      <span aria-hidden className="text-xs text-muted-foreground md:hidden">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}

/** Rânduri pe telefon (carduri), tabel pe ecran lat; aceeași structură, deci un singur set de texte. */
function ReportTable({ report }: { report: Report }) {
  if (report.rows.length === 0) {
    return <EmptyState icon={CalendarX} text="Nicio Sesiune în acest interval." />;
  }
  const at = (iso: string) => formatDateTime(iso, report.timezone);
  return (
    <div role="table" aria-label="Sesiuni din interval" className="flex flex-col gap-3 text-sm md:gap-0 md:overflow-hidden md:rounded-2xl md:border md:border-border md:bg-card print:rounded-none">
      <div role="row" className={`${COLUMNS} hidden bg-muted px-4 py-3 font-medium text-muted-foreground`}>
        {["Angajat", "Intrare", "Ieșire", "Eticheta", "Metoda de validare"].map((name) => (
          <div key={name} role="columnheader">
            {name}
          </div>
        ))}
      </div>
      {report.rows.map((row, index) => (
        <div
          key={index}
          role="row"
          className={`${COLUMNS} flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-4 md:rounded-none md:border-0 md:border-t md:px-4 md:py-3`}
        >
          <Cell label="Angajat">
            <strong className="font-medium">{row.employee_name}</strong>
          </Cell>
          <Cell label="Intrare">{at(row.entry)}</Cell>
          <Cell label="Ieșire">
            {row.open || !row.exit ? <StatusBadge tone="warning">{report.open_text}</StatusBadge> : at(row.exit)}
          </Cell>
          <Cell label="Eticheta">{row.label}</Cell>
          <Cell label="Metoda de validare">{row.method_label}</Cell>
        </div>
      ))}
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
      <ScreenHeader
        title="Raport de prezență"
        description="Vezi cine era în Sală într-un interval și descarcă lista pentru Excel sau tipărește-o."
      />
      {!applied && (
        <div className="flex gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
          <Info className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="flex flex-col gap-1.5">
            <p>Alege un interval și vei vedea toți Angajații care au avut o Sesiune în Sală în acel interval.</p>
            <p>Raportul nu e o dovadă a vinovăției: arată doar cine a fost înregistrat în Sală.</p>
            <p className="text-muted-foreground">Fiecare generare a raportului rămâne scrisă în Jurnal, cu numele tău.</p>
          </div>
        </div>
      )}
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="report-from">De la</Label>
          <Input id="report-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="report-to">Până la</Label>
          <Input id="report-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button type="submit" disabled={generate.isPending}>
          Generează raportul
        </Button>
      </form>

      {isShownError(generate.error) && <ErrorAlert>{errorText(generate.error)}</ErrorAlert>}
      {generate.isPending && <Skeleton className="h-32 w-full" />}
      {generate.data && (
        <>
          <Disclaimer report={generate.data} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <a href={`/api/admin/reports.csv?${query}`} download>
                <Download className="size-4" aria-hidden /> Descarcă pentru Excel
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
      <Logo size={40} />
      <h1 className="text-2xl font-semibold">Raport de prezență</h1>
      {report.isPending && <Skeleton className="h-32 w-full" />}
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
            <strong>Interval (ora Sălii):</strong> {formatDateTime(report.data.date_from, report.data.timezone)} –{" "}
            {formatDateTime(report.data.date_to, report.data.timezone)}
            <br />
            Generat de {report.data.generated_by}, {formatDateTime(report.data.generated_at, report.data.timezone)}
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
