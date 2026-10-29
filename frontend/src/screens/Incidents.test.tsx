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
  timezone: string;
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
        timezone: "Europe/Bucharest",
      };
      rows.unshift(row);
      return HttpResponse.json(row, { status: 201 });
    }),
    http.post("/api/admin/incidents/:id/close", ({ params }) => {
      calls.push({ method: "POST", path: `/api/admin/incidents/${params.id}/close` });
      const row = rows.find((r) => r.id === Number(params.id))!;
      Object.assign(row, { status: "closed", closed_at: "2020-01-06 09:00", closed_by: "admin" });
      return HttpResponse.json(row);
    }),
  );
  return calls;
}

// Anul 2020 diferă de cel curent, deci datele se afișează cu an, indiferent de ziua rulării testului.
const open: Row = {
  id: 1,
  start: "2020-01-05 10:00",
  end: "2020-01-05 11:30",
  note: "Aparat spart",
  status: "open",
  created_by: "admin",
  closed_at: null,
  closed_by: null,
  timezone: "Europe/Bucharest",
};
const closed: Row = {
  id: 2,
  start: "2020-01-02 09:00",
  end: "2020-01-02 10:00",
  note: "Furt",
  status: "closed",
  created_by: "maria",
  closed_at: "2020-01-03 08:15",
  closed_by: "admin",
  timezone: "Europe/Bucharest",
};

async function cardOf(text: string) {
  const card = await waitFor(() => {
    const found = screen.getAllByRole("listitem").find((item) => item.textContent?.includes(text));
    if (!found) throw new Error(`Niciun card cu ${text}`);
    return found;
  });
  return within(card);
}

/** Alege data sau ora într-un selector din foaie. */
async function pick(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, label: string, value: string) {
  await user.type(within(dialog).getByLabelText(label), value);
}

