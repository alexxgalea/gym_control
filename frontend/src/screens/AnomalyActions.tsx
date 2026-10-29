import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { adminApi, type Anomaly } from "@/api/client";
import { useToast } from "@/components/toast";
import { Button } from "@/design/button";
import { ConfirmDialog } from "@/design/ConfirmDialog";
import { errorText } from "@/lib/errors";
import { ANOMALIES_KEY, JOURNAL_KEY } from "@/lib/queryKeys";
import { CorrectSessionDialog } from "@/screens/ManualSession";

/** O Sesiune rămasă fără Ieșire se rezolvă cu „Completează Ieșirea”. */
export const needsExit = (anomaly: Anomaly) => anomaly.exit_at === null;

/** Doar `outside_hours` se închide cu „verificată”; celelalte se rezolvă prin Ieșire/corectare. */
export const isDismissible = (anomaly: Anomaly) => anomaly.code === "outside_hours";

/**
 * Acțiunile unei Anomalii: „Completează Ieșirea” (foaie de corectare) și „Marchează verificată” (cu confirmare).
 * Componentă reutilizabilă: o folosesc ecranul Anomalii și pagina de gestiune.
 */
export function AnomalyActions({ anomaly }: { anomaly: Anomaly }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [completing, setCompleting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ANOMALIES_KEY }),
      queryClient.invalidateQueries({ queryKey: JOURNAL_KEY }),
    ]);
  const dismiss = useMutation({
    mutationFn: () => adminApi.anomalies.dismiss(anomaly.id),
    onSuccess: async () => {
      setConfirming(false);
      toast("Anomalie marcată verificată");
      await refresh();
    },
    onError: async (error) => {
      setConfirming(false);
      toast(errorText(error), "error");
      await refresh();
    },
  });

  return (
    <>
      {needsExit(anomaly) && (
        <Button size="sm" onClick={() => setCompleting(true)}>
          Completează Ieșirea
        </Button>
      )}
      {isDismissible(anomaly) && (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
          Marchează verificată
        </Button>
      )}
      <CorrectSessionDialog anomaly={completing ? anomaly : null} onClose={() => setCompleting(false)} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Marchezi Anomalia ca verificată?"
        description={`${anomaly.label}: ${anomaly.employee_name}. Închiderea apare în Jurnal, cu numele tău.`}
        confirmLabel="Marchează verificată"
        pending={dismiss.isPending}
        onConfirm={() => dismiss.mutate()}
      />
    </>
  );
}
