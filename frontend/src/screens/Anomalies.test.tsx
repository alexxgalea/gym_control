import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

// „azi” și „ieri” depind de ceas: îl fixăm (doar Date) la 6 ian. 2026, 12:00 în ora Sălii
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-06T10:00:00Z") }));
afterEach(() => vi.useRealTimers());

type Row = {
  id: number;
  session_id: number;
  code: string;
  label: string;
  employee_name: string;
  at: string;
  entry_at: string;
  exit_at: string | null;
  timezone: string;
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
  employee_name: "Ana Pop", at: "2026-01-05 23:30", entry_at: "2026-01-05 23:30", exit_at: "2026-01-06 01:00", timezone: "Europe/Bucharest",
};
const missing: Row = {
  id: 2, session_id: 11, code: "missing_exit", label: "Ieșire lipsă",
  employee_name: "Ion Vasile", at: "2026-01-06 10:12", entry_at: "2026-01-05 10:12", exit_at: null, timezone: "Europe/Bucharest",
};
const closing: Row = {
  id: 3, session_id: 12, code: "open_at_closing", label: "Sesiune deschisă la ora de închidere",
  employee_name: "Maria Dinu", at: "2026-01-05 22:00", entry_at: "2026-01-05 10:00", exit_at: null, timezone: "Europe/Bucharest",
};

const rowOf = async (name: string) => within((await screen.findByText(name)).closest("li")!);

describe("ecranul Anomalii", () => {
  it("arată încărcarea, apoi Anomaliile cu etichete românești și ore locale", async () => {
    mockApi([outside, missing, closing], { listDelay: 20 });
    renderApp("/anomalies");
    expect(await screen.findByRole("status", { name: "Se încarcă" })).toBeInTheDocument();
    const ana = await rowOf("Ana Pop");
    expect(ana.getByText("Intrare în afara programului")).toBeInTheDocument();
    expect(ana.getByText("ieri, 23:30")).toBeInTheDocument();
    expect(screen.queryByText(/2026-01-05/)).not.toBeInTheDocument(); // fără date în format brut
    expect((await rowOf("Ion Vasile")).getByText("Ieșire lipsă")).toBeInTheDocument();
    expect((await rowOf("Maria Dinu")).getByText("Sesiune deschisă la ora de închidere")).toBeInTheDocument();
  });

  it("oferă Completează Ieșirea doar Sesiunilor deschise și Marchează verificată doar pentru outside_hours", async () => {
    mockApi([outside, missing, closing]);
    renderApp("/anomalies");
    const ana = await rowOf("Ana Pop");
    expect(ana.queryByRole("button", { name: "Completează Ieșirea" })).not.toBeInTheDocument();
    expect(ana.getByRole("button", { name: "Marchează verificată" })).toBeInTheDocument();
    const ion = await rowOf("Ion Vasile");
    expect(ion.getByRole("button", { name: "Completează Ieșirea" })).toBeInTheDocument();
    expect(ion.queryByRole("button", { name: "Marchează verificată" })).not.toBeInTheDocument();
    expect((await rowOf("Maria Dinu")).getByRole("button", { name: "Completează Ieșirea" })).toBeInTheDocument();
  });

  it("are antet cu explicație de un rând", async () => {
    mockApi([]);
    renderApp("/anomalies");
    expect(await screen.findByRole("heading", { name: "Anomalii" })).toBeInTheDocument();
    expect(screen.getByText(/Situații care cer verificarea ta/)).toBeInTheDocument();
  });

  it("arată starea de listă goală", async () => {
    mockApi([]);
    renderApp("/anomalies");
    expect(await screen.findByText("Nicio Anomalie de verificat")).toBeInTheDocument();
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
    expect(await screen.findByRole("button", { name: "Intră în cont" })).toBeInTheDocument();
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

    await waitFor(() => expect(screen.queryByText("Ana Pop")).not.toBeInTheDocument());
    expect(calls).toEqual(["dismiss 1"]);
    expect(screen.getByRole("status")).toHaveTextContent("Anomalie marcată verificată");
    expect(screen.getByText("Ion Vasile")).toBeInTheDocument();
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

  it("Completează Ieșirea: foaia cere motiv, apoi Anomalia dispare din listă", async () => {
    const posts: unknown[] = [];
    let done = false;
    mockApi([closing]);
    server.use(
      http.get("/api/admin/anomalies", () => HttpResponse.json(done ? [] : [closing])),
      http.post("/api/admin/sessions/:id/correct", async ({ request }) => {
        const body = (await request.json()) as { reason: string };
        posts.push(body);
        if (!body.reason) return HttpResponse.json({ detail: "Motivul este obligatoriu.", field: "reason" }, { status: 400 });
        done = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp("/anomalies");
    await user.click((await rowOf("Maria Dinu")).getByRole("button", { name: "Completează Ieșirea" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Completează Ieșirea" }));
    fireEvent.change(sheet.getByLabelText("Ieșire"), { target: { value: "2026-01-05T22:00" } });
    await user.click(sheet.getByRole("button", { name: "Salvează Ieșirea" }));
    expect(await sheet.findByLabelText("Motiv")).toHaveAccessibleDescription("Motivul este obligatoriu.");
    expect(screen.getByText("Maria Dinu")).toBeInTheDocument();

    await user.type(sheet.getByLabelText("Motiv"), "Uitat să iasă");
    await user.click(sheet.getByRole("button", { name: "Salvează Ieșirea" }));
    expect(await screen.findByText("Nicio Anomalie de verificat")).toBeInTheDocument();
    expect(posts).toHaveLength(2);
  });
});
