import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleCheck, LinkIcon } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/design/button";
import { EmptyState } from "@/design/EmptyState";
import { Logo } from "@/design/Logo";
import { ScreenHeader } from "@/design/ScreenHeader";
import { Skeleton } from "@/design/Skeleton";
import { EmployeeApiError, employeeApi } from "@/employee/api";

const isLinkInvalid = (error: unknown) => error instanceof EmployeeApiError && error.reason === "link_invalid";

function InvalidLink() {
  return (
    <EmptyState icon={LinkIcon} text="Linkul a fost deja folosit, a expirat sau nu există. Cere Adminului un link nou." />
  );
}

/** `/enroll/{token}`: Activare telefon. Deschiderea linkului nu îl consumă; doar butonul activează telefonul. */
export function Enroll() {
  const { token = "" } = useParams();
  const link = useQuery({
    queryKey: ["employee", "enroll", token],
    queryFn: () => employeeApi.enrollmentLink(token),
    retry: false,
  });
  const activate = useMutation({ mutationFn: () => employeeApi.activatePhone(token) });

  let body;
  if (isLinkInvalid(link.error) || isLinkInvalid(activate.error)) {
    body = <InvalidLink />;
  } else if (link.error) {
    body = (
      <p role="alert" className="rounded-2xl bg-destructive/10 p-4 text-[15px] text-destructive">
        {link.error.message}
      </p>
    );
  } else if (activate.isSuccess) {
    body = (
      <section className="flex flex-col items-center gap-3 rounded-2xl bg-card p-6 text-center">
        <CircleCheck className="size-14 text-success" aria-hidden />
        <p className="text-xl font-semibold">Telefonul tău este activat</p>
        <p className="text-[15px] text-muted-foreground">Scanează codul de la ușă ca să faci Intrare</p>
      </section>
    );
  } else if (link.data) {
    body = (
      <section className="flex flex-col gap-5 rounded-2xl bg-card p-5">
        <div>
          <p className="text-[15px] text-muted-foreground">Activezi telefonul pentru</p>
          <p className="text-2xl font-semibold">{link.data.name}</p>
        </div>
        <p className="text-[15px] text-muted-foreground">
          Un telefon activat anterior nu va mai funcționa.
        </p>
        {activate.error && (
          <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-[15px] text-destructive">
            {activate.error.message}
          </p>
        )}
        <Button size="lg" disabled={activate.isPending} onClick={() => activate.mutate()}>
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
      <ScreenHeader title="Activare telefon" description="Activează telefonul ca să poți face Intrare și Ieșire." />
      {body}
    </main>
  );
}
