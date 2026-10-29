import type { ReactNode } from "react";

/** Caseta de eroare a ecranelor (mesajul vine de la server sau din `errorText`). */
export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {children}
    </p>
  );
}