describe("ecranul Incidente", () => {
  it("explică în antet cum un Incident protejează datele", async () => {
    mockApi([]);
    renderApp("/incidents");
    expect(await screen.findByRole("heading", { name: "Incidente" })).toBeInTheDocument();
    expect(screen.getByText(/datele din intervalul lui nu se șterg/)).toBeInTheDocument();
  });

  it("arată schelet la încărcare, apoi Incidentele cu interval formatat, notă și autor, cele deschise distinct", async () => {
    mockApi([open, closed], { listDelay: 20 });
    renderApp("/incidents");

    expect(await screen.findByRole("status", { name: "Se încarcă" })).toBeInTheDocument();
    const openCard = await cardOf("Aparat spart");
    expect(openCard.getByText("5 ian. 2020, 10:00 – 5 ian. 2020, 11:30")).toBeInTheDocument();
    expect(openCard.getByText("Deschis")).toBeInTheDocument();
    expect(openCard.getByText("Deschis de admin")).toBeInTheDocument();
    expect(openCard.getByRole("button", { name: "Închide" })).toBeInTheDocument();

    const closedCard = await cardOf("Furt");
    expect(closedCard.getByText(/Închis de/)).toHaveTextContent("Închis de admin, 3 ian. 2020, 08:15");
    expect(closedCard.queryByText("Deschis")).not.toBeInTheDocument();
    expect(closedCard.queryByRole("button", { name: "Închide" })).not.toBeInTheDocument();
  });

  it("arată starea goală prietenoasă", async () => {
    mockApi([]);
    renderApp("/incidents");
    expect(await screen.findByText(/Niciun Incident/)).toBeInTheDocument();
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
    expect(await screen.findByRole("button", { name: "Intră în cont" })).toBeInTheDocument();
  });

  it("deschide un Incident dintr-o foaie cu intervalul ales din selectoare și confirmă cu toast", async () => {
    const calls = mockApi([]);
    const user = userEvent.setup();
    renderApp("/incidents");
    await user.click(await screen.findByRole("button", { name: "Deschide un Incident" }));

    const dialog = await screen.findByRole("dialog");
    await pick(user, dialog, "Data de început", "2020-01-05");
    await pick(user, dialog, "Ora de început", "10:00");
    await pick(user, dialog, "Data de sfârșit", "2020-01-05");
    await pick(user, dialog, "Ora de sfârșit", "11:30");
    await user.type(within(dialog).getByLabelText("Notă (opțional)"), "Aparat spart");
    await user.click(within(dialog).getByRole("button", { name: "Deschide Incidentul" }));

    expect((await cardOf("Aparat spart")).getByText("Deschis")).toBeInTheDocument();
    expect(calls).toEqual([
      {
        method: "POST",
        path: "/api/admin/incidents",
        body: { start: "2020-01-05T10:00", end: "2020-01-05T11:30", note: "Aparat spart" },
      },
    ]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Incident deschis");
  });

  it("arată eroarea lângă câmpul vizat, iar ce a ales Adminul rămâne", async () => {
    mockApi([]);
    const user = userEvent.setup();
    renderApp("/incidents");
    await user.click(await screen.findByRole("button", { name: "Deschide un Incident" }));
    const dialog = await screen.findByRole("dialog");

    // sfârșit lipsă
    await pick(user, dialog, "Data de început", "2020-01-05");
    await pick(user, dialog, "Ora de început", "10:00");
    await user.click(within(dialog).getByRole("button", { name: "Deschide Incidentul" }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Data de sfârșit")).toHaveAccessibleDescription(
        "Completează data și ora pentru „Sfârșitul”.",
      ),
    );
    expect(within(dialog).getByLabelText("Data de început")).not.toHaveAccessibleDescription(/./);

    // început după sfârșit
    await pick(user, dialog, "Data de sfârșit", "2020-01-05");
    await pick(user, dialog, "Ora de sfârșit", "09:00");
    await user.type(within(dialog).getByLabelText("Notă (opțional)"), "ceva");
    await user.click(within(dialog).getByRole("button", { name: "Deschide Incidentul" }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Data de început")).toHaveAccessibleDescription(
        "Începutul trebuie să fie înainte de sfârșit.",
      ),
    );
    expect(within(dialog).getByLabelText("Ora de început")).toHaveValue("10:00");
    expect(within(dialog).getByLabelText("Ora de sfârșit")).toHaveValue("09:00");
    expect(within(dialog).getByLabelText("Notă (opțional)")).toHaveValue("ceva");
    expect(screen.queryByText("Incident deschis")).not.toBeInTheDocument();
  });

  it("arată eroarea notei lângă notă și o eroare generală (fără câmp) în foaie", async () => {
    mockApi([]);
    server.use(
      http.post("/api/admin/incidents", () =>
        HttpResponse.json({ detail: "Nota e prea lungă (maximum 500 caractere).", field: "note" }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    renderApp("/incidents");
    await user.click(await screen.findByRole("button", { name: "Deschide un Incident" }));
    const dialog = await screen.findByRole("dialog");
    await pick(user, dialog, "Data de început", "2020-01-05");
    await pick(user, dialog, "Ora de început", "10:00");
    await pick(user, dialog, "Data de sfârșit", "2020-01-05");
    await pick(user, dialog, "Ora de sfârșit", "11:00");
    await user.click(within(dialog).getByRole("button", { name: "Deschide Incidentul" }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Notă (opțional)")).toHaveAccessibleDescription(
        "Nota e prea lungă (maximum 500 caractere).",
      ),
    );

    server.use(http.post("/api/admin/incidents", () => HttpResponse.json({ detail: "Eroare internă." }, { status: 500 })));
    await user.click(within(dialog).getByRole("button", { name: "Deschide Incidentul" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Eroare internă.");
  });

  it("închide un Incident doar după confirmarea care avertizează că datele intră sub Perioada de păstrare", async () => {
    const calls = mockApi([open]);
    const user = userEvent.setup();
    renderApp("/incidents");
    await user.click((await cardOf("Aparat spart")).getByRole("button", { name: "Închide" }));

    let dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/intră din nou sub Perioada de păstrare/);
    await user.click(within(dialog).getByRole("button", { name: "Anulează" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(calls).toEqual([]);
    expect((await cardOf("Aparat spart")).getByText("Deschis")).toBeInTheDocument();

    await user.click((await cardOf("Aparat spart")).getByRole("button", { name: "Închide" }));
    dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Închide Incidentul" }));

    await waitFor(async () =>
      expect((await cardOf("Aparat spart")).getByText(/Închis de/)).toHaveTextContent("Închis de admin, 6 ian. 2020, 09:00"),
    );
    expect((await cardOf("Aparat spart")).queryByRole("button", { name: "Închide" })).not.toBeInTheDocument();
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
    await user.click((await cardOf("Aparat spart")).getByRole("button", { name: "Închide" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Închide Incidentul" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incident inexistent sau deja închis");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
