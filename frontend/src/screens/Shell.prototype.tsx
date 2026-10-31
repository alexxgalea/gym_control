/*
 * PROTOTIP (ramura prototype/ecran-usa-si-meniu) — întrebarea: cum arată un meniu de Admin „smart”: bară de jos cu ＋
 * pe telefon, bară laterală pe desktop, cifre pentru ce e de verificat, căutare rapidă (Ctrl+K)? Trei variante în
 * jurul aceluiași <Outlet />, comutate cu `?variant=A|B|C` (0 = meniul actual). Cod de aruncat: fără teste.
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
  ChevronsLeft,
  ChevronsRight,
  CornerDownLeft,
  DoorOpen,
  FileText,
  House,
  LayoutGrid,
  LogOut,
  Plus,
  ScrollText,
  Search,
  Settings,
  ShieldAlert,
  TriangleAlert,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { adminApi } from "@/api/client";
import { ME_KEY, useMe } from "@/auth";
import { ToastProvider } from "@/components/toast";
import { Logo } from "@/design/Logo";
import { ThemeSwitch } from "@/design/ThemeSwitch";
import { ANOMALIES_KEY, INCIDENTS_KEY, IN_HALL_KEY } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { LiveBackground } from "@/prototype/LiveBackground";
import { AddSessionDialog } from "@/screens/ManualSession";

export const SHELL_VARIANTS = [
  { key: "A", name: "Andocat, cu ＋ ridicat" },
  { key: "B", name: "Plutitor, cu plăcuțe" },
  { key: "C", name: "Centru de comandă" },
  { key: "0", name: "Actual" },
] as const;

/* ───────────────────────── date comune ───────────────────────── */

const REFRESH = { refetchInterval: 30_000, refetchOnWindowFocus: true } as const;

/** Semnalele din meniu: aceleași interogări ca pe Acasă (cache comun), deci nicio cerere în plus. */
function useSignals() {
  const inHall = useQuery({ queryKey: IN_HALL_KEY, queryFn: adminApi.inHall, ...REFRESH });
  const anomalies = useQuery({ queryKey: ANOMALIES_KEY, queryFn: adminApi.anomalies.list, ...REFRESH });
  const incidents = useQuery({ queryKey: INCIDENTS_KEY, queryFn: adminApi.incidents.list, ...REFRESH });
  return {
    inHall: inHall.data?.people.length ?? 0,
    people: inHall.data?.people ?? [],
    doorActive: inHall.data?.door_screen_active ?? true,
    anomalies: anomalies.data?.length ?? 0,
    incidents: incidents.data?.filter((incident) => incident.status === "open").length ?? 0,
  };
}
type Signals = ReturnType<typeof useSignals>;

type Item = { path: string; label: string; short?: string; icon: LucideIcon };
const I = {
  home: { path: "", label: "Acasă", icon: House },
  anomalies: { path: "anomalies", label: "Anomalii", icon: TriangleAlert },
  journal: { path: "journal", label: "Jurnal", icon: ScrollText },
  employees: { path: "employees", label: "Angajați", icon: Users },
  door: { path: "door-screen", label: "Ecranul de la ușă", short: "Ușa", icon: DoorOpen },
  incidents: { path: "incidents", label: "Incidente", icon: ShieldAlert },
  reports: { path: "reports", label: "Raport de prezență", short: "Raport", icon: FileText },
  settings: { path: "settings", label: "Setări", icon: Settings },
} satisfies Record<string, Item>;

const MORE: Item[] = [I.employees, I.door, I.incidents, I.reports, I.settings];
const GROUPS: { title: string; items: Item[] }[] = [
  { title: "Operare", items: [I.home, I.journal, I.door] },
  { title: "De verificat", items: [I.anomalies, I.incidents] },
  { title: "Administrare", items: [I.employees, I.reports, I.settings] },
];
const ALL: Item[] = GROUPS.flatMap((group) => group.items);

/** Ce cifră sau punct are fiecare intrare. `tone`: culoarea insignei. */
function badgeFor(item: Item, s: Signals): { value: number | "dot"; tone: "warn" | "info" | "danger" } | null {
  if (item === I.anomalies && s.anomalies) return { value: s.anomalies, tone: "warn" };
  if (item === I.incidents && s.incidents) return { value: s.incidents, tone: "danger" };
  if (item === I.home && s.inHall) return { value: s.inHall, tone: "info" };
  if (item === I.door && !s.doorActive) return { value: "dot", tone: "danger" };
  return null;
}

