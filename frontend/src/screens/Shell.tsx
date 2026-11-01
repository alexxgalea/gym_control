import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlus,
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
  Users,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { adminApi } from "@/api/client";
import { ME_KEY, useMe } from "@/auth";
import { ToastProvider } from "@/components/toast";
import { LiveBackground } from "@/design/LiveBackground";
import { Logo } from "@/design/Logo";
import { ThemeSwitch } from "@/design/ThemeSwitch";
import { ANOMALIES_KEY, INCIDENTS_KEY, IN_HALL_KEY } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";
import { CommandPalette, useCommandShortcut, type Command } from "@/screens/CommandPalette";
import { AddSessionDialog } from "@/screens/ManualSession";

type Screen = { path: string; label: string; icon: LucideIcon };

const HOME: Screen = { path: "", label: "Acasă", icon: House };
const EMPLOYEES: Screen = { path: "employees", label: "Angajați", icon: Users };
const DOOR: Screen = { path: "door-screen", label: "Ecranul de la ușă", icon: DoorOpen };
const JOURNAL: Screen = { path: "journal", label: "Jurnal", icon: ScrollText };
const ANOMALIES: Screen = { path: "anomalies", label: "Anomalii", icon: TriangleAlert };
const INCIDENTS: Screen = { path: "incidents", label: "Incidente", icon: ShieldAlert };
const REPORTS: Screen = { path: "reports", label: "Raport de prezență", icon: FileText };
const SETTINGS: Screen = { path: "settings", label: "Setări", icon: Settings };

/** Ecranele din meniu (fără Acasă), pentru rute; ordinea afișării e cea din `GROUPS`. */
export const SCREENS: readonly Screen[] = [EMPLOYEES, DOOR, JOURNAL, ANOMALIES, INCIDENTS, REPORTS, SETTINGS];

/** Meniul de pe desktop și din „Mai mult”, grupat după ce face Adminul acolo. */
const GROUPS: { title: string; screens: Screen[] }[] = [
  { title: "Operare", screens: [HOME, JOURNAL, DOOR] },
  { title: "De verificat", screens: [ANOMALIES, INCIDENTS] },
  { title: "Administrare", screens: [EMPLOYEES, REPORTS, SETTINGS] },
];

/** Pe telefon, bara de jos are Acasă, Anomalii, ＋, Jurnal și „Mai mult” (restul ecranelor). */
const MORE: Screen[] = [EMPLOYEES, DOOR, INCIDENTS, REPORTS, SETTINGS];

/** Ca pe Acasă: semnalele se reîmprospătează la 30 de secunde și când revii în fereastră. */
const REFRESH = { refetchInterval: 30_000, refetchOnWindowFocus: true } as const;

/** Starea Sălii pentru meniu; aceleași interogări ca pe Acasă (cache comun), deci fără cereri în plus. */
function useHallSignals() {
  const inHall = useQuery({ queryKey: IN_HALL_KEY, queryFn: adminApi.inHall, ...REFRESH });
  const anomalies = useQuery({ queryKey: ANOMALIES_KEY, queryFn: adminApi.anomalies.list, ...REFRESH });
  const incidents = useQuery({ queryKey: INCIDENTS_KEY, queryFn: adminApi.incidents.list, ...REFRESH });
  return {
    people: inHall.data?.people ?? [],
    // până răspunde serverul presupunem că ușa e activă: un punct roșu care dispare imediat ar fi o alarmă falsă
    doorActive: inHall.data?.door_screen_active ?? true,
    anomalies: anomalies.data?.length ?? 0,
    incidents: incidents.data?.filter((incident) => incident.status === "open").length ?? 0,
  };
}
type Signals = ReturnType<typeof useHallSignals>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Ce semnal are un ecran în meniu: o cifră, un punct, plus textul citit de cititoarele de ecran. */
function signalFor(screen: Screen, s: Signals): { value: number | null; tone: "warn" | "danger" | "info"; text: string } | null {
  if (screen === ANOMALIES && s.anomalies) return { value: s.anomalies, tone: "warn", text: `${s.anomalies} de verificat` };
  if (screen === INCIDENTS && s.incidents) return { value: s.incidents, tone: "danger", text: plural(s.incidents, "deschis", "deschise") };
  if (screen === HOME && s.people.length) return { value: s.people.length, tone: "info", text: `${s.people.length} în Sală` };
  if (screen === DOOR && !s.doorActive) return { value: null, tone: "danger", text: "neactivat" };
  return null;
}

