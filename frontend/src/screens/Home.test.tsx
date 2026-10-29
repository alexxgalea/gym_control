import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { renderApp } from "@/test/render";
import { server } from "@/test/server";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-01-06T10:00:00Z") }));
afterEach(() => vi.useRealTimers());

const TZ = "Europe/Bucharest";
const ana = { session_id: 1, employee_name: "Ana Pop", entry_at: "2026-01-06 09:42", minutes: 35 };
const dan = { session_id: 2, employee_name: "Dan Ene", entry_at: "2026-01-06 10:12", minutes: 5 };
const missing = {
  id: 2, session_id: 11, code: "missing_exit", label: "Ieșire lipsă", employee_name: "Ion Vasile",
  at: "2026-01-06 10:12", entry_at: "2026-01-05 10:12", exit_at: null, timezone: TZ,
};
const outside = {
  id: 1, session_id: 10, code: "outside_hours", label: "Intrare în afara programului", employee_name: "Maria Dinu",
  at: "2026-01-05 23:30", entry_at: "2026-01-05 23:30", exit_at: "2026-01-06 01:00", timezone: TZ,
};
const incident = {
  id: 5, start: "2026-01-04 18:00", end: "2026-01-04 20:00", note: "Aparat stricat", status: "open",
  created_by: "admin", closed_at: null, closed_by: null, timezone: TZ,
};

function mockApi(data: { people?: unknown[]; anomalies?: unknown[]; incidents?: unknown[] } = {}, listDelay = 0) {
  let anomalies = [...(data.anomalies ?? [])] as { id: number }[];
  const calls: string[] = [];
  server.use(
    http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
    http.get("/api/admin/in-hall", async () => {
      if (listDelay) await delay(listDelay);
      return HttpResponse.json({ people: data.people ?? [], timezone: TZ });
    }),
    http.get("/api/admin/anomalies", () => HttpResponse.json(anomalies)),
    http.get("/api/admin/incidents", () => HttpResponse.json(data.incidents ?? [])),
    http.post("/api/admin/anomalies/:id/dismiss", ({ params }) => {
      calls.push(`dismiss ${params.id}`);
      anomalies = anomalies.filter((a) => a.id !== Number(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return calls;
}

const tile = async (name: string) => within(await screen.findByRole("region", { name }));

describe("pagina de gestiune (Acasă)", () => {
  it("este ruta de pornire și arată plăcuțele cu date", async () => {
    mockApi({ people: [ana, dan], anomalies: [missing], incidents: [incident] });
    renderApp("/");

    expect(await screen.findByRole("heading", { name: "Acasă" })).toBeInTheDocument();
    const inHall = await tile("Acum în Sală");
    expect(await inHall.findByText("2")).toBeInTheDocument();
    expect(inHall.getByText("Ana Pop")).toBeInTheDocument();
    expect(inHall.getByText("de la 09:42 · de 35 min")).toBeInTheDocument();
    expect(inHall.getByText("de la 10:12 · de 5 min")).toBeInTheDocument();

    const toCheck = await tile("De verificat");
    expect(await toCheck.findByText("Ion Vasile")).toBeInTheDocument();
    expect(toCheck.getByText("Ieșire lipsă")).toBeInTheDocument();
    expect(toCheck.getByRole("button", { name: "Completează Ieșirea" })).toBeInTheDocument();

    const incidents = await tile("Incidente deschise");
    expect(await incidents.findByText(/Aparat stricat/)).toBeInTheDocument();
    expect(incidents.getByText("1")).toBeInTheDocument();
  });

  it("păstrează ordinea plăcuțelor pentru telefon", async () => {
    mockApi();
    renderApp("/");
    await screen.findByRole("heading", { name: "Acasă" });
    const names = screen.getAllByRole("region").map((region) => region.getAttribute("aria-labelledby"));
    expect(names).toEqual(["acum-in-sala", "de-verificat", "incidente-deschise", "actiuni-rapide"]);
  });

  it("arată schelete la încărcare și stări goale prietenoase", async () => {
    mockApi({}, 30);
    renderApp("/");
    expect((await screen.findAllByRole("status", { name: "Se încarcă" })).length).toBeGreaterThan(0);

    expect(await screen.findByText("Nimeni în Sală acum")).toBeInTheDocument();
    expect(await screen.findByText("Nicio Anomalie de verificat")).toBeInTheDocument();
    expect(await screen.findByText("Niciun Incident deschis")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Se încarcă" })).not.toBeInTheDocument();
  });

  it("rezolvă o Anomalie direct din plăcuță", async () => {
    const calls = mockApi({ anomalies: [outside] });
    const user = userEvent.setup();
    renderApp("/");

    await user.click(await (await tile("De verificat")).findByRole("button", { name: "Marchează verificată" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Marchează verificată" }));

    expect(await screen.findByText("Nicio Anomalie de verificat")).toBeInTheDocument();
    expect(calls).toEqual(["dismiss 1"]);
  });

  it("are trei acțiuni rapide: Raport, Angajat nou și Sesiune manuală", async () => {
    mockApi();
    server.use(http.get("/api/admin/employees", () => HttpResponse.json([])));
    const user = userEvent.setup();
    renderApp("/");

    const actions = await tile("Acțiuni rapide");
    expect(await actions.findAllByRole("link")).toHaveLength(2);
    expect(actions.getByRole("link", { name: "Generează un Raport de prezență" })).toHaveAttribute("href", "/reports");
    expect(actions.getByRole("link", { name: "Adaugă un Angajat nou" })).toHaveAttribute("href", "/employees?nou");

    await user.click(actions.getByRole("button", { name: "Adaugă o Sesiune manuală" }));
    expect(await screen.findByRole("dialog", { name: "Sesiune manuală nouă" })).toBeInTheDocument();
  });

  it("„Adaugă un Angajat nou” deschide direct foaia de adăugare", async () => {
    mockApi();
    server.use(http.get("/api/admin/employees", () => HttpResponse.json([])));
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Adaugă un Angajat nou" }));
    expect(await screen.findByRole("dialog", { name: "Angajat nou" })).toBeInTheDocument();
  });

  it("reîmprospătează la 30 de secunde", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let people: unknown[] = [];
    mockApi();
    server.use(http.get("/api/admin/in-hall", () => HttpResponse.json({ people, timezone: TZ })));
    renderApp("/");
    expect(await screen.findByText("Nimeni în Sală acum")).toBeInTheDocument();
    people = [ana];
    vi.advanceTimersByTime(30_000);
    expect(await (await tile("Acum în Sală")).findByText("Ana Pop")).toBeInTheDocument();
  });
});
