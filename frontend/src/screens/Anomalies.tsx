import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, adminApi, type Anomaly } from "@/api/client";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { ANOMALIES_KEY } from "@/lib/queryKeys";
import { AddSessionDialog, CorrectSessionDialog } from "@/screens/ManualSession";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const GENERIC_ERROR = "A apărut o eroare. Încearcă din nou.";
const errorText = (error: unknown) => (error instanceof ApiError ? error.detail : GENERIC_ERROR);

/** Doar `outside_hours` se închide cu „verificată”; celelalte se rezolvă prin Ieșire/corectare. */
const isDismissible = (anomaly: Anomaly) => anomaly.code === "outside_hours";

export function Anomalies() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const anomalies = useQuery({ queryKey: ANOMALIES_KEY, queryFn: adminApi.anomalies.list });
  const [dismissing, setDismissing] = useState<Anomaly | null>(null);
  const [correcting, setCorrecting] = useState<Anomaly | null>(null);
  const [adding, setAdding] = useState(false);

  const dismiss = useMutation({
    mutationFn: (anomaly: Anomaly) => adminApi.anomalies.dismiss(anomaly.id),
    onSuccess: async () => {
      setDismissing(null);
      toast("Anomalie marcată verificată");
      await queryClient.invalidateQueries({ queryKey: ANOMALIES_KEY });
    },
    onError: async (error) => {
      setDismissing(null);
      toast(errorText(error), "error");
      await queryClient.invalidateQueries({ queryKey: ANOMALIES_KEY });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Anomalii</h1>
        <Button variant="outline" onClick={() => setAdding(true)}>
          Sesiune manuală nouă
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Situații care cer verificare umană. Orele sunt în ora locală.
      </p>

      {anomalies.isPending && <p className="text-muted-foreground">Se încarcă…</p>}
      {anomalies.isError && anomalies.error instanceof ApiError && anomalies.error.status !== 401 && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {anomalies.error.detail}
        </p>
      )}
      {anomalies.data && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Angajat</th>
                <th className="px-4 py-3 font-medium">Tip</th>
                <th className="px-4 py-3 font-medium">Moment</th>
                <th className="px-4 py-3 font-medium">Intrare</th>
                <th className="px-4 py-3 text-right font-medium">Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {anomalies.data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    Nu există Anomalii.
                  </td>
                </tr>
              )}
              {anomalies.data.map((anomaly) => (
                <tr key={anomaly.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium">{anomaly.employee_name}</td>
                  <td className="px-4 py-3">{anomaly.label}</td>
                  <td className="px-4 py-3">
                    <time>{anomaly.at}</time>
                  </td>
                  <td className="px-4 py-3">{anomaly.entry_at}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {anomaly.exit_at === null && (
                        <Button size="sm" variant="outline" onClick={() => setCorrecting(anomaly)}>
                          Corectează
                        </Button>
                      )}
                      {isDismissible(anomaly) && (
                        <Button size="sm" variant="outline" onClick={() => setDismissing(anomaly)}>
                          Marchează verificată
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddSessionDialog open={adding} onClose={() => setAdding(false)} />
      <CorrectSessionDialog anomaly={correcting} onClose={() => setCorrecting(null)} />
      <Dialog open={dismissing !== null} onOpenChange={(open) => !open && setDismissing(null)}>
        <DialogContent role="alertdialog">
          <DialogTitle>Marchezi Anomalia ca verificată?</DialogTitle>
          <DialogDescription>
            {dismissing?.label}: {dismissing?.employee_name}. Închiderea apare în Jurnal, cu numele tău.
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDismissing(null)}>
              Anulează
            </Button>
            <Button disabled={dismiss.isPending} onClick={() => dismissing && dismiss.mutate(dismissing)}>
              Marchează verificată
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
