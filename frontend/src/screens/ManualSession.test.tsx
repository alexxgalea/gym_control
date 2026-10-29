import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

type Body = Record<string, unknown>;

const missing = {
  id: 2, session_id: 11, code: "missing_exit", label: "Ieșire lipsă",
  employee_name: "Ion Vasile", at: "2026-01-06 10:12", entry_at: "2026-01-05 10:12", exit_at: null, timezone: "Europe/Bucharest",
};

/** API simulat: Jurnalul și Anomaliile se schimbă după o scriere reușită; erorile sunt cele ale serverului. */
function mockApi(options: { createError?: { status: number; body: Body }; correctError?: { status: number; body: Body } } = {}) {
  const posts: { path: string; body: Body }[] = [];
  let added = false;
  let corrected = false;
  server.use(
    http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
    http.get("/api/admin/employees", () =>
      HttpResponse.json([
        { id: 1, name: "Ana Pop", email: "ana@firma.ro", enrolled: true },
        { id: 2, name: "Ion Vasile", email: "ion@firma.ro", enrolled: false },
      ]),
    ),
    http.get("/api/admin/journal/kinds", () => HttpResponse.json([])),
    http.get("/api/admin/journal", () =>
      HttpResponse.json({
        entries: added
          ? [{
              id: 1, at: "2026-01-05T08:12:00+00:00", kind: "manual_session", kind_label: "Sesiune manuală",
              employee_id: 1, employee_name: "Ana Pop", method_label: "Introdus manual", anomalies: [],
              author: "admin", summary: "Sesiune manuală adăugată: Ana Pop. Motiv: Telefon stricat", manual: true,
            }]
          : [],
        page: 1, has_next: false, has_prev: false, timezone: "Europe/Bucharest",
      }),
    ),
    http.get("/api/admin/anomalies", () => HttpResponse.json(corrected ? [] : [missing])),
    http.post("/api/admin/sessions", async ({ request }) => {
      posts.push({ path: "/api/admin/sessions", body: (await request.json()) as Body });
      if (options.createError) return HttpResponse.json(options.createError.body, { status: options.createError.status });
      added = true;
      return HttpResponse.json({ id: 5 }, { status: 201 });
    }),
    http.post("/api/admin/sessions/:id/correct", async ({ request, params }) => {
      posts.push({ path: `/api/admin/sessions/${params.id}/correct`, body: (await request.json()) as Body });
      if (options.correctError) return HttpResponse.json(options.correctError.body, { status: options.correctError.status });
      corrected = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return posts;
}

const dialog = () => screen.findByRole("dialog");

describe("Sesiuni manuale", () => {
  it("adaugă din Jurnal cu motiv, trimite orele locale, confirmă cu toast și arată rândul marcat cu autor", async () => {
    const posts = mockApi();
    const user = userEvent.setup();
    renderApp("/journal");

    await user.click(await screen.findByRole("button", { name: "Sesiune manuală nouă" }));
    const form = within(await dialog());
    await user.selectOptions(await form.findByLabelText("Angajat"), "Ana Pop");
    fireEvent.change(form.getByLabelText("Intrare"), { target: { value: "2026-01-05T08:00" } });
    fireEvent.change(form.getByLabelText("Ieșire"), { target: { value: "2026-01-05T09:30" } });
    await user.type(form.getByLabelText("Motiv"), "Telefon stricat");
    await user.click(form.getByRole("button", { name: "Salvează Sesiunea" }));

    expect(await screen.findByText("Sesiune manuală adăugată")).toBeInTheDocument();
    expect(posts).toEqual([{
      path: "/api/admin/sessions",
      body: { employee_id: 1, entry_at: "2026-01-05T08:00", exit_at: "2026-01-05T09:30", reason: "Telefon stricat" },
    }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Jurnalul s-a reîncărcat: rândul manual apare, marcat, cu autorul
    const mark = await screen.findByTestId("manual-mark");
    const row = within(mark.closest("li")!);
    expect(row.getByText("Făcut de admin")).toBeInTheDocument();
    expect(row.getByText(/Telefon stricat/)).toBeInTheDocument();
  });

  it("arată eroarea de motiv lângă câmp și păstrează dialogul și datele", async () => {
    mockApi({
      createError: {
        status: 400,
        body: { detail: "Motivul este obligatoriu. Spune de ce se introduce manual această Sesiune.", field: "reason" },
      },
    });
    const user = userEvent.setup();
    renderApp("/journal");

    await user.click(await screen.findByRole("button", { name: "Sesiune manuală nouă" }));
    const form = within(await dialog());
    fireEvent.change(form.getByLabelText("Intrare"), { target: { value: "2026-01-05T08:00" } });
    await user.click(form.getByRole("button", { name: "Salvează Sesiunea" }));

    const reason = await form.findByLabelText("Motiv");
    expect(reason).toHaveAccessibleDescription(/Motivul este obligatoriu/);
    expect(reason).toBeInvalid();
    expect(form.getByLabelText("Intrare")).toHaveValue("2026-01-05T08:00");
  });

  it.each([
    ["employee_id", "Alege un Angajat.", "Angajat"],
    ["entry_at", "Completează data și ora pentru „Intrare”.", "Intrare"],
    ["exit_at", "Ieșirea nu poate fi în viitor.", "Ieșire"],
  ])("pune eroarea câmpului %s lângă câmpul lui", async (field, detail, label) => {
    mockApi({ createError: { status: 400, body: { detail, field } } });
    const user = userEvent.setup();
    renderApp("/journal");
    await user.click(await screen.findByRole("button", { name: "Sesiune manuală nouă" }));
    const form = within(await dialog());
    await user.click(form.getByRole("button", { name: "Salvează Sesiunea" }));
    expect(await form.findByLabelText(label)).toHaveAccessibleDescription(detail);
  });

  it("arată o eroare fără câmp (suprapunere) la nivel de formular", async () => {
    mockApi({ createError: { status: 400, body: { detail: "Intervalul se suprapune cu o altă Sesiune." } } });
    const user = userEvent.setup();
    renderApp("/journal");
    await user.click(await screen.findByRole("button", { name: "Sesiune manuală nouă" }));
    const form = within(await dialog());
    await user.click(form.getByRole("button", { name: "Salvează Sesiunea" }));
    expect(await form.findByRole("alert")).toHaveTextContent("Intervalul se suprapune cu o altă Sesiune.");
  });

  it("corectează o Sesiune deschisă din Anomalii: Ieșire + motiv, apoi Anomalia dispare", async () => {
    const posts = mockApi();
    const user = userEvent.setup();
    renderApp("/anomalies");

    await user.click(await screen.findByRole("button", { name: "Completează Ieșirea" }));
    const form = within(await dialog());
    fireEvent.change(form.getByLabelText("Ieșire"), { target: { value: "2026-01-05T18:00" } });
    await user.type(form.getByLabelText("Motiv"), "Ieșire uitată");
    await user.click(form.getByRole("button", { name: "Salvează Ieșirea" }));

    expect(await screen.findByText("Sesiune corectată")).toBeInTheDocument();
    expect(posts).toEqual([{
      path: "/api/admin/sessions/11/correct",
      body: { exit_at: "2026-01-05T18:00", reason: "Ieșire uitată" },
    }]);
    expect(await screen.findByText("Nicio Anomalie de verificat")).toBeInTheDocument();
  });

  it("corectarea fără motiv arată eroarea lângă câmpul Motiv", async () => {
    mockApi({ correctError: { status: 400, body: { detail: "Motivul este obligatoriu.", field: "reason" } } });
    const user = userEvent.setup();
    renderApp("/anomalies");
    await user.click(await screen.findByRole("button", { name: "Completează Ieșirea" }));
    const form = within(await dialog());
    await user.click(form.getByRole("button", { name: "Salvează Ieșirea" }));
    expect(await form.findByLabelText("Motiv")).toHaveAccessibleDescription("Motivul este obligatoriu.");
  });

  it("arată „Sesiunea e deja închisă.” (409) în dialog", async () => {
    mockApi({ correctError: { status: 409, body: { detail: "Sesiunea e deja închisă." } } });
    const user = userEvent.setup();
    renderApp("/anomalies");
    await user.click(await screen.findByRole("button", { name: "Completează Ieșirea" }));
    const form = within(await dialog());
    await user.click(form.getByRole("button", { name: "Salvează Ieșirea" }));
    expect(await form.findByRole("alert")).toHaveTextContent("Sesiunea e deja închisă.");
  });

  it("oferă Sesiune manuală nouă și din Anomalii și din Angajați", async () => {
    mockApi();
    renderApp("/anomalies");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sesiune manuală nouă" }));
    expect(await dialog()).toBeInTheDocument();
  });

  it("oferă Sesiune manuală nouă din Angajați", async () => {
    mockApi();
    renderApp("/employees");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sesiune manuală nouă" }));
    expect(within(await dialog()).getByLabelText("Motiv")).toBeInTheDocument();
  });
});
