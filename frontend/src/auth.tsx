import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet } from "react-router-dom";
import { adminApi } from "@/api/client";
import { Skeleton } from "@/design/Skeleton";

export const ME_KEY = ["admin", "me"] as const;

export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: adminApi.me });
}

/** Ecranele din interior cer sesiune; fără ea (401) se merge la login. */
export function RequireAuth() {
  const me = useMe();
  if (me.isPending) return <div className="p-8"><Skeleton /></div>;
  if (!me.data) return <Navigate to="/login" replace />;
  return <Outlet />;
}
