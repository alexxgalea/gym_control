import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

type Row = { id: number; name: string; email: string; enrolled: boolean };

/** API-ul Angajaților simulat, cu stare, la granița HTTP. */
function mockApi(initial: Row[] = [], options: { listDelay?: number } = {}) {
  const rows = [...initial];
  const calls: { method: string; path: string; body?: unknown }[] = [];
  server.use(
    http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
    http.get("/api/admin/employees", async () => {
      if (options.listDelay) await delay(options.listDelay);
      return HttpResponse.json(rows);
    }),
    http.post("/api/admin/employees", async ({ request }) => {
      const body = (await request.json()) as { name: string; email: string };
      calls.push({ method: "POST", path: "/api/admin/employees", body });
      if (!body.name.trim()) return HttpResponse.json({ detail: "Numele lipsește", field: "name" }, { status: 400 });
      if (!body.email.includes("@")) return HttpResponse.json({ detail: "Email invalid", field: "email" }, { status: 400 });
      const row = { id: rows.length + 1, name: body.name, email: body.email, enrolled: false };
      rows.push(row);
      return HttpResponse.json(row, { status: 201 });
    }),
    http.post("/api/admin/employees/:id/enroll-link", ({ params }) => {
      calls.push({ method: "POST", path: `/api/admin/employees/${params.id}/enroll-link` });
      const row = rows.find((r) => r.id === Number(params.id));
      if (!row) return HttpResponse.json({ detail: "Angajat inexistent" }, { status: 404 });
      return HttpResponse.json({ name: row.name, link: "http://localhost/enroll/tok123", hours: 48 });
    }),
    http.post("/api/admin/employees/:id/revoke", ({ params }) => {
      calls.push({ method: "POST", path: `/api/admin/employees/${params.id}/revoke` });
      const row = rows.find((r) => r.id === Number(params.id))!;
      row.enrolled = false;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

const ana: Row = { id: 1, name: "Ana Pop", email: "ana@firma.ro", enrolled: true };
const ion: Row = { id: 2, name: "Ion Vasile", email: "ion@firma.ro", enrolled: false };

/** Rândul din tabel al unui Angajat (așteaptă încărcarea listei). */
async function rowOf(name: string) {
  return within(await screen.findByRole("row", { name: new RegExp(name) }));
}

describe("ecranul Angajați", () => {
  it("arată stare de încărcare, apoi tabelul cu starea dispozitivului și acțiunile potrivite", async () => {
    mockApi([ana, ion], { listDelay: 20 });
    renderApp("/employees");

    expect(await screen.findByText("Se încarcă…")).toBeInTheDocument();
    expect(await screen.findByText("Ana Pop")).toBeInTheDocument();
    expect((await rowOf("Ana Pop")).getByText("ana@firma.ro")).toBeInTheDocument();
    expect((await rowOf("Ana Pop")).getByText("Înrolat")).toBeInTheDocument();
    expect((await rowOf("Ana Pop")).getByRole("button", { name: "Re-înrolează" })).toBeInTheDocument();
    expect((await rowOf("Ana Pop")).getByRole("button", { name: "Revocă" })).toBeInTheDocument();
    expect((await rowOf("Ion Vasile")).getByText("Neînrolat")).toBeInTheDocument();
    expect((await rowOf("Ion Vasile")).getByRole("button", { name: "Generează link" })).toBeInTheDocument();
    expect((await rowOf("Ion Vasile")).queryByRole("button", { name: "Revocă" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Angajați/ })).toBeInTheDocument();
  });

  it("arată starea de listă goală", async () => {
    mockApi([]);
    renderApp("/employees");
    expect(await screen.findByText("Niciun Angajat încă.")).toBeInTheDocument();
  });

  it("arată eroarea când lista nu se poate încărca", async () => {
    server.use(
      http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
      http.get("/api/admin/employees", () => HttpResponse.json({ detail: "Eroare internă." }, { status: 500 })),
    );
    renderApp("/employees");
    expect(await screen.findByRole("alert")).toHaveTextContent("Eroare internă.");
  });

  it("duce la login când lista primește 401", async () => {
    server.use(
      http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
      http.get("/api/admin/employees", () => HttpResponse.json({ detail: "Sesiune lipsă sau expirată." }, { status: 401 })),
    );
    renderApp("/employees");
    expect(await screen.findByRole("button", { name: "Intră în cont" })).toBeInTheDocument();
  });

  it("adaugă un Angajat dintr-un dialog, îl arată în listă și confirmă cu toast", async () => {
    const calls = mockApi([ana]);
    const user = userEvent.setup();
    renderApp("/employees");
    await user.click(await screen.findByRole("button", { name: "Adaugă Angajat" }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Nume"), "Maria Dinu");
    await user.type(within(dialog).getByLabelText("Email"), "maria@firma.ro");
    await user.click(within(dialog).getByRole("button", { name: "Adaugă" }));

    expect(await screen.findByText("maria@firma.ro")).toBeInTheDocument();
    expect(calls).toEqual([
      { method: "POST", path: "/api/admin/employees", body: { name: "Maria Dinu", email: "maria@firma.ro" } },
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Angajat adăugat");
  });

  it("arată eroarea serverului lângă câmpul vizat și păstrează ce a scris Adminul", async () => {
    mockApi([]);
    const user = userEvent.setup();
    renderApp("/employees");
    await user.click(await screen.findByRole("button", { name: "Adaugă Angajat" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Nume"), "Maria Dinu");
    await user.type(within(dialog).getByLabelText("Email"), "nu-e-email");
    await user.click(within(dialog).getByRole("button", { name: "Adaugă" }));

    const email = within(dialog).getByLabelText("Email");
    await waitFor(() => expect(email).toHaveAccessibleDescription("Email invalid"));
    expect(within(dialog).getByLabelText("Nume")).not.toHaveAccessibleDescription("Numele lipsește");
    expect(within(dialog).getByLabelText("Nume")).toHaveValue("Maria Dinu");
    expect(email).toHaveValue("nu-e-email");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText("Nume"));
    await user.clear(email);
    await user.type(email, "maria@firma.ro");
    await user.click(within(dialog).getByRole("button", { name: "Adaugă" }));
    await waitFor(() => expect(within(dialog).getByLabelText("Nume")).toHaveAccessibleDescription("Numele lipsește"));
  });

  it("generează linkul de înrolare, îl arată cu valabilitatea și îl copiază dintr-un click", async () => {
    const calls = mockApi([ion]);
    const user = userEvent.setup();
    renderApp("/employees");
    await user.click((await rowOf("Ion Vasile")).getByRole("button", { name: "Generează link" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Link de înrolare pentru Ion Vasile/)).toBeInTheDocument();
    expect(within(dialog).getByText(/48 de ore/)).toBeInTheDocument();
    expect(within(dialog).getByText("http://localhost/enroll/tok123")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Copiază linkul" }));
    expect(await navigator.clipboard.readText()).toBe("http://localhost/enroll/tok123");
    expect(await screen.findByRole("status")).toHaveTextContent("Link copiat");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls).toEqual([{ method: "POST", path: "/api/admin/employees/2/enroll-link" }]);
  });

  it("arată eroarea serverului când Angajatul nu mai există", async () => {
    mockApi([ion]);
    const user = userEvent.setup();
    renderApp("/employees");
    // un alt Admin l-a șters între timp: simulăm prin id necunoscut în server
    server.use(
      http.post("/api/admin/employees/:id/enroll-link", () =>
        HttpResponse.json({ detail: "Angajat inexistent" }, { status: 404 }),
      ),
    );
    await user.click((await rowOf("Ion Vasile")).getByRole("button", { name: "Generează link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Angajat inexistent");
  });

  it("revocă doar după confirmare explicită; anularea nu face nimic", async () => {
    const calls = mockApi([ana]);
    const user = userEvent.setup();
    renderApp("/employees");
    await user.click((await rowOf("Ana Pop")).getByRole("button", { name: "Revocă" }));

    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Ana Pop");
    await user.click(within(dialog).getByRole("button", { name: "Anulează" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(calls).toEqual([]);
    expect((await rowOf("Ana Pop")).getByText("Înrolat")).toBeInTheDocument();

    await user.click((await rowOf("Ana Pop")).getByRole("button", { name: "Revocă" }));
    dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Revocă dispozitivul" }));

    await waitFor(async () => expect((await rowOf("Ana Pop")).getByText("Neînrolat")).toBeInTheDocument());
    expect(calls).toEqual([{ method: "POST", path: "/api/admin/employees/1/revoke" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Dispozitiv revocat");
  });
});