const TONES = { warn: "bg-warning text-white", danger: "bg-destructive text-white", info: "bg-primary/15 text-primary" };

/** Insigna vizuală; textul ei e deja în numele accesibil al linkului (`labelFor`). */
function Badge({ screen, s, className }: { screen: Screen; s: Signals; className?: string }) {
  const signal = signalFor(screen, s);
  if (!signal) return null;
  if (signal.value === null)
    return <span aria-hidden className={cn("size-2.5 rounded-full ring-2 ring-card", TONES[signal.tone], className)} />;
  return (
    <span
      aria-hidden
      className={cn("grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold tabular-nums", TONES[signal.tone], className)}
    >
      {signal.value}
    </span>
  );
}

function labelFor(screen: Screen, s: Signals) {
  const signal = signalFor(screen, s);
  return signal ? `${screen.label}, ${signal.text}` : screen.label;
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
      aria-hidden
      className="bg-gradient-brand grid shrink-0 place-items-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials(name)}
    </span>
  );
}

/** Contul: numele, Deconectare și tema. Stă jos în bara laterală și în „Mai mult”. */
function AccountCard() {
  const me = useMe();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: adminApi.logout,
    onSuccess: () => queryClient.setQueryData(ME_KEY, null),
  });
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-3">
      <div className="flex items-center gap-3">
        <Avatar name={me.data?.username} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{me.data?.username}</div>
          <div className="text-xs text-muted-foreground">Admin</div>
        </div>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          aria-label="Deconectare"
          title="Deconectare"
          className="grid size-9 cursor-pointer place-items-center rounded-xl text-muted-foreground hover:bg-card hover:text-destructive disabled:opacity-50"
        >
          <LogOut className="size-4" aria-hidden />
        </button>
      </div>
      <ThemeSwitch />
    </div>
  );
}

/** Foaia de jos pe telefon (centrată pe desktop) pentru „＋” și „Mai mult”. */
function MenuSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
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
              {/* învelișul acoperă ecranul; un clic pe el, în afara foii, o închide */}
              <div
                className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
                onClick={(event) => event.target === event.currentTarget && onOpenChange(false)}
              >
                <motion.div
                  className="max-h-[88dvh] w-full overflow-y-auto rounded-t-[28px] bg-background pt-4 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] shadow-sheet sm:max-w-md sm:rounded-[28px] sm:p-4"
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

/**
 * Cadrul Adminului („Centru de comandă”).
 * - Telefon: sus, căutarea și jetoanele cu starea Sălii (sunt și scurtături); jos, bara Acasă · Anomalii · ＋ ·
 *   Jurnal · Mai mult. ＋ deschide acțiunile rapide, „Mai mult” restul ecranelor și contul.
 * - Desktop: bara laterală cu cardul „Acum în Sală”, căutarea (Ctrl+K) și meniul grupat.
 * Peste tot: fundalul viu și marginile sigure ale telefonului (zona camerei, bara de gesturi).
 */
