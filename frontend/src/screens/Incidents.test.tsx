import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

type Row = {
  id: number;
  start: string;
  end: string;
  note: string;
  status: "open" | "closed";
  created_by: string;
  closed_at: string | null;
  closed_by: string | null;
};

/** API-ul Incidentelor simulat, cu stare, la granița HTTP. */
function mockApi(initial: Row[] = [], options: { listDelay?: number } = {}) {
  const rows = initial.map((row) => ({ ...row }));
  const calls: { method: string; path: string; body?: unknown }[] = [];
  server.use(
    http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
    http.get("/api/admin/incidents", async () => {
      if (options.listDelay) await delay(options.listDelay);
      return HttpResponse.json(rows);
    }),
    http.post("/api/admin/incidents", async ({ request }) => {
      const body = (await request.json()) as { start: string; end: string; note: string };
      calls.push({ method: "POST", path: "/api/admin/incidents", body });
      if (!body.start)
        return HttpResponse.json({ detail: "Completează data și ora pentru „Începutul”.", field: "start" }, { status: 400 });
      if (!body.end)
        return HttpResponse.json({ detail: "Completează data și ora pentru „Sfârșitul”.", field: "end" }, { status: 400 });
      if (body.start >= body.end)
        return HttpResponse.json({ detail: "Începutul trebuie să fie înainte de sfârșit.", field: "start" }, { status: 400 });
      const row: Row = {
        id: rows.length + 1,
        start: body.start.replace("T", " "),
        end: body.end.replace("T", " "),
        note: body.note,
        status: "open",
        created_by: "admin",
        closed_at: null,
        closed_by: null,
      };
      rows.unshift(row);
      return HttpResponse.json(row, { status: 201 });
    }),
    http.post("/api/admin/incidents/:id/close", ({ params }) => {
      calls.push({ method: "POST", path: `/api/admin/incidents/${params.id}/close` });
      const row = rows.find((r) => r.id === Number(params.id))!;
      Object.assign(row, { status: "closed", closed_at: "2026-01-06 09:00", closed_by: "admin" });
      return HttpResponse.json(row);
    }),
  );
  return calls;
}

const open: Row = {
  id: 1,
  start: "2026-01-05 10:00",
  end: "2026-01-05 11:30",
  note: "Aparat spart",
  status: "open",
  created_by: "admin",
  closed_at: null,
  closed_by: null,
};
const closed: Row = {
  id: 2,
  start: "2026-01-02 09:00",
  end: "2026-01-02 10:00",
  note: "Furt",
  status: "closed",
  created_by: "maria",
  closed_at: "2026-01-03 08:15",
  closed_by: "admin",
};

async function rowOf(text: string) {
  return within(await screen.findByRole("row", { name: new RegExp(text) }));
}

