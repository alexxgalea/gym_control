import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, ScrollText, SlidersHorizontal } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { adminApi, type JournalEntry, type JournalFilters } from "@/api/client";
import { isShownError } from "@/lib/errors";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/design/button";
import { EmptyState } from "@/design/EmptyState";
import { ScreenHeader } from "@/design/ScreenHeader";
import { Sheet } from "@/design/Sheet";
import { Skeleton } from "@/design/Skeleton";
import { StatusBadge } from "@/design/StatusBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { JOURNAL_KEY } from "@/lib/queryKeys";
import { AddSessionDialog } from "@/screens/ManualSession";

export { JOURNAL_KEY };

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

/** Pe telefon filtrele se deschid într-o foaie; pe ecrane late stau deasupra listei. */
const PHONE_QUERY = "(max-width: 639px)";

function useIsPhone(): boolean {
  const read = () => (typeof window.matchMedia === "function" ? window.matchMedia(PHONE_QUERY).matches : false);
  const [phone, setPhone] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const phone = useIsPhone();
  const go = (next: JournalFilters) => {
    setSearchParams(paramsOf(next));
    setFiltersOpen(false);
  };
  const { page: _page, ...withoutPage } = filters;
  const activeFilters = Object.values(withoutPage).filter(Boolean).length;

  const filterForm = (
    <FilterForm
      key={paramsOf(withoutPage).toString()}
      initial={withoutPage}
      employees={employees.data ?? []}
      kinds={kinds.data ?? []}
      onApply={go}
      onReset={() => go({})}
      inSheet={phone}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader
        title="Jurnal"
        description="Tot ce s-a întâmplat în aplicație, în ora Sălii: cine a intrat sau ieșit și ce au făcut Adminii."
        actions={
          <>
            {phone && (
              <Button variant="outline" onClick={() => setFiltersOpen(true)}>
                <SlidersHorizontal className="size-4" aria-hidden />
                {activeFilters ? `Filtre (${activeFilters})` : "Filtre"}
              </Button>
            )}
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden /> Sesiune manuală nouă
            </Button>
          </>
        }
      />
      <AddSessionDialog open={adding} onClose={() => setAdding(false)} />

      {phone ? (
        <Sheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          title="Filtre"
          description="Alege perioada, Angajatul și tipul de eveniment."
        >
          {filterForm}
        </Sheet>
      ) : (
        filterForm
      )}

      {journal.isPending && <Skeleton rows={5} />}
      {isShownError(journal.error) && <ErrorAlert>{journal.error.detail}</ErrorAlert>}
      {journal.data && !journal.isError && (
        <>
          <JournalList entries={journal.data.entries} timeZone={journal.data.timezone} />
          <nav aria-label="Pagini" className="flex items-center justify-between gap-2">
            <div className="min-w-24">
              {journal.data.has_prev && (
                <Button variant="outline" onClick={() => go({ ...withoutPage, page: journal.data.page - 1 })}>
                  Mai noi
                </Button>
              )}
            </div>
            <span className="text-sm text-muted-foreground">Pagina {journal.data.page}</span>
            <div className="flex min-w-24 justify-end">
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
  inSheet,
}: {
  initial: JournalFilters;
  employees: { id: number; name: string }[];
  kinds: { value: string; label: string }[];
  onApply: (filters: JournalFilters) => void;
  onReset: () => void;
  inSheet: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const set = (key: keyof JournalFilters) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply(draft);
  };

  return (
    <form
      onSubmit={submit}
      className={
        inSheet ? "flex flex-col gap-4" : "flex flex-wrap items-end gap-4 rounded-2xl border border-border bg-card p-4"
      }
    >
      <div className="flex min-w-48 flex-col gap-2">
        <Label htmlFor="journal-from">De la (inclusiv)</Label>
        <Input id="journal-from" type="date" value={draft.from} onChange={(e) => set("from")(e.target.value)} />
      </div>
      <div className="flex min-w-48 flex-col gap-2">
        <Label htmlFor="journal-to">Până la (inclusiv)</Label>
        <Input id="journal-to" type="date" value={draft.to} onChange={(e) => set("to")(e.target.value)} />
      </div>
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
      <div className="flex gap-2">
        <Button type="submit">Filtrează</Button>
        <Button type="button" variant="outline" onClick={onReset}>
          Resetează
        </Button>
      </div>
    </form>
  );
}

/** Lista e aceeași pe telefon și pe laptop: un card pe eveniment, fără tabel care se taie. */
function JournalList({ entries, timeZone }: { entries: JournalEntry[]; timeZone: string }) {
  if (entries.length === 0) {
    return <EmptyState icon={ScrollText} text="Nicio înregistrare pentru filtrele alese." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <JournalRow key={entry.id} entry={entry} timeZone={timeZone} />
      ))}
    </ul>
  );
}

function JournalRow({ entry, timeZone }: { entry: JournalEntry; timeZone: string }) {
  return (
    <li
      className={
        entry.manual
          ? "rounded-2xl border border-primary/40 bg-primary/5 p-4"
          : "rounded-2xl border border-border bg-card p-4"
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <time dateTime={entry.at} className="text-sm font-semibold tabular-nums">
          {formatDateTime(entry.at, timeZone)}
        </time>
        {entry.employee_name && <span className="text-sm font-medium">{entry.employee_name}</span>}
        {entry.manual ? (
          <span
            data-testid="manual-mark"
            className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground"
          >
            {entry.kind_label}
          </span>
        ) : (
          <StatusBadge>{entry.kind_label}</StatusBadge>
        )}
        {entry.method_label && entry.method_label !== entry.kind_label && <span className="text-sm text-muted-foreground">{entry.method_label}</span>}
      </div>
      {entry.anomalies.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {entry.anomalies.map((anomaly) => (
            <StatusBadge key={anomaly} tone="danger">
              {anomaly}
            </StatusBadge>
          ))}
        </div>
      )}
      <p className="mt-2 text-[15px]">{entry.summary}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {entry.author ? `Făcut de ${entry.author}` : "Eveniment automat"}
      </p>
    </li>
  );
}
