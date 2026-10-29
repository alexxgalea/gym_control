import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet } from "react-router-dom";
import { adminApi } from "@/api/client";

export const ME_KEY = ["admin", "me"] as const;

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: adminApi.me });
}

/** Ecranele din interior cer sesiune; fără ea (401) se merge la login. */
export function RequireAuth() {
  const me = useMe();
  if (me.isPending) return <p className="p-8 text-muted-foreground">Se încarcă…</p>;
  if (!me.data) return <Navigate to="/login" replace />;
  return <Outlet />;
}