export function Shell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const me = useMe();
  const s = useHallSignals();
  const [plusOpen, setPlusOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [addingSession, setAddingSession] = useState(false);
  useCommandShortcut(useCallback(() => setSearchOpen(true), []));

  // orice navigare închide foile
  useEffect(() => {
    setPlusOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  const isActive = (screen: Screen) =>
    screen.path === "" ? pathname === "/" : pathname === `/${screen.path}` || pathname.startsWith(`/${screen.path}/`);
  const moreActive = MORE.some(isActive);

  const actions: { label: string; hint: string; icon: LucideIcon; run: () => void }[] = [
    { label: "Sesiune manuală", hint: "Intrare sau Ieșire uitată", icon: CalendarPlus, run: () => setAddingSession(true) },
    { label: "Angajat nou", hint: "Adaugă și activează", icon: UserPlus, run: () => navigate("/employees?nou") },
    { label: "Incident nou", hint: "Marchează o pagubă", icon: ShieldAlert, run: () => navigate("/incidents?nou") },
    { label: "Raport de prezență", hint: "Cine a fost în Sală", icon: FileText, run: () => navigate("/reports") },
  ];
  const commands: Command[] = [
    ...GROUPS.flatMap((group) => group.screens).map((screen) => ({
      group: "Ecrane",
      label: screen.label,
      icon: screen.icon,
      run: () => navigate(`/${screen.path}`),
    })),
    ...actions.map((action) => ({ group: "Acțiuni", label: action.label, hint: action.hint, icon: action.icon, run: action.run })),
  ];

  const chips = [
    { to: "/", label: `${s.people.length} în Sală`, tone: "bg-primary/12 text-primary", dot: "bg-primary" },
    {
      to: "/anomalies",
      label: plural(s.anomalies, "Anomalie", "Anomalii"),
      tone: s.anomalies ? "bg-warning/12 text-warning" : "bg-muted text-muted-foreground",
      dot: s.anomalies ? "bg-warning" : "bg-muted-foreground",
    },
    {
      to: "/incidents",
      label: plural(s.incidents, "Incident deschis", "Incidente deschise"),
      tone: s.incidents ? "bg-destructive/12 text-destructive" : "bg-muted text-muted-foreground",
      dot: s.incidents ? "bg-destructive" : "bg-muted-foreground",
    },
    {
      to: "/door-screen",
      label: s.doorActive ? "Ușa activă" : "Ușa neactivată",
      tone: s.doorActive ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive",
      dot: s.doorActive ? "bg-success" : "bg-destructive",
    },
  ];

  return (
    <div className="min-h-dvh">
      <LiveBackground />

      {/* ── desktop: bara laterală ── */}
      <aside
        aria-label="Bara laterală"
        className="fixed inset-y-0 left-0 z-30 hidden w-[288px] flex-col gap-4 border-r border-border bg-card/80 p-4 backdrop-blur-xl lg:flex"
      >
        <Logo size={30} className="px-2 pt-1" />
        <Link to="/" className="bg-gradient-brand relative block overflow-hidden rounded-2xl p-4">
          <span aria-hidden className="absolute -top-10 -right-10 size-32 rounded-full bg-white/10 blur-2xl" />
          <span className="block text-xs font-medium text-white/70">Acum în Sală</span>
          <span className="mt-1 block text-3xl font-bold tabular-nums">{s.people.length}</span>
          {s.people.length > 0 && (
            <span className="mt-3 flex -space-x-2">
              {s.people.slice(0, 6).map((person) => (
                <span
                  key={person.session_id}
                  title={person.employee_name}
                  className="grid size-8 place-items-center rounded-full bg-white/20 text-[11px] font-semibold ring-2 ring-[#1d4ed8]"
                >
                  {initials(person.employee_name)}
                </span>
              ))}
            </span>
          )}
          <span className="mt-3 flex items-center gap-2 text-xs text-white/80">
            <span aria-hidden className={cn("size-2 rounded-full", s.doorActive ? "bg-emerald-300" : "bg-red-300")} />
            Ecranul de la ușă {s.doorActive ? "e activ" : "nu e activat"}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex h-10 cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card/60 px-3 text-sm text-muted-foreground hover:bg-muted"
        >
          <Search className="size-4" aria-hidden />
          <span className="flex-1 text-left">Caută sau rulează…</span>
          <kbd className="rounded border border-border px-1.5 text-[11px]">Ctrl K</kbd>
        </button>
        <nav aria-label="Meniu principal" className="flex-1 overflow-y-auto">
          {GROUPS.map((group) => (
            <div key={group.title} className="mb-3">
              <div className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group.title}</div>
              {group.screens.map((screen) => (
                <NavLink
                  key={screen.path}
                  to={`/${screen.path}`}
                  end={screen.path === ""}
                  aria-label={labelFor(screen, s)}
                  className="relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14.5px] font-medium hover:bg-muted/60"
                >
                  {({ isActive: active }) => (
                    <>
                      {active && (
                        <motion.span layoutId="side-active" className="absolute top-2 bottom-2 left-0 w-1 rounded-full bg-primary" />
                      )}
                      <screen.icon className={cn("size-[18px]", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                      <span className={cn("flex-1", active ? "text-foreground" : "text-muted-foreground")}>{screen.label}</span>
                      <Badge screen={screen} s={s} />
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <AccountCard />
      </aside>

      {/* ── telefon: căutarea și jetoanele cu starea Sălii ── */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 pt-[max(0.75rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-3 pl-[max(1rem,env(safe-area-inset-left))] backdrop-blur-xl lg:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Caută"
            className="flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-2xl bg-card px-4 text-[15px] text-muted-foreground shadow-card ring-1 ring-border"
          >
            <Search className="size-[18px] shrink-0" aria-hidden />
            <span className="truncate">Caută Angajat, ecran, acțiune…</span>
          </button>
          <button type="button" onClick={() => setMoreOpen(true)} aria-label="Contul meu" className="cursor-pointer rounded-full">
            <Avatar name={me.data?.username} size={40} />
          </button>
        </div>
        <nav
          aria-label="Starea Sălii"
          className="mt-3 flex gap-2 overflow-x-auto pb-0.5 [mask-image:linear-gradient(to_right,black_85%,transparent)] [scrollbar-width:none]"
        >
          {chips.map((chip) => (
            <Link
              key={chip.to}
              to={chip.to}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold", chip.tone)}
            >
              <span aria-hidden className={cn("size-1.5 rounded-full", chip.dot)} />
              {chip.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto min-w-0 max-w-6xl pt-4 pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(6rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] sm:p-8 sm:pb-[calc(6rem+env(safe-area-inset-bottom))] lg:ml-[288px] lg:max-w-none lg:pb-8 xl:px-12">
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </main>

      {/* ── telefon: bara de jos ── */}
      <nav
        aria-label="Navigare rapidă"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/85 pr-[env(safe-area-inset-right)] pb-[max(0.25rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] backdrop-blur-xl lg:hidden"
      >
        <div className="mx-auto grid h-[62px] max-w-md grid-cols-5 items-stretch px-2">
          <Tab screen={HOME} s={s} />
          <Tab screen={ANOMALIES} s={s} />
          <div className="grid place-items-center">
            <motion.button
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => setPlusOpen(true)}
              aria-label="Acțiuni rapide"
              className="grid size-11 cursor-pointer place-items-center rounded-2xl bg-foreground text-background"
            >
              <Plus className="size-6" strokeWidth={2.5} aria-hidden />
            </motion.button>
          </div>
          <Tab screen={JOURNAL} s={s} />
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            className="relative flex cursor-pointer flex-col items-center justify-center gap-1"
          >
            <span className="relative">
              <LayoutGrid className={cn("size-5", moreActive ? "text-foreground" : "text-muted-foreground")} aria-hidden />
              {(s.incidents > 0 || !s.doorActive) && (
                <span aria-hidden className="absolute -top-0.5 -right-1 size-2.5 rounded-full bg-destructive ring-2 ring-card" />
              )}
            </span>
            <span className={cn("text-[11px] font-semibold", moreActive ? "text-foreground" : "text-muted-foreground")}>Mai mult</span>
          </button>
        </div>
      </nav>

      <MenuSheet open={plusOpen} onOpenChange={setPlusOpen} title="Acțiuni rapide">
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                setPlusOpen(false);
                action.run();
              }}
              className="flex cursor-pointer items-center gap-3 rounded-2xl bg-muted p-3.5 text-left"
            >
              <action.icon className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="text-[14px] font-semibold">{action.label}</span>
            </button>
          ))}
        </div>
      </MenuSheet>

      <MenuSheet open={moreOpen} onOpenChange={setMoreOpen} title="Mai mult">
        <nav aria-label="Alte ecrane">
          {GROUPS.map((group) => {
            const screens = group.screens.filter((screen) => MORE.includes(screen));
            if (!screens.length) return null;
            return (
              <div key={group.title} className="mb-3">
                <div className="px-1 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{group.title}</div>
                <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
                  {screens.map((screen, index) => (
                    <NavLink
                      key={screen.path}
                      to={`/${screen.path}`}
                      aria-label={labelFor(screen, s)}
                      className={cn("flex h-13 items-center gap-3 px-4 text-[15px] font-medium", index > 0 && "border-t border-border")}
                    >
                      <screen.icon className="size-5 text-muted-foreground" aria-hidden />
                      <span className="flex-1">{screen.label}</span>
                      <Badge screen={screen} s={s} />
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
        <AccountCard />
      </MenuSheet>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} commands={commands} />
      <AddSessionDialog open={addingSession} onClose={() => setAddingSession(false)} />
    </div>
  );
}

function Tab({ screen, s }: { screen: Screen; s: Signals }) {
  return (
    <NavLink
      to={`/${screen.path}`}
      end={screen.path === ""}
      aria-label={labelFor(screen, s)}
      className="relative flex flex-col items-center justify-center gap-1"
    >
      {({ isActive }) => (
        <>
          <span className="relative">
            <screen.icon className={cn("size-5", isActive ? "text-foreground" : "text-muted-foreground")} aria-hidden />
            <Badge screen={screen} s={s} className="absolute -top-2 left-3 h-4 min-w-4 px-1 text-[10px]" />
          </span>
          <span className={cn("text-[11px] font-semibold", isActive ? "text-foreground" : "text-muted-foreground")}>
            {screen.label}
          </span>
          {isActive && <motion.span layoutId="tab-active" className="absolute bottom-1 h-1 w-1 rounded-full bg-foreground" />}
        </>
      )}
    </NavLink>
  );
}
