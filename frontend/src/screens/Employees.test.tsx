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
      return HttpResponse.json({ name: row.name, link: "http://localhost/enroll/tok123", qr_svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", hours: 48 });
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

/** Rândul din listă al unui Angajat (așteaptă încărcarea listei). */
async function rowOf(name: string) {
  const items = await screen.findAllByRole("listitem");
  return within(items.find((item) => item.textContent?.includes(name))!);
}

describe("ecranul Angajați", () => {
  it("arată antetul cu explicație, scheletul, apoi lista cu starea telefonului și acțiunile potrivite", async () => {
    mockApi([ana, ion], { listDelay: 20 });
    renderApp("/employees");

    expect(await screen.findByRole("heading", { name: "Angajați" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Se încarcă" })).toBeInTheDocument();
    expect(screen.getByText(/activezi telefonul/)).toBeInTheDocument();
    expect(await screen.findByText("Ana Pop")).toBeInTheDocument();
    expect((await rowOf("Ana Pop")).getByText("ana@firma.ro")).toBeInTheDocument();
    expect((await rowOf("Ana Pop")).getByText("Telefon activat")).toBeInTheDocument();
    expect((await rowOf("Ana Pop")).getByRole("button", { name: "Activează alt telefon" })).toBeInTheDocument();
    expect((await rowOf("Ana Pop")).getByRole("button", { name: "Scoate telefonul din uz" })).toBeInTheDocument();
    expect((await rowOf("Ion Vasile")).getByText("Telefon neactivat")).toBeInTheDocument();
    expect((await rowOf("Ion Vasile")).getByRole("button", { name: "Activează telefonul" })).toBeInTheDocument();
    expect((await rowOf("Ion Vasile")).queryByRole("button", { name: "Scoate telefonul din uz" })).not.toBeInTheDocument();
    expect(screen.queryByText(/dispozitiv|înrol/i)).not.toBeInTheDocument();
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

  it("după ce salvează un Angajat nou, continuă direct cu Activare telefon, cu QR, valabilitate și copiere", async () => {
    const calls = mockApi([ana]);
    const user = userEvent.setup();
    renderApp("/employees");
    await user.click(await screen.findByRole("button", { name: "Adaugă un Angajat nou" }));

    const sheet = await screen.findByRole("dialog", { name: "Angajat nou" });
    await user.type(within(sheet).getByLabelText("Nume"), "Maria Dinu");
    await user.type(within(sheet).getByLabelText("Email"), "maria@firma.ro");
    await user.click(within(sheet).getByRole("button", { name: "Salvează și activează telefonul" }));

    const activation = await screen.findByRole("dialog", { name: /Activare telefon pentru Maria Dinu/ });
    expect(within(activation).getByRole("img", { name: /Cod QR de activare pentru Maria Dinu/ })).toBeInTheDocument();
    expect(within(activation).getByText("Linkul expiră în 48 de ore și merge o singură dată")).toBeInTheDocument();
    expect(within(activation).queryByText(/enroll\/tok123/)).not.toBeInTheDocument(); // linkul nu apare ca text

    await user.click(within(activation).getByRole("button", { name: "Copiază linkul" }));
    expect(await navigator.clipboard.readText()).toBe("http://localhost/enroll/tok123");
    expect(await within(activation).findByRole("status")).toHaveTextContent("Link copiat");
    expect(calls).toEqual([
      { method: "POST", path: "/api/admin/employees", body: { name: "Maria Dinu", email: "maria@firma.ro" } },
      { method: "POST", path: "/api/admin/employees/2/enroll-link" },
    ]);
    expect(await screen.findByText("maria@firma.ro")).toBeInTheDocument(); // lista s-a reîncărcat
  });

  it("arată eroarea serverului lângă câmpul vizat și păstrează ce a scris Adminul", async () => {
    mockApi([]);
    const user = userEvent.setup();
    renderApp("/employees");
    await user.click(await screen.findByRole("button", { name: "Adaugă un Angajat nou" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("Nume"), "Maria Dinu");
    await user.type(within(dialog).getByLabelText("Email"), "nu-e-email");
    await user.click(within(dialog).getByRole("button", { name: "Salvează și activează telefonul" }));

    const email = within(dialog).getByLabelText("Email");
    await waitFor(() => expect(email).toHaveAccessibleDescription("Email invalid"));
    expect(within(dialog).getByLabelText("Nume")).toHaveValue("Maria Dinu");
    expect(email).toHaveValue("nu-e-email");

    await user.clear(within(dialog).getByLabelText("Nume"));
    await user.clear(email);
    await user.type(email, "maria@firma.ro");
    await user.click(within(dialog).getByRole("button", { name: "Salvează și activează telefonul" }));
    await waitFor(() => expect(within(dialog).getByLabelText("Nume")).toHaveAccessibleDescription("Numele lipsește"));
  });

  it("activează telefonul unui Angajat neactivat fără confirmare", async () => {
    const calls = mockApi([ion]);
    const user = userEvent.setup();
    renderApp("/employees");
    await user.click((await rowOf("Ion Vasile")).getByRole("button", { name: "Activează telefonul" }));

    const dialog = await screen.findByRole("dialog", { name: /Activare telefon pentru Ion Vasile/ });
    expect(within(dialog).getByRole("img", { name: /Cod QR/ })).toBeInTheDocument();
    expect(calls).toEqual([{ method: "POST", path: "/api/admin/employees/2/enroll-link" }]);
  });

  it("arată eroarea serverului când Angajatul nu mai există", async () => {
    mockApi([ion]);
    const user = userEvent.setup();
    renderApp("/employees");
    server.use(
      http.post("/api/admin/employees/:id/enroll-link", () =>
        HttpResponse.json({ detail: "Angajat inexistent" }, { status: 404 }),
      ),
    );
    await user.click((await rowOf("Ion Vasile")).getByRole("button", { name: "Activează telefonul" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Angajat inexistent");
  });

  it("„Activează alt telefon” cere confirmare care spune că telefonul vechi nu va mai funcționa; anularea nu face nimic", async () => {
    const calls = mockApi([ana]);
    const user = userEvent.setup();
    renderApp("/employees");
    await user.click((await rowOf("Ana Pop")).getByRole("button", { name: "Activează alt telefon" }));

    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("nu va mai funcționa");
    await user.click(within(dialog).getByRole("button", { name: "Anulează" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(calls).toEqual([]);

    await user.click((await rowOf("Ana Pop")).getByRole("button", { name: "Activează alt telefon" }));
    dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Activează alt telefon" }));
    expect(await screen.findByRole("dialog", { name: /Activare telefon pentru Ana Pop/ })).toBeInTheDocument();
    expect(calls).toEqual([{ method: "POST", path: "/api/admin/employees/1/enroll-link" }]);
  });

  it("scoate telefonul din uz doar după confirmare; anularea nu face nimic", async () => {
    const calls = mockApi([ana]);
    const user = userEvent.setup();
    renderApp("/employees");
    await user.click((await rowOf("Ana Pop")).getByRole("button", { name: "Scoate telefonul din uz" }));

    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Ana Pop");
    await user.click(within(dialog).getByRole("button", { name: "Anulează" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(calls).toEqual([]);

    await user.click((await rowOf("Ana Pop")).getByRole("button", { name: "Scoate telefonul din uz" }));
    dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Scoate telefonul din uz" }));

    await waitFor(async () => expect((await rowOf("Ana Pop")).getByText("Telefon neactivat")).toBeInTheDocument());
    expect(calls).toEqual([{ method: "POST", path: "/api/admin/employees/1/revoke" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Telefon scos din uz");
  });
});
