import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Plus } from "lucide-react";
import { useState } from "react";
import { adminApi, type Anomaly } from "@/api/client";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/design/button";
import { EmptyState } from "@/design/EmptyState";
import { ScreenHeader } from "@/design/ScreenHeader";
import { Skeleton } from "@/design/Skeleton";
import { StatusBadge } from "@/design/StatusBadge";
import { isShownError } from "@/lib/errors";
import { formatLocalDateTime } from "@/lib/format";
import { ANOMALIES_KEY } from "@/lib/queryKeys";
import { AnomalyActions } from "@/screens/AnomalyActions";
import { AddSessionDialog } from "@/screens/ManualSession";

export function Anomalies() {
  const anomalies = useQuery({ queryKey: ANOMALIES_KEY, queryFn: adminApi.anomalies.list });
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader
        title="Anomalii"
        description="Situații care cer verificarea ta. Rezolvă-le aici, iar ele dispar din listă."
        actions={
          <Button variant="outline" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden /> Sesiune manuală nouă
          </Button>
        }
      />

      {anomalies.isPending && <Skeleton rows={3} />}
      {isShownError(anomalies.error) && <ErrorAlert>{anomalies.error.detail}</ErrorAlert>}
      {anomalies.data && anomalies.data.length === 0 && (
        <EmptyState icon={CheckCircle2} text="Nicio Anomalie de verificat" />
      )}
      {anomalies.data && anomalies.data.length > 0 && (
        <ul className="flex flex-col gap-3">
          {anomalies.data.map((anomaly) => (
            <AnomalyRow key={anomaly.id} anomaly={anomaly} />
          ))}
        </ul>
      )}

      <AddSessionDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

/** Un rând-card: se așază pe verticală pe telefon și pe orizontală pe ecrane late, fără tabele tăiate. */
function AnomalyRow({ anomaly }: { anomaly: Anomaly }) {
  const when = (local: string) => formatLocalDateTime(local, anomaly.timezone);
  return (
    <li className="flex flex-col gap-3 rounded-2xl bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold">{anomaly.employee_name}</span>
          <StatusBadge tone="warning">{anomaly.label}</StatusBadge>
        </div>
        <p className="text-sm text-muted-foreground">
          <time>{when(anomaly.at)}</time>
          {anomaly.entry_at !== anomaly.at && <> · Intrare {when(anomaly.entry_at)}</>}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <AnomalyActions anomaly={anomaly} />
      </div>
    </li>
  );
}
