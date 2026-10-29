import { useMutation, useQuery } from "@tanstack/react-query";
import { LinkIcon } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/design/button";
import { EmptyState } from "@/design/EmptyState";
import { Logo } from "@/design/Logo";
import { ScreenHeader } from "@/design/ScreenHeader";
import { Skeleton } from "@/design/Skeleton";
import { EmployeeApiError, employeeApi } from "@/employee/api";
import { goToDoor } from "@/employee/navigation";

const isLinkInvalid = (error: unknown) => error instanceof EmployeeApiError && error.reason === "link_invalid";

/** `/door/activate/{token}`: Activare Ecran de la ușă. Deschiderea linkului nu îl consumă; doar butonul îl consumă. */
export function DoorActivate() {
  const { token = "" } = useParams();
  const link = useQuery({
    queryKey: ["employee", "door-activate", token],
    queryFn: () => employeeApi.doorActivationLink(token),
    retry: false,
  });
  const activate = useMutation({ mutationFn: () => employeeApi.activateDoor(token), onSuccess: goToDoor });

  let body;
  if (isLinkInvalid(link.error) || isLinkInvalid(activate.error)) {
    body = (
      <EmptyState icon={LinkIcon} text="Linkul a fost deja folosit, a expirat sau nu există. Cere Adminului un link nou." />
    );
  } else if (link.error) {
    body = (
      <p role="alert" className="rounded-2xl bg-destructive/10 p-4 text-[15px] text-destructive">
        {link.error.message}
      </p>
    );
  } else if (link.data) {
    body = (
      <section className="flex flex-col gap-5 rounded-2xl bg-card p-5">
        <p className="text-2xl font-semibold">Activezi acest telefon ca Ecran de la ușă?</p>
        <p className="text-[15px] text-muted-foreground">Telefonul care era Ecranul de la ușă până acum nu va mai afișa codul.</p>
        {activate.error && (
          <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-[15px] text-destructive">
            {activate.error.message}
          </p>
        )}
        <Button size="lg" disabled={activate.isPending || activate.isSuccess} onClick={() => activate.mutate()}>
          Activează acest telefon
        </Button>
      </section>
    );
  } else {
    body = <Skeleton rows={2} />;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
      <Logo size={40} />
      <ScreenHeader title="Ecranul de la ușă" description="Telefonul activat afișează codul QR pentru Intrare și Ieșire." />
      {body}
    </main>
  );
}
