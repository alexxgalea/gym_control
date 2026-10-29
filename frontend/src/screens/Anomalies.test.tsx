import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

type Row = {
  id: number;
  session_id: number;
  code: string;
  label: string;
  employee_name: string;
  at: string;
  entry_at: string;
  exit_at: string | null;
};

/** API-ul Anomaliilor simulat, cu stare, la granița HTTP. */
function mockApi(initial: Row[] = [], options: { listDelay?: number; dismissError?: number } = {}) {
  let rows = [...initial];
  const calls: string[] = [];
  server.use(
    http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
    http.get("/api/admin/anomalies", async () => {
      if (options.listDelay) await delay(options.listDelay);
      return HttpResponse.json(rows);
    }),
    http.post("/api/admin/anomalies/:id/dismiss", ({ params }) => {
      calls.push(`dismiss ${params.id}`);
      if (options.dismissError) {
        return HttpResponse.json({ detail: "Anomalie inexistentă sau deja rezolvată" }, { status: options.dismissError });
      }
      rows = rows.filter((r) => r.id !== Number(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

const outside: Row = {
  id: 1, session_id: 10, code: "outside_hours", label: "Intrare în afara programului",
  employee_name: "Ana Pop", at: "2026-01-05 23:30", entry_at: "2026-01-05 23:30", exit_at: "2026-01-06 01:00",
};
const missing: Row = {
  id: 2, session_id: 11, code: "missing_exit", label: "Ieșire lipsă",
  employee_name: "Ion Vasile", at: "2026-01-06 10:12", entry_at: "2026-01-05 10:12", exit_at: null,
};
const closing: Row = {
  id: 3, session_id: 12, code: "open_at_closing", label: "Sesiune deschisă la ora de închidere",
  employee_name: "Maria Dinu", at: "2026-01-05 22:00", entry_at: "2026-01-05 10:00", exit_at: null,
};

const rowOf = async (name: string) => within(await screen.findByRole("row", { name: new RegExp(name) }));

describe("ecranul Anomalii", () => {
  it("arată încărcarea, apoi Anomaliile cu etichete românești și ore locale", async () => {
    mockApi([outside, missing, closing], { listDelay: 20 });
    renderApp("/anomalies");
    expect(await screen.findByText("Se încarcă…")).toBeInTheDocument();
    const ana = await rowOf("Ana Pop");
    expect(ana.getByText("Intrare în afara programului")).toBeInTheDocument();
    expect(ana.getAllByText("2026-01-05 23:30")).toHaveLength(2);
    expect((await rowOf("Ion Vasile")).getByText("Ieșire lipsă")).toBeInTheDocument();
    expect((await rowOf("Maria Dinu")).getByText("Sesiune deschisă la ora de închidere")).toBeInTheDocument();
  });

  it("oferă Corectează doar Sesiunilor deschise (spre ecranul HTML) și Marchează verificată doar pentru outside_hours", async () => {
    mockApi([outside, missing, closing]);
    renderApp("/anomalies");
    const ana = await rowOf("Ana Pop");
    expect(ana.queryByRole("link", { name: "Corectează" })).not.toBeInTheDocument();
    expect(ana.getByRole("button", { name: "Marchează verificată" })).toBeInTheDocument();
    const ion = await rowOf("Ion Vasile");
    expect(ion.getByRole("link", { name: "Corectează" })).toHaveAttribute("href", "/admin/sessions/11/correct");
    expect(ion.queryByRole("button", { name: "Marchează verificată" })).not.toBeInTheDocument();
    expect((await rowOf("Maria Dinu")).getByRole("link", { name: "Corectează" })).toHaveAttribute(
      "href",
      "/admin/sessions/12/correct",
    );
  });

  it("trimite spre Sesiune manuală nouă (ecran încă pe HTML)", async () => {
    mockApi([]);
    renderApp("/anomalies");
    expect(await screen.findByRole("link", { name: "Sesiune manuală nouă" })).toHaveAttribute(
      "href",
      "/admin/sessions/new",
    );
  });

  it("arată starea de listă goală", async () => {
    mockApi([]);
    renderApp("/anomalies");
    expect(await screen.findByText("Nu există Anomalii.")).toBeInTheDocument();
  });

  it("arată eroarea când lista nu se poate încărca", async () => {
    server.use(
      http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
      http.get("/api/admin/anomalies", () => HttpResponse.json({ detail: "Eroare internă." }, { status: 500 })),
    );
    renderApp("/anomalies");
    expect(await screen.findByRole("alert")).toHaveTextContent("Eroare internă.");
  });

  it("duce la login când lista primește 401", async () => {
    server.use(
      http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
      http.get("/api/admin/anomalies", () => HttpResponse.json({ detail: "Sesiune lipsă sau expirată." }, { status: 401 })),
    );
    renderApp("/anomalies");
    expect(await screen.findByRole("button", { name: "Intră" })).toBeInTheDocument();
  });

  it("închide o Anomalie doar după confirmare; anularea nu face nimic; apoi toast și rândul dispare", async () => {
    const calls = mockApi([outside, missing]);
    const user = userEvent.setup();
    renderApp("/anomalies");
    await user.click((await rowOf("Ana Pop")).getByRole("button", { name: "Marchează verificată" }));

    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Ana Pop");
    await user.click(within(dialog).getByRole("button", { name: "Anulează" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(calls).toEqual([]);

    await user.click((await rowOf("Ana Pop")).getByRole("button", { name: "Marchează verificată" }));
    dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Marchează verificată" }));

    await waitFor(() => expect(screen.queryByRole("row", { name: /Ana Pop/ })).not.toBeInTheDocument());
    expect(calls).toEqual(["dismiss 1"]);
    expect(screen.getByRole("status")).toHaveTextContent("Anomalie marcată verificată");
    expect(screen.getByRole("row", { name: /Ion Vasile/ })).toBeInTheDocument();
  });

  it("arată eroarea serverului când Anomalia e deja rezolvată", async () => {
    mockApi([outside], { dismissError: 404 });
    const user = userEvent.setup();
    renderApp("/anomalies");
    await user.click((await rowOf("Ana Pop")).getByRole("button", { name: "Marchează verificată" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Marchează verificată" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Anomalie inexistentă sau deja rezolvată");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
