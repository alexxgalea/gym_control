import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { adminApi } from "@/api/client";
import { ME_KEY, useMe } from "@/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Ecranele din navigarea laterală, în ordinea afișării. */
export const SCREENS = [
  { path: "employees", label: "Angajați" },
  { path: "journal", label: "Jurnal" },
  { path: "anomalies", label: "Anomalii" },
  { path: "incidents", label: "Incidente" },
  { path: "reports", label: "Rapoarte" },
  { path: "settings", label: "Setări" },
] as const;

export function Shell() {
  const me = useMe();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: adminApi.logout,
    onSuccess: () => queryClient.setQueryData(ME_KEY, null),
  });

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col gap-6 border-r border-border bg-card p-4">
        <strong className="px-2 text-lg">Gym Control</strong>
        <nav className="flex flex-col gap-1">
          {SCREENS.map((screen) => (
            <NavLink
              key={screen.path}
              to={`/${screen.path}`}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-2 text-sm font-medium hover:bg-muted",
                  isActive && "bg-muted text-primary",
                )
              }
            >
              {screen.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
          <span className="px-2 text-sm text-muted-foreground">{me.data?.username}</span>
          <Button variant="outline" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut className="size-4" aria-hidden /> Ieșire cont
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">
        <Outlet />
      </main>
    </div>
  );
}
