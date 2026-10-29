import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { adminApi, type DoorActivationLink } from "@/api/client";
import { ErrorAlert } from "@/components/ErrorAlert";
import { Button } from "@/design/button";
import { ConfirmDialog } from "@/design/ConfirmDialog";
import { ScreenHeader } from "@/design/ScreenHeader";
import { Sheet } from "@/design/Sheet";
import { Skeleton } from "@/design/Skeleton";
import { StatusBadge } from "@/design/StatusBadge";
import { errorText, isShownError } from "@/lib/errors";
import { formatLocalDateTime } from "@/lib/format";

const DOOR_SCREEN_KEY = ["admin", "door-screen"] as const;

/** „Ecranul de la ușă”: starea și Activarea (link cu QR, de unică folosință, pentru telefonul de la ușă). */
export function DoorScreen() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: DOOR_SCREEN_KEY, queryFn: adminApi.doorScreen.status });
  const [issued, setIssued] = useState<DoorActivationLink | null>(null);
  const issue = useMutation({
    mutationFn: adminApi.doorScreen.activationLink,
    onSuccess: setIssued,
  });

  const [retiring, setRetiring] = useState(false);
  const retire = useMutation({
    mutationFn: adminApi.doorScreen.retire,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: DOOR_SCREEN_KEY });
      setRetiring(false);
    },
    onError: () => setRetiring(false),
  });

  const close = () => {
    setIssued(null);
    void queryClient.invalidateQueries({ queryKey: DOOR_SCREEN_KEY });
  };

  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader
        title="Ecranul de la ușă"
        description="Telefonul de la ușă afișează codul QR pentru Intrare și Ieșire."
      />
      {status.isPending && <Skeleton rows={2} />}
      {status.isError && isShownError(status.error) && <ErrorAlert>{errorText(status.error)}</ErrorAlert>}
      {status.data && (
        <section className="flex flex-col items-start gap-4 rounded-2xl bg-card p-5">
          {status.data.active ? (
            <>
              <StatusBadge tone="success">Activ</StatusBadge>
              <p>
                Activ din {status.data.activated_at && formatLocalDateTime(status.data.activated_at, status.data.timezone)}
              </p>
            </>
          ) : (
            <StatusBadge>Neactivat</StatusBadge>
          )}
          <p className="text-sm text-muted-foreground">
            O nouă Activare scoate din uz telefonul de la ușă de până acum. Activarea cere rețeaua Sălii.
          </p>
          {issue.isError && <ErrorAlert>{errorText(issue.error)}</ErrorAlert>}
          {retire.isError && <ErrorAlert>{errorText(retire.error)}</ErrorAlert>}
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
              Activează
            </Button>
            {status.data.active && (
              <Button variant="outline" onClick={() => setRetiring(true)}>
                Scoate din uz
              </Button>
            )}
          </div>
        </section>
      )}
      <ConfirmDialog
        open={retiring}
        onOpenChange={setRetiring}
        title="Scoți din uz Ecranul de la ușă?"
        description="Telefonul de la ușă nu va mai afișa codul QR, iar aplicația rămâne fără Ecran de la ușă până la o nouă Activare. Folosește asta dacă telefonul e pierdut sau furat."
        confirmLabel="Scoate din uz"
        destructive
        pending={retire.isPending}
        onConfirm={() => retire.mutate()}
      />
      <LinkSheet link={issued} onClose={close} />
    </div>
  );
}

function LinkSheet({ link, onClose }: { link: DoorActivationLink | null; onClose: () => void }) {
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const close = () => {
    setCopied(null);
    onClose();
  };
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.link);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <Sheet
      open={link !== null}
      onOpenChange={(open) => !open && close()}
      title="Activare Ecran de la ușă"
      description="Scanează codul QR cu telefonul de la ușă."
    >
      {link && (
        <div className="flex flex-col items-center gap-4">
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(link.qr_svg)}`}
            alt="Cod QR de activare pentru Ecranul de la ușă"
            className="size-64 max-w-full rounded-2xl bg-white p-3"
          />
          <p className="text-center text-sm text-muted-foreground">
            Linkul expiră în {link.hours} de ore și merge o singură dată
          </p>
          <Button variant="outline" onClick={copy}>
            {copied === "ok" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}{" "}
            Copiază linkul
          </Button>
          {copied === "ok" && <p role="status">Link copiat</p>}
          {copied === "failed" && (
            <ErrorAlert>Nu s-a putut copia linkul. Cere un link nou și încearcă din nou.</ErrorAlert>
          )}
          <Button onClick={close}>Gata</Button>
        </div>
      )}
    </Sheet>
  );
}
