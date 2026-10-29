import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  House,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShieldAlert,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { adminApi } from "@/api/client";
import { ME_KEY, useMe } from "@/auth";
import { ToastProvider } from "@/components/toast";
import { Button } from "@/design/button";
import { Logo } from "@/design/Logo";
import { ThemeSwitch } from "@/design/ThemeSwitch";
import { cn } from "@/lib/utils";

/** „Acasă” duce la ruta de pornire (deocamdată redirecționarea către Angajați). */
const HOME = { path: "", label: "Acasă", icon: House } as const;

/** Ecranele din meniu, în ordinea afișării. */
export const SCREENS: readonly { path: string; label: string; icon: LucideIcon }[] = [
  { path: "employees", label: "Angajați", icon: Users },
  { path: "journal", label: "Jurnal", icon: ScrollText },
  { path: "anomalies", label: "Anomalii", icon: TriangleAlert },
  { path: "incidents", label: "Incidente", icon: ShieldAlert },
  { path: "reports", label: "Raport de prezență", icon: FileText },
  { path: "settings", label: "Setări", icon: Settings },
];

export function Shell() {
  const me = useMe();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: adminApi.logout,
    onSuccess: () => queryClient.setQueryData(ME_KEY, null),
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();

  // orice navigare închide meniul
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-8">
          <Logo />
          <Button
            ref={buttonRef}
            variant="outline"
            size="sm"
            aria-expanded={menuOpen}
            aria-controls="meniu-principal"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Menu className="size-4" aria-hidden /> Meniu
          </Button>
        </div>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              id="meniu-principal"
              ref={menuRef}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full right-2 left-2 mt-2 flex max-h-[calc(100dvh-5rem)] flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-card p-3 shadow-sheet sm:right-8 sm:left-auto sm:w-80"
            >
              <nav aria-label="Meniu principal" className="flex flex-col gap-0.5">
                {[HOME, ...SCREENS].map((item) => (
                  <NavLink
                    key={item.path}
                    to={`/${item.path}`}
                    end={item.path === ""}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium hover:bg-muted",
                        isActive && "bg-muted text-primary",
                      )
                    }
                  >
                    <item.icon className="size-5" aria-hidden />
                    {item.label}
                  </NavLink>
                ))}
              </nav>
              <div className="flex flex-col gap-3 border-t border-border pt-3">
                <span className="px-3 text-sm text-muted-foreground">{me.data?.username}</span>
                <ThemeSwitch />
                <Button variant="outline" onClick={() => logout.mutate()} disabled={logout.isPending}>
                  <LogOut className="size-4" aria-hidden /> Deconectare
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>
      <main className="mx-auto min-w-0 max-w-6xl p-4 sm:p-8">
        <ToastProvider>
          <Outlet />
        </ToastProvider>
      </main>
    </div>
  );
}
