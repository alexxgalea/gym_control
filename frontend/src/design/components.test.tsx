import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inbox } from "lucide-react";
import { useState } from "react";
import { Button } from "@/design/button";
import { ConfirmDialog } from "@/design/ConfirmDialog";
import { EmptyState } from "@/design/EmptyState";
import { ScreenHeader } from "@/design/ScreenHeader";
import { Sheet } from "@/design/Sheet";
import { Skeleton } from "@/design/Skeleton";
import { StatusBadge } from "@/design/StatusBadge";

function SheetExample() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Adaugă</Button>
      <Sheet open={open} onOpenChange={setOpen} title="Angajat nou" description="Completează datele Angajatului.">
        <label>
          Nume
          <input />
        </label>
      </Sheet>
    </>
  );
}

describe("foaia", () => {
  it("se deschide ca dialog cu titlu și explicație, și se închide cu Anulează sau Escape", async () => {
    const user = userEvent.setup();
    render(<SheetExample />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Adaugă" }));
    const dialog = await screen.findByRole("dialog", { name: "Angajat nou" });
    expect(dialog).toHaveAccessibleDescription("Completează datele Angajatului.");
    expect(screen.getByLabelText("Nume")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Anulează" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Adaugă" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("dialogul de confirmare", () => {
  function ConfirmExample({ onConfirm }: { onConfirm: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Scoți telefonul din uz?"
        description="Angajatul nu va mai putea face Intrare până la o nouă Activare telefon."
        confirmLabel="Scoate din uz"
        destructive
        onConfirm={onConfirm}
      />
    );
  }

  it("cere confirmarea și o execută doar la butonul de confirmare", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmExample onConfirm={onConfirm} />);

    const dialog = await screen.findByRole("alertdialog", { name: "Scoți telefonul din uz?" });
    expect(dialog).toHaveAccessibleDescription(/nu va mai putea face Intrare/);
    expect(onConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Scoate din uz" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("nu execută nimic la Anulează", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmExample onConfirm={onConfirm} />);

    await user.click(await screen.findByRole("button", { name: "Anulează" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("piesele de ecran", () => {
  it("antetul arată titlul mare și explicația de un rând", () => {
    render(<ScreenHeader title="Jurnal" description="Toate evenimentele din Sală, de la cele mai noi." />);
    expect(screen.getByRole("heading", { level: 1, name: "Jurnal" })).toBeInTheDocument();
    expect(screen.getByText("Toate evenimentele din Sală, de la cele mai noi.")).toBeInTheDocument();
  });

  it("starea goală are o iconiță și o propoziție", () => {
    render(<EmptyState icon={Inbox} text="Nicio Anomalie de verificat" />);
    expect(screen.getByText("Nicio Anomalie de verificat")).toBeInTheDocument();
  });

  it("scheletul de încărcare anunță cititoarele de ecran că se încarcă", () => {
    render(<Skeleton rows={3} />);
    expect(screen.getByRole("status", { name: "Se încarcă" })).toHaveAttribute("aria-busy", "true");
  });

  it("eticheta de stare arată textul stării", () => {
    render(<StatusBadge tone="success">Telefon activat</StatusBadge>);
    expect(screen.getByText("Telefon activat")).toBeInTheDocument();
  });
});