function Badge({ item, s, className }: { item: Item; s: Signals; className?: string }) {
  const badge = badgeFor(item, s);
  if (!badge) return null;
  const tone = {
    warn: "bg-warning text-white",
    danger: "bg-destructive text-white",
    info: "bg-primary/15 text-primary",
  }[badge.tone];
  if (badge.value === "dot")
    return <span aria-label="neactivat" className={cn("size-2.5 rounded-full ring-2 ring-card", tone, className)} />;
  return (
    <span className={cn("grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums", tone, className)}>
      {badge.value}
    </span>
  );
}

function useIsActive() {
  const { pathname } = useLocation();
  return (item: Item) => (item.path === "" ? pathname === "/" : pathname === `/${item.path}` || pathname.startsWith(`/${item.path}/`));
}

/** Acțiunile din ＋ și din căutare. Sesiunea manuală se deschide aici; restul duc la foaia din ecranul lor. */
function useActions() {
  const navigate = useNavigate();
  const [addingSession, setAddingSession] = useState(false);
  const actions: { label: string; hint: string; icon: LucideIcon; run: () => void }[] = [
    { label: "Sesiune manuală", hint: "Intrare/Ieșire uitată", icon: CalendarPlus, run: () => setAddingSession(true) },
    { label: "Angajat nou", hint: "Adaugă și activează", icon: UserPlus, run: () => navigate("/employees?nou") },
    { label: "Incident nou", hint: "Marchează o pagubă", icon: ShieldAlert, run: () => navigate("/incidents?nou") },
    { label: "Raport de prezență", hint: "Cine a fost în Sală", icon: FileText, run: () => navigate("/reports") },
  ];
  const dialog = <AddSessionDialog open={addingSession} onClose={() => setAddingSession(false)} />;
  return { actions, dialog };
}

function initials(name: string | undefined) {
  if (!name) return "?";
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function Avatar({ name, size = 36 }: { name?: string; size?: number }) {
  return (
    <span
      className="bg-gradient-brand grid shrink-0 place-items-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

function useAccount() {
  const me = useMe();
  const queryClient = useQueryClient();
  const logout = useMutation({ mutationFn: adminApi.logout, onSuccess: () => queryClient.setQueryData(ME_KEY, null) });
  return { username: me.data?.username, logout };
}

function AccountCard({ compact = false }: { compact?: boolean }) {
  const { username, logout } = useAccount();
  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl bg-muted/60 p-3", compact && "bg-transparent p-0")}>
      <div className="flex items-center gap-3">
        <Avatar name={username} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{username}</div>
          <div className="text-xs text-muted-foreground">Admin</div>
        </div>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          aria-label="Deconectare"
          title="Deconectare"
          className="grid size-9 cursor-pointer place-items-center rounded-xl text-muted-foreground hover:bg-card hover:text-destructive"
        >
          <LogOut className="size-4" />
        </button>
      </div>
      <ThemeSwitch />
    </div>
  );
}

/** Fundalul discret din spatele antetului. */
function Glow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_oklab,var(--primary)_22%,transparent),transparent)]"
    />
  );
}

/** Foaia de jos (telefon) / fereastra centrată (desktop) pentru ＋ și „Mai mult”. */
function MenuSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
              <div
                className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
                onClick={(event) => event.target === event.currentTarget && onClose()}
              >
                <motion.div
                  className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[28px] bg-background p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-sheet sm:max-w-md sm:rounded-[28px]"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", stiffness: 420, damping: 40 }}
                >
                  <div className="mx-auto mb-3 h-1.5 w-9 rounded-full bg-muted-foreground/30 sm:hidden" aria-hidden />
                  <DialogPrimitive.Title className="px-1 pb-3 text-lg font-semibold">{title}</DialogPrimitive.Title>
                  {children}
                </motion.div>
              </div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

/* ───────────────────────── căutarea rapidă (Ctrl+K) ───────────────────────── */

function useCommandK(setOpen: (open: boolean) => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}