describe("ecranul Incidente", () => {
  it("arată încărcarea, apoi Incidentele cu interval, notă, autor, iar cele deschise distinct de cele închise", async () => {
    mockApi([open, closed], { listDelay: 20 });
    renderApp("/incidents");

    expect(await screen.findByText("Se încarcă…")).toBeInTheDocument();
    const openRow = await rowOf("Aparat spart");
    expect(openRow.getByText("2026-01-05 10:00 – 2026-01-05 11:30")).toBeInTheDocument();
    expect(openRow.getByText("Deschis")).toBeInTheDocument();
    expect(openRow.getByText("admin")).toBeInTheDocument();
    expect(openRow.getByRole("button", { name: "Închide" })).toBeInTheDocument();

    const closedRow = await rowOf("Furt");
    expect(closedRow.getByText(/Închis \(/)).toHaveTextContent("Închis (2026-01-03 08:15, admin)");
    expect(closedRow.queryByText("Deschis")).not.toBeInTheDocument();
    expect(closedRow.queryByRole("button", { name: "Închide" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Incidente" })).toBeInTheDocument();
  });

  it("arată starea de listă goală", async () => {
    mockApi([]);
    renderApp("/incidents");
    expect(await screen.findByText("Nu există Incidente.")).toBeInTheDocument();
  });

  it("arată eroarea când lista nu se poate încărca", async () => {
    server.use(
      http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
      http.get("/api/admin/incidents", () => HttpResponse.json({ detail: "Eroare internă." }, { status: 500 })),
    );
    renderApp("/incidents");
    expect(await screen.findByRole("alert")).toHaveTextContent("Eroare internă.");
  });

  it("duce la login când lista primește 401", async () => {
    server.use(
      http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
      http.get("/api/admin/incidents", () => HttpResponse.json({ detail: "Sesiune lipsă sau expirată." }, { status: 401 })),
    );
    renderApp("/incidents");
    expect(await screen.findByRole("button", { name: "Intră" })).toBeInTheDocument();
  });

  it("marchează un Incident dintr-un dialog cu interval și notă, îl arată deschis și confirmă cu toast", async () => {
    const calls = mockApi([]);
    const user = userEvent.setup();
    renderApp("/incidents");
    await user.click(await screen.findByRole("button", { name: "Marchează Incident" }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("De la"), "2026-01-05T10:00");
    await user.type(within(dialog).getByLabelText("Până la"), "2026-01-05T11:30");
    await user.type(within(dialog).getByLabelText("Notă (opțional)"), "Aparat spart");
    await user.click(within(dialog).getByRole("button", { name: "Marchează" }));

    expect(await screen.findByText("Aparat spart")).toBeInTheDocument();
    expect((await rowOf("Aparat spart")).getByText("Deschis")).toBeInTheDocument();
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/admin/incidents",
        body: { start: "2026-01-05T10:00", end: "2026-01-05T11:30", note: "Aparat spart" },
      },
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Incident marcat");
  });

  it("cere interval valid: eroarea apare lângă câmpul vizat, iar ce a scris Adminul rămâne", async () => {
    mockApi([]);
    const user = userEvent.setup();
    renderApp("/incidents");
    await user.click(await screen.findByRole("button", { name: "Marchează Incident" }));
    const dialog = await screen.findByRole("dialog");

    // sfârșit lipsă
    await user.type(within(dialog).getByLabelText("De la"), "2026-01-05T10:00");
    await user.click(within(dialog).getByRole("button", { name: "Marchează" }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Până la")).toHaveAccessibleDescription(
        "Completează data și ora pentru „Sfârșitul”.",
      ),
    );
    expect(within(dialog).getByLabelText("De la")).not.toHaveAccessibleDescription(/./);

    // început după sfârșit
    await user.type(within(dialog).getByLabelText("Până la"), "2026-01-05T09:00");
    await user.type(within(dialog).getByLabelText("Notă (opțional)"), "ceva");
    await user.click(within(dialog).getByRole("button", { name: "Marchează" }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText("De la")).toHaveAccessibleDescription(
        "Începutul trebuie să fie înainte de sfârșit.",
      ),
    );
    expect(within(dialog).getByLabelText("Până la")).not.toHaveAccessibleDescription(/./);
    expect(within(dialog).getByLabelText("De la")).toHaveValue("2026-01-05T10:00");
    expect(within(dialog).getByLabelText("Până la")).toHaveValue("2026-01-05T09:00");
    expect(within(dialog).getByLabelText("Notă (opțional)")).toHaveValue("ceva");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Nu există Incidente.")).toBeInTheDocument();
  });

  it("arată eroarea notei lângă notă și o eroare generală (fără câmp) în dialog", async () => {
    mockApi([]);
    server.use(
      http.post("/api/admin/incidents", () =>
        HttpResponse.json({ detail: "Nota e prea lungă (maximum 500 caractere).", field: "note" }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    renderApp("/incidents");
    await user.click(await screen.findByRole("button", { name: "Marchează Incident" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("De la"), "2026-01-05T10:00");
    await user.type(within(dialog).getByLabelText("Până la"), "2026-01-05T11:00");
    await user.click(within(dialog).getByRole("button", { name: "Marchează" }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Notă (opțional)")).toHaveAccessibleDescription(
        "Nota e prea lungă (maximum 500 caractere).",
      ),
    );

    server.use(http.post("/api/admin/incidents", () => HttpResponse.json({ detail: "Eroare internă." }, { status: 500 })));
    await user.click(within(dialog).getByRole("button", { name: "Marchează" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Eroare internă.");
  });

  it("închide un Incident doar după confirmare explicită (retenția reia); anularea nu face nimic", async () => {
    const calls = mockApi([open]);
    const user = userEvent.setup();
    renderApp("/incidents");
    await user.click((await rowOf("Aparat spart")).getByRole("button", { name: "Închide" }));

    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("2026-01-05 10:00");
    expect(dialog).toHaveTextContent(/retenți/i);
    await user.click(within(dialog).getByRole("button", { name: "Anulează" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(calls).toEqual([]);
    expect((await rowOf("Aparat spart")).getByText("Deschis")).toBeInTheDocument();

    await user.click((await rowOf("Aparat spart")).getByRole("button", { name: "Închide" }));
    dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Închide Incidentul" }));

    await waitFor(async () =>
      expect((await rowOf("Aparat spart")).getByText(/Închis \(/)).toHaveTextContent("Închis (2026-01-06 09:00, admin)"),
    );
    expect((await rowOf("Aparat spart")).queryByRole("button", { name: "Închide" })).not.toBeInTheDocument();
    expect(calls).toEqual([{ method: "POST", path: "/api/admin/incidents/1/close" }]);
    expect(screen.getByRole("status")).toHaveTextContent("Incident închis");
  });

  it("arată eroarea serverului când Incidentul e deja închis", async () => {
    mockApi([open]);
    server.use(
      http.post("/api/admin/incidents/:id/close", () =>
        HttpResponse.json({ detail: "Incident inexistent sau deja închis" }, { status: 404 }),
      ),
    );
    const user = userEvent.setup();
    renderApp("/incidents");
    await user.click((await rowOf("Aparat spart")).getByRole("button", { name: "Închide" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Închide Incidentul" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incident inexistent sau deja închis");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
