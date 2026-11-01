import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, Search, UserRound, type LucideIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "@/api/client";
import { EMPLOYEES_KEY } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

/** Un rând din căutare: un ecran, o acțiune sau un Angajat. */
export type Command = { group: string; label: string; hint?: string; icon: LucideIcon; run: () => void };

/** Fără diacritice și fără majuscule: „sesiune” găsește „Sesiune manuală”, „stefan” găsește „Ștefan”. */
function normalize(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Deschide căutarea cu Ctrl+K (⌘K pe Mac), de oriunde din Admin. */
export function useCommandShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

/**
 * Căutarea rapidă: un câmp în care scrii câteva litere și sari la un ecran, rulezi o acțiune sau deschizi Jurnalul
 * unui Angajat. Angajații apar doar după ce începi să scrii (lista se cere abia la deschidere).
 */
export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
}) {
  const navigate = useNavigate();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const employees = useQuery({ queryKey: EMPLOYEES_KEY, queryFn: adminApi.employees.list, enabled: open });

  const rows = useMemo<Command[]>(() => {
    const q = normalize(query.trim());
    if (!q) return commands;
    const people: Command[] = (employees.data ?? []).map((employee) => ({
      group: "Angajați",
      label: employee.name,
      hint: "Vezi în Jurnal",
      icon: UserRound,
      run: () => navigate(`/journal?employee=${employee.id}`),
    }));
    return [...commands, ...people].filter((row) => normalize(row.label).includes(q));
  }, [commands, employees.data, navigate, query]);

  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const choose = (row: Command | undefined) => {
    if (!row) return;
    onOpenChange(false);
    row.run();
  };

  const optionId = (index: number) => `${listId}-${index}`;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 z-50 flex max-h-[80dvh] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-sheet sm:top-[12vh]"
        >
          <DialogPrimitive.Title className="sr-only">Căutare rapidă</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              role="combobox"
              aria-label="Caută un ecran, o acțiune sau un Angajat"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={rows.length ? optionId(cursor) : undefined}
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setCursor((c) => Math.min(c + 1, rows.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  choose(rows[cursor]);
                }
              }}
              placeholder="Caută un ecran, o acțiune sau un Angajat…"
              className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground sm:block">
              Esc
            </kbd>
          </div>
          <div id={listId} role="listbox" aria-label="Rezultate" className="overflow-y-auto p-2">
            {rows.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">Nimic găsit pentru „{query}”.</p>
            )}
            {rows.map((row, index) => (
              <div key={`${row.group}-${row.label}`} role="presentation">
                {row.group !== rows[index - 1]?.group && (
                  <div role="presentation" className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase">
                    {row.group}
                  </div>
                )}
                <div
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === cursor}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => choose(row)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5",
                    index === cursor && "bg-muted",
                  )}
                >
                  <row.icon className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{row.label}</span>
                  {row.hint && <span className="shrink-0 text-xs text-muted-foreground">{row.hint}</span>}
                  {index === cursor && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                </div>
              </div>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