function normalize(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function CommandPalette({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: ReturnType<typeof useActions>["actions"];
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const employees = useQuery({ queryKey: ["admin", "employees"], queryFn: adminApi.employees.list, enabled: open });

  type Row = { group: string; label: string; hint?: string; icon: LucideIcon; run: () => void };
  const rows = useMemo<Row[]>(() => {
    const all: Row[] = [
      ...ALL.map((item) => ({ group: "Ecrane", label: item.label, icon: item.icon, run: () => navigate(`/${item.path}`) })),
      ...actions.map((action) => ({ group: "Acțiuni", label: action.label, hint: action.hint, icon: action.icon, run: action.run })),
      ...(employees.data ?? []).map((employee) => ({
        group: "Angajați",
        label: employee.name,
        hint: employee.enrolled ? "Vezi în Jurnal" : "Telefon neactivat",
        icon: UserRound,
        run: () => navigate(`/journal?employee=${encodeURIComponent(employee.name)}`),
      })),
    ];
    const q = normalize(query.trim());
    return q ? all.filter((row) => normalize(row.label).includes(q)) : all.filter((row) => row.group !== "Angajați");
  }, [actions, employees.data, navigate, query]);

  useEffect(() => setCursor(0), [query, open]);
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const choose = (row: Row | undefined) => {
    if (!row) return;
    onClose();
    row.run();
  };

  let lastGroup = "";
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed top-3 left-1/2 z-50 flex max-h-[80dvh] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-sheet sm:top-[12vh]"
        >
          <DialogPrimitive.Title className="sr-only">Căutare rapidă</DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search className="size-5 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") (event.preventDefault(), setCursor((c) => Math.min(c + 1, rows.length - 1)));
                if (event.key === "ArrowUp") (event.preventDefault(), setCursor((c) => Math.max(c - 1, 0)));
                if (event.key === "Enter") choose(rows[cursor]);
              }}
              placeholder="Caută un ecran, o acțiune sau un Angajat…"
              className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground"
            />
            <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground sm:block">Esc</kbd>
          </div>
          <div className="overflow-y-auto p-2">
            {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">Nimic găsit pentru „{query}”.</p>}
            {rows.map((row, index) => {
              const header = row.group !== lastGroup ? row.group : null;
              lastGroup = row.group;
              return (
                <div key={`${row.group}-${row.label}`}>
                  {header && <div className="px-3 pt-3 pb-1 text-xs font-semibold text-muted-foreground uppercase">{header}</div>}
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => choose(row)}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                      index === cursor && "bg-muted",
                    )}
                  >
                    <row.icon className="size-[18px] text-muted-foreground" aria-hidden />
                    <span className="flex-1 text-[15px] font-medium">{row.label}</span>
                    {row.hint && <span className="text-xs text-muted-foreground">{row.hint}</span>}
                    {index === cursor && <CornerDownLeft className="size-3.5 text-muted-foreground" aria-hidden />}
                  </button>
                </div>
              );
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Starea comună a unei variante: foile deschise, căutarea, acțiunile. */
function useShellState() {
  const [plusOpen, setPlusOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useCommandK(setSearchOpen);
  const { pathname } = useLocation();
  useEffect(() => {
    setPlusOpen(false);
    setMoreOpen(false);
  }, [pathname]);
  const { actions, dialog } = useActions();
  const signals = useSignals();
  const isActive = useIsActive();
  const overlays = (
    <>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} actions={actions} />
      {dialog}
    </>
  );
  return { plusOpen, setPlusOpen, moreOpen, setMoreOpen, setSearchOpen, actions, signals, isActive, overlays };
}

function Main({ className }: { className?: string }) {
  return (
    <main className={cn("mx-auto min-w-0 max-w-6xl p-4 sm:p-8", className)}>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </main>
  );
}

/* ═════════════════════════ A · Andocat, cu ＋ ridicat ═════════════════════════
 * Telefon: antet de sticlă (logo, căutare, avatar); bară de jos lipită de margine, cu ＋ rotund ridicat în mijloc.
 * ＋ → plăcuțe 2×2; „Mai mult” → listă cu cifre + cardul de cont. Desktop: bară laterală plină, grupată, care se
 * poate restrânge la iconițe; căutarea e primul rând din ea. */
export function ShellVariantA() {
  const st = useShellState();
  const { username } = useAccount();
  const [collapsed, setCollapsed] = useState(false);
  const moreActive = MORE.some(st.isActive);

  return (
    <div className="min-h-screen">
      <Glow />
      {/* ── desktop: bara laterală ── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-card/80 backdrop-blur-xl transition-[width] lg:flex",
          collapsed ? "w-[76px]" : "w-[272px]",
        )}
      >
        <div className={cn("flex h-16 items-center px-5", collapsed && "justify-center px-0")}>
          <Logo size={30} wordmark={!collapsed} />
        </div>
        <div className="px-3">
          <button
            type="button"
            onClick={() => st.setSearchOpen(true)}
            className={cn(
              "flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-xl bg-muted px-3 text-sm text-muted-foreground hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <Search className="size-4" aria-hidden />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Caută…</span>
                <kbd className="rounded border border-border bg-card px-1.5 text-[11px]">Ctrl K</kbd>
              </>
            )}
          </button>
        </div>
        <nav aria-label="Meniu principal" className="mt-2 flex-1 overflow-y-auto px-3">
          {GROUPS.map((group) => (
            <div key={group.title} className="mt-4">
              {!collapsed && <div className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group.title}</div>}
              {group.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={`/${item.path}`}
                  end={item.path === ""}
                  title={collapsed ? item.label : undefined}
                  className="relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14.5px] font-medium text-muted-foreground hover:text-foreground"
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span layoutId="a-side-active" className="absolute inset-0 rounded-xl bg-primary/10 ring-1 ring-primary/20" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
                      )}
                      <item.icon className={cn("relative size-[18px] shrink-0", isActive && "text-primary")} aria-hidden />
                      {!collapsed && <span className={cn("relative flex-1", isActive && "text-foreground")}>{item.label}</span>}
                      <Badge item={item} s={st.signals} className={cn("relative", collapsed && "absolute top-1 right-2 h-4 min-w-4 px-1 text-[10px]")} />
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="mt-5 px-1">
            {!collapsed ? (
              <div className="grid grid-cols-2 gap-2">
                {st.actions.map((action) => (
                  <button key={action.label} type="button" onClick={action.run} className="flex cursor-pointer flex-col items-start gap-1.5 rounded-xl border border-border p-2.5 text-left text-xs font-medium hover:bg-muted">
                    <action.icon className="size-4 text-primary" aria-hidden />
                    {action.label}
                  </button>
                ))}
              </div>
            ) : (
              <button type="button" onClick={() => st.setPlusOpen(true)} title="Acțiuni rapide" className="bg-gradient-brand mx-auto grid size-10 cursor-pointer place-items-center rounded-xl">
                <Plus className="size-5" />
              </button>
            )}
          </div>
        </nav>
        <div className="border-t border-border p-3">
          {collapsed ? (
            <div className="flex justify-center"><Avatar name={username} /></div>
          ) : (
            <AccountCard />
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="mt-2 flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-lg text-xs text-muted-foreground hover:bg-muted"
          >
            {collapsed ? <ChevronsRight className="size-4" /> : (<><ChevronsLeft className="size-4" /> Restrânge</>)}
          </button>
        </div>
      </aside>

      {/* ── telefon: antetul ── */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/60 bg-card/70 px-4 backdrop-blur-xl lg:hidden">
        <Logo size={28} />
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => st.setSearchOpen(true)} aria-label="Caută" className="grid size-10 cursor-pointer place-items-center rounded-full hover:bg-muted">
            <Search className="size-5" />
          </button>
          <button type="button" onClick={() => st.setMoreOpen(true)} aria-label="Contul meu" className="cursor-pointer rounded-full">
            <Avatar name={username} size={32} />
          </button>
        </div>
      </header>

      <Main className={cn("pb-32 lg:pb-8", collapsed ? "lg:ml-[76px]" : "lg:ml-[272px]", "lg:max-w-none xl:px-12")} />

      {/* ── telefon: bara de jos ── */}
      <nav aria-label="Meniu principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-card/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          <TabA item={I.home} st={st} />
          <TabA item={I.anomalies} st={st} />
          <div className="flex justify-center">
            <motion.button
              type="button"
              whileTap={{ scale: 0.9 }}
              onClick={() => st.setPlusOpen(true)}
              aria-label="Acțiuni rapide"
              className="bg-gradient-brand -mt-8 grid size-[60px] cursor-pointer place-items-center rounded-full shadow-[0_10px_30px_rgb(37_99_235/0.45)] ring-4 ring-background"
            >
              <Plus className="size-7" strokeWidth={2.5} />
            </motion.button>
          </div>
          <TabA item={I.journal} st={st} />
          <button type="button" onClick={() => st.setMoreOpen(true)} className="relative flex cursor-pointer flex-col items-center gap-0.5 py-1">
            {moreActive && <motion.span layoutId="a-tab-active" className="absolute -top-px h-0.5 w-8 rounded-full bg-primary" />}
            <span className="relative">
              <LayoutGrid className={cn("size-[22px]", moreActive ? "text-primary" : "text-muted-foreground")} />
              {(st.signals.incidents > 0 || !st.signals.doorActive) && <span className="absolute -top-0.5 -right-1 size-2.5 rounded-full bg-destructive ring-2 ring-card" />}
            </span>
            <span className={cn("text-[11px] font-medium", moreActive ? "text-primary" : "text-muted-foreground")}>Mai mult</span>
          </button>
        </div>
      </nav>

      <MenuSheet open={st.plusOpen} onClose={() => st.setPlusOpen(false)} title="Acțiuni rapide">
        <div className="grid grid-cols-2 gap-3">
          {st.actions.map((action) => (
            <button key={action.label} type="button" onClick={() => (st.setPlusOpen(false), action.run())} className="flex cursor-pointer flex-col items-start gap-3 rounded-2xl bg-card p-4 text-left shadow-card ring-1 ring-border hover:ring-primary/40">
              <span className="bg-gradient-brand grid size-10 place-items-center rounded-xl"><action.icon className="size-5" /></span>
              <span>
                <span className="block text-[15px] font-semibold">{action.label}</span>
                <span className="text-xs text-muted-foreground">{action.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </MenuSheet>

      <MenuSheet open={st.moreOpen} onClose={() => st.setMoreOpen(false)} title="Mai mult">
        <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
          {MORE.map((item, index) => (
            <NavLink key={item.path} to={`/${item.path}`} className={cn("flex h-14 items-center gap-3 px-4 text-[15px] font-medium hover:bg-muted", index > 0 && "border-t border-border")}>
              <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><item.icon className="size-[18px]" /></span>
              <span className="flex-1">{item.label}</span>
              <Badge item={item} s={st.signals} />
            </NavLink>
          ))}
        </div>
        <div className="mt-4"><AccountCard /></div>
      </MenuSheet>
      {st.overlays}
    </div>
  );
}

function TabA({ item, st }: { item: Item; st: ReturnType<typeof useShellState> }) {
  const active = st.isActive(item);
  return (
    <NavLink to={`/${item.path}`} end={item.path === ""} className="relative flex flex-col items-center gap-0.5 py-1">
      {active && <motion.span layoutId="a-tab-active" className="absolute -top-px h-0.5 w-8 rounded-full bg-primary" />}
      <span className="relative">
        <item.icon className={cn("size-[22px]", active ? "text-primary" : "text-muted-foreground")} />
        <Badge item={item} s={st.signals} className="absolute -top-1.5 left-3.5 h-4 min-w-4 px-1 text-[10px]" />
      </span>
      <span className={cn("text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}>{item.short ?? item.label}</span>
    </NavLink>
  );
}

/* ═════════════════════════ B · Plutitor, cu plăcuțe ═════════════════════════
 * Telefon: fără antet fix; o pastilă de sticlă plutește deasupra marginii de jos, cu ＋ în linie. „Mai mult” se
 * deschide pe tot ecranul ca o grilă de plăcuțe colorate, cu o bandă de stare deasupra. Desktop: o șină îngustă de
 * iconițe cu etichete sub ele (fără grupuri), ca o aplicație de telefon întinsă. */
const TILE_COLORS: Record<string, string> = {
  employees: "from-sky-500 to-blue-600",
  "door-screen": "from-emerald-500 to-teal-600",
  incidents: "from-rose-500 to-red-600",
  reports: "from-violet-500 to-indigo-600",
  settings: "from-slate-500 to-slate-700",
  journal: "from-amber-500 to-orange-600",
  anomalies: "from-orange-500 to-amber-600",
  "": "from-blue-600 to-indigo-700",
};

export function ShellVariantB() {
  const st = useShellState();
  const { username } = useAccount();
  const tabs: (Item | "plus" | "more")[] = [I.home, I.anomalies, "plus", I.journal, "more"];
  const moreActive = MORE.some(st.isActive);

  return (
    <div className="min-h-screen">
      <Glow />
      {/* ── desktop: șina ── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[92px] flex-col items-center gap-1 border-r border-border bg-card/70 py-4 backdrop-blur-xl lg:flex">
        <Logo size={34} wordmark={false} className="mb-3" />
        <button type="button" onClick={() => st.setPlusOpen(true)} title="Acțiuni rapide" className="bg-gradient-brand mb-2 grid size-11 cursor-pointer place-items-center rounded-2xl shadow-[0_8px_24px_rgb(37_99_235/0.35)]">
          <Plus className="size-5" strokeWidth={2.5} />
        </button>
        <button type="button" onClick={() => st.setSearchOpen(true)} title="Caută (Ctrl+K)" className="mb-2 grid size-11 cursor-pointer place-items-center rounded-2xl text-muted-foreground hover:bg-muted hover:text-foreground">
          <Search className="size-5" />
        </button>
        <nav aria-label="Meniu principal" className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
          {ALL.map((item) => (
            <NavLink key={item.path} to={`/${item.path}`} end={item.path === ""} className="group relative flex w-[76px] flex-col items-center gap-1 rounded-2xl py-2">
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="b-rail-active" className="absolute inset-0 rounded-2xl bg-primary/10" />}
                  <span className="relative">
                    <item.icon className={cn("size-[22px]", isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                    <Badge item={item} s={st.signals} className="absolute -top-2 left-3.5 h-4 min-w-4 px-1 text-[10px]" />
                  </span>
                  <span className={cn("relative text-center text-[10.5px] leading-tight font-medium", isActive ? "text-foreground" : "text-muted-foreground")}>
                    {item.short ?? item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <button type="button" onClick={() => st.setMoreOpen(true)} title="Contul meu" className="cursor-pointer rounded-full">
          <Avatar name={username} size={40} />
        </button>
      </aside>

      {/* ── telefon: doar un rând subțire sus ── */}
      <div className="flex items-center justify-between px-4 pt-4 lg:hidden">
        <Logo size={28} />
        <button type="button" onClick={() => st.setSearchOpen(true)} className="flex h-9 cursor-pointer items-center gap-2 rounded-full bg-card px-3.5 text-sm text-muted-foreground shadow-card ring-1 ring-border">
          <Search className="size-4" /> Caută
        </button>
      </div>

      <Main className="pb-36 lg:ml-[92px] lg:max-w-none lg:pb-8 xl:px-12" />

      {/* ── telefon: pastila plutitoare ── */}
      <nav aria-label="Meniu principal" className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 lg:hidden">
        <div className="mx-auto flex h-[68px] max-w-md items-center justify-between rounded-full bg-[#0b1229]/85 px-2 text-white shadow-[0_16px_40px_rgb(0_0_0/0.35)] ring-1 ring-white/10 backdrop-blur-2xl">
          {tabs.map((tab) => {
            if (tab === "plus")
              return (
                <motion.button key="plus" type="button" whileTap={{ scale: 0.9 }} onClick={() => st.setPlusOpen(true)} aria-label="Acțiuni rapide" className="grid size-[52px] cursor-pointer place-items-center rounded-full bg-gradient-to-br from-blue-500 to-sky-400 shadow-[0_0_24px_rgb(56_189_248/0.5)]">
                  <Plus className="size-6" strokeWidth={2.75} />
                </motion.button>
              );
            const item = tab === "more" ? null : tab;
            const active = item ? st.isActive(item) : moreActive;
            const Icon = item ? item.icon : LayoutGrid;
            const content = (
              <>
                {active && <motion.span layoutId="b-pill-active" className="absolute inset-0 rounded-full bg-white/12" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                <span className="relative">
                  <Icon className={cn("size-[22px]", active ? "text-white" : "text-white/55")} />
                  {item && <Badge item={item} s={st.signals} className="absolute -top-2 left-3.5 h-4 min-w-4 px-1 text-[10px] ring-2 ring-[#0b1229]" />}
                </span>
                {active && <span className="relative text-[13px] font-semibold">{item ? (item.short ?? item.label) : "Mai mult"}</span>}
              </>
            );
            const cls = "relative flex h-[52px] cursor-pointer items-center justify-center gap-2 rounded-full px-3.5";
            return item ? (
              <NavLink key={item.path} to={`/${item.path}`} end={item.path === ""} className={cls} aria-label={item.label}>
                {content}
              </NavLink>
            ) : (
              <button key="more" type="button" onClick={() => st.setMoreOpen(true)} className={cls} aria-label="Mai mult">
                {content}
              </button>
            );
          })}
        </div>
      </nav>

      <MenuSheet open={st.plusOpen} onClose={() => st.setPlusOpen(false)} title="Ce vrei să faci?">
        <div className="flex flex-col gap-2">
          {st.actions.map((action) => (
            <button key={action.label} type="button" onClick={() => (st.setPlusOpen(false), action.run())} className="flex cursor-pointer items-center gap-4 rounded-2xl p-3 text-left hover:bg-muted">
              <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-sky-400 text-white"><action.icon className="size-6" /></span>
              <span className="flex-1">
                <span className="block text-[16px] font-semibold">{action.label}</span>
                <span className="text-sm text-muted-foreground">{action.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </MenuSheet>

      <MenuSheet open={st.moreOpen} onClose={() => st.setMoreOpen(false)} title="Mai mult">
        <div className="mb-4 flex gap-2 overflow-x-auto text-xs font-semibold">
          <span className="rounded-full bg-primary/10 px-3 py-1.5 text-primary">{st.signals.inHall} în Sală acum</span>
          <span className={cn("rounded-full px-3 py-1.5", st.signals.doorActive ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive")}>
            Ușa: {st.signals.doorActive ? "activă" : "neactivată"}
          </span>
          {st.signals.anomalies > 0 && <span className="rounded-full bg-warning/12 px-3 py-1.5 text-warning">{st.signals.anomalies} de verificat</span>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {MORE.map((item) => (
            <NavLink key={item.path} to={`/${item.path}`} className="relative flex flex-col items-center gap-2 rounded-2xl bg-card p-3 pt-4 text-center shadow-card ring-1 ring-border">
              <span className={cn("grid size-12 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-md", TILE_COLORS[item.path])}>
                <item.icon className="size-6" />
              </span>
              <span className="text-[12.5px] leading-tight font-medium">{item.short ?? item.label}</span>
              <Badge item={item} s={st.signals} className="absolute top-2 right-2" />
            </NavLink>
          ))}
        </div>
        <div className="mt-4"><AccountCard /></div>
      </MenuSheet>
      {st.overlays}
    </div>
  );
}

/* ═════════════════════════ C · Centru de comandă ═════════════════════════
 * Starea Sălii vine prima: sus, un câmp mare de căutare și un rând de „jetoane” vii (în Sală, de verificat,
 * Incidente, ușa) care sunt și scurtături. Jos, o bară simplă cu etichete și ＋ pătrat. Desktop: bară laterală cu
 * un card „Acum în Sală” (inițiale) deasupra navigării grupate. */
export function ShellVariantC() {
  const st = useShellState();
  const moreActive = MORE.some(st.isActive);
  const navigate = useNavigate();
  const s = st.signals;
  const chips = [
    { label: `${s.inHall} în Sală`, tone: "bg-primary/12 text-primary", to: "/", dot: "bg-primary" },
    { label: `${s.anomalies} Anomalii`, tone: s.anomalies ? "bg-warning/12 text-warning" : "bg-muted text-muted-foreground", to: "/anomalies", dot: s.anomalies ? "bg-warning" : "bg-muted-foreground" },
    { label: `${s.incidents} Incidente`, tone: s.incidents ? "bg-destructive/12 text-destructive" : "bg-muted text-muted-foreground", to: "/incidents", dot: s.incidents ? "bg-destructive" : "bg-muted-foreground" },
    { label: s.doorActive ? "Ușa activă" : "Ușa neactivată", tone: s.doorActive ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive", to: "/door-screen", dot: s.doorActive ? "bg-success animate-pulse" : "bg-destructive" },
  ];

  return (
    <div className="min-h-screen">
      <LiveBackground />
      {/* ── desktop: bara laterală cu starea Sălii ── */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[288px] flex-col gap-4 border-r border-border bg-card/80 p-4 backdrop-blur-xl lg:flex">
        <Logo size={30} className="px-2 pt-1" />
        <div className="bg-gradient-brand relative overflow-hidden rounded-2xl p-4">
          <div aria-hidden className="absolute -top-10 -right-10 size-32 rounded-full bg-white/10 blur-2xl" />
          <div className="text-xs font-medium text-white/70">Acum în Sală</div>
          <div className="mt-1 text-3xl font-bold tabular-nums">{s.inHall}</div>
          <div className="mt-3 flex -space-x-2">
            {s.people.slice(0, 6).map((person) => (
              <span key={person.session_id} title={person.employee_name} className="grid size-8 place-items-center rounded-full bg-white/20 text-[11px] font-semibold ring-2 ring-[#1d4ed8] backdrop-blur">
                {initials(person.employee_name)}
              </span>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-white/80">
            <span className={cn("size-2 rounded-full", s.doorActive ? "bg-emerald-300" : "bg-red-300")} />
            Ecranul de la ușă {s.doorActive ? "e activ" : "nu e activat"}
          </div>
        </div>
        <button type="button" onClick={() => st.setSearchOpen(true)} className="flex h-10 cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 text-sm text-muted-foreground hover:bg-muted">
          <Search className="size-4" /> <span className="flex-1 text-left">Caută sau rulează…</span>
          <kbd className="rounded border border-border px-1.5 text-[11px]">Ctrl K</kbd>
        </button>
        <nav aria-label="Meniu principal" className="flex-1 overflow-y-auto">
          {GROUPS.map((group) => (
            <div key={group.title} className="mb-3">
              <div className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group.title}</div>
              {group.items.map((item) => (
                <NavLink key={item.path} to={`/${item.path}`} end={item.path === ""} className="relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14.5px] font-medium">
                  {({ isActive }) => (
                    <>
                      {isActive && <motion.span layoutId="c-side-active" className="absolute top-2 bottom-2 left-0 w-1 rounded-full bg-primary" />}
                      <item.icon className={cn("size-[18px]", isActive ? "text-primary" : "text-muted-foreground")} />
                      <span className={cn("flex-1", isActive ? "text-foreground" : "text-muted-foreground")}>{item.label}</span>
                      <Badge item={item} s={s} />
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <AccountCard />
      </aside>

      {/* ── telefon: căutarea și jetoanele ── */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-3 pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => st.setSearchOpen(true)} className="flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-2xl bg-card px-4 text-[15px] text-muted-foreground shadow-card ring-1 ring-border">
            <Search className="size-[18px] shrink-0" /> <span className="truncate">Caută Angajat, ecran, acțiune…</span>
          </button>
          <button type="button" onClick={() => st.setMoreOpen(true)} className="cursor-pointer rounded-full" aria-label="Contul meu">
            <Avatar name={useAccount().username} size={40} />
          </button>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5 [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none]">
          {chips.map((chip) => (
            <button key={chip.to} type="button" onClick={() => navigate(chip.to)} className={cn("flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold", chip.tone)}>
              <span className={cn("size-1.5 rounded-full", chip.dot)} />
              {chip.label}
            </button>
          ))}
        </div>
      </header>

      <Main className="pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(6rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] lg:ml-[288px] lg:max-w-none lg:pb-8 xl:px-12" />

      {/* ── telefon: bara de jos, simplă ── */}
      <nav aria-label="Meniu principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/85 pr-[env(safe-area-inset-right)] pb-[max(0.25rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid h-[62px] max-w-md grid-cols-5 items-stretch px-2">
          {([I.home, I.anomalies] as Item[]).map((item) => <TabC key={item.path} item={item} st={st} />)}
          <div className="grid place-items-center">
            <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={() => st.setPlusOpen(true)} aria-label="Acțiuni rapide" className="grid size-11 cursor-pointer place-items-center rounded-2xl bg-foreground text-background">
              <Plus className="size-6" strokeWidth={2.5} />
            </motion.button>
          </div>
          <TabC item={I.journal} st={st} />
          <button type="button" onClick={() => st.setMoreOpen(true)} className="flex cursor-pointer flex-col items-center justify-center gap-1">
            <LayoutGrid className={cn("size-5", moreActive ? "text-foreground" : "text-muted-foreground")} />
            <span className={cn("text-[11px] font-semibold", moreActive ? "text-foreground" : "text-muted-foreground")}>Mai mult</span>
          </button>
        </div>
      </nav>

      <MenuSheet open={st.plusOpen} onClose={() => st.setPlusOpen(false)} title="Acțiuni rapide">
        <div className="grid grid-cols-2 gap-2">
          {st.actions.map((action) => (
            <button key={action.label} type="button" onClick={() => (st.setPlusOpen(false), action.run())} className="flex cursor-pointer items-center gap-3 rounded-2xl bg-muted p-3.5 text-left">
              <action.icon className="size-5 text-primary" />
              <span className="text-[14px] font-semibold">{action.label}</span>
            </button>
          ))}
        </div>
      </MenuSheet>

      <MenuSheet open={st.moreOpen} onClose={() => st.setMoreOpen(false)} title="Mai mult">
        {GROUPS.map((group) => {
          const items = group.items.filter((item) => MORE.includes(item));
          if (!items.length) return null;
          return (
            <div key={group.title} className="mb-3">
              <div className="px-1 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group.title}</div>
              <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
                {items.map((item, index) => (
                  <NavLink key={item.path} to={`/${item.path}`} className={cn("flex h-13 items-center gap-3 px-4 text-[15px] font-medium", index > 0 && "border-t border-border")}>
                    <item.icon className="size-5 text-muted-foreground" />
                    <span className="flex-1">{item.label}</span>
                    <Badge item={item} s={s} />
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
        <AccountCard />
      </MenuSheet>
      {st.overlays}
    </div>
  );
}

function TabC({ item, st }: { item: Item; st: ReturnType<typeof useShellState> }) {
  const active = st.isActive(item);
  return (
    <NavLink to={`/${item.path}`} end={item.path === ""} className="relative flex flex-col items-center justify-center gap-1">
      <span className="relative">
        <item.icon className={cn("size-5", active ? "text-foreground" : "text-muted-foreground")} />
        <Badge item={item} s={st.signals} className="absolute -top-2 left-3 h-4 min-w-4 px-1 text-[10px]" />
      </span>
      <span className={cn("text-[11px] font-semibold", active ? "text-foreground" : "text-muted-foreground")}>{item.short ?? item.label}</span>
      {active && <motion.span layoutId="c-tab-active" className="absolute bottom-1 h-1 w-1 rounded-full bg-foreground" />}
    </NavLink>
  );
}
