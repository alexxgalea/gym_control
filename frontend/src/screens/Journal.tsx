import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { adminApi, type JournalEntry, type JournalFilters } from "@/api/client";
import { isShownError } from "@/lib/errors";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { JOURNAL_KEY } from "@/lib/queryKeys";
import { AddSessionDialog } from "@/screens/ManualSession";

export { JOURNAL_KEY };

const COLUMNS = ["Moment", "Angajat", "Tip", "Validare", "Anomalii", "Autor", "Descriere"] as const;

/** Filtrele stau în adresă (`?employee=&from=&to=&kind=&page=`): link-uri, butonul Înapoi și ruta veche funcționează. */
function filtersOf(params: URLSearchParams): JournalFilters {
  const page = Number(params.get("page"));
  return {
    employee: params.get("employee") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    kind: params.get("kind") ?? "",
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
}

function paramsOf(filters: JournalFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, String(value));
  return params;
}

export function Journal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = filtersOf(searchParams);
  const journal = useQuery({
    queryKey: [...JOURNAL_KEY, filters],
    queryFn: () => adminApi.journal.list(filters),
    placeholderData: keepPreviousData,
  });
  const employees = useQuery({ queryKey: ["admin", "employees"], queryFn: adminApi.employees.list });
  const kinds = useQuery({ queryKey: [...JOURNAL_KEY, "kinds"], queryFn: adminApi.journal.kinds, staleTime: Infinity });

  const [adding, setAdding] = useState(false);
  const go = (next: JournalFilters) => setSearchParams(paramsOf(next));
  const { page: _page, ...withoutPage } = filters;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Jurnal</h1>
        <Button onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden /> Sesiune manuală nouă
        </Button>
      </div>
      <AddSessionDialog open={adding} onClose={() => setAdding(false)} />

      <FilterForm
        key={paramsOf(withoutPage).toString()}
        initial={withoutPage}
        employees={employees.data ?? []}
        kinds={kinds.data ?? []}
        onApply={(next) => go(next)}
        onReset={() => go({})}
      />
      <p className="text-sm text-muted-foreground">
        Zilele sunt în ora locală a Sălii. Fiecare moment apare în ora locală și în UTC (cum e stocat).
      </p>

      {journal.isPending && <p className="text-muted-foreground">Se încarcă…</p>}
      {isShownError(journal.error) && (
        <ErrorAlert>
          {journal.error.detail}
        </ErrorAlert>
      )}
      {journal.data && !journal.isError && (
        <>
          <JournalTable entries={journal.data.entries} timeZone={journal.data.timezone} />
          <nav aria-label="Pagini" className="flex items-center justify-between">
            <div>
              {journal.data.has_prev && (
                <Button variant="outline" onClick={() => go({ ...withoutPage, page: journal.data.page - 1 })}>
                  Mai noi
                </Button>
              )}
            </div>
            <span className="text-sm text-muted-foreground">Pagina {journal.data.page}</span>
            <div>
              {journal.data.has_next && (
                <Button variant="outline" onClick={() => go({ ...withoutPage, page: journal.data.page + 1 })}>
                  Mai vechi
                </Button>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}

function FilterForm({
  initial,
  employees,
  kinds,
  onApply,
  onReset,
}: {
  initial: JournalFilters;
  employees: { id: number; name: string }[];
  kinds: { value: string; label: string }[];
  onApply: (filters: JournalFilters) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const set = (key: keyof JournalFilters) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply(draft);
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex min-w-48 flex-col gap-2">
        <Label htmlFor="journal-employee">Angajat</Label>
        <Select id="journal-employee" value={draft.employee} onChange={(e) => set("employee")(e.target.value)}>
          <option value="">Toți Angajații</option>
          {employees.map((employee) => (
            <option key={employee.id} value={String(employee.id)}>
              {employee.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex min-w-48 flex-col gap-2">
        <Label htmlFor="journal-kind">Tip</Label>
        <Select id="journal-kind" value={draft.kind} onChange={(e) => set("kind")(e.target.value)}>
          <option value="">Toate tipurile</option>
          {kinds.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="journal-from">De la (inclusiv)</Label>
        <Input id="journal-from" type="date" value={draft.from} onChange={(e) => set("from")(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="journal-to">Până la (inclusiv)</Label>
        <Input id="journal-to" type="date" value={draft.to} onChange={(e) => set("to")(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit">Filtrează</Button>
        <Button type="button" variant="outline" onClick={onReset}>
          Resetează
        </Button>
      </div>
    </form>
  );
}

function JournalTable({ entries, timeZone }: { entries: JournalEntry[]; timeZone: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-muted-foreground">
          <tr>
            {COLUMNS.map((column) => (
              <th key={column} className="px-4 py-3 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-muted-foreground">
                Nicio înregistrare pentru filtrele alese.
              </td>
            </tr>
          )}
          {entries.map((entry) => (
            <JournalRow key={entry.id} entry={entry} timeZone={timeZone} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JournalRow({ entry, timeZone }: { entry: JournalEntry; timeZone: string }) {
  return (
    <tr className={entry.manual ? "border-t border-border bg-primary/5" : "border-t border-border"}>
      <td className="px-4 py-3 whitespace-nowrap">
        <time dateTime={entry.at}>{formatDateTime(entry.at, timeZone)}</time>
        <div className="text-xs text-muted-foreground">{formatDateTime(entry.at, "UTC")} UTC</div>
      </td>
      <td className="px-4 py-3">{entry.employee_name}</td>
      <td className="px-4 py-3">
        {entry.manual ? (
          <span
            data-testid="manual-mark"
            className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground"
          >
            {entry.kind_label}
          </span>
        ) : (
          entry.kind_label
        )}
      </td>
      <td className="px-4 py-3">{entry.method_label ?? "—"}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {entry.anomalies.map((anomaly) => (
            <span key={anomaly} className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
              {anomaly}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3">{entry.author}</td>
      <td className="px-4 py-3">{entry.summary}</td>
    </tr>
  );
}
