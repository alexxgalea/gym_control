import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

type Entry = {
  id: number;
  at: string;
  kind: string;
  kind_label: string;
  employee_id: number | null;
  employee_name: string | null;
  method_label: string | null;
  anomalies: string[];
  author: string | null;
  summary: string;
  manual: boolean;
};

const entry = (over: Partial<Entry>): Entry => ({
  id: 1,
  at: "2026-01-05T08:12:00+00:00",
  kind: "entry",
  kind_label: "Intrare",
  employee_id: 1,
  employee_name: "Ana Pop",
  method_label: "Cod QR",
  anomalies: [],
  author: null,
  summary: "Intrare: Ana Pop",
  manual: false,
  ...over,
});

const KINDS = [
  { value: "entry", label: "Intrare" },
  { value: "exit", label: "Ieșire" },
  { value: "admin_action", label: "Acțiune Admin" },
  { value: "manual_session", label: "Sesiune manuală" },
];

/** API-ul Jurnalului simulat la granița HTTP; întoarce lista cererilor făcute (parametrii de query). */
function mockApi(
  respond: (params: URLSearchParams) => Response | Promise<Response> = () => pageOf([]),
  options: { listDelay?: number } = {},
) {
  const requests: URLSearchParams[] = [];
  server.use(
    http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
    http.get("/api/admin/employees", () =>
      HttpResponse.json([
        { id: 1, name: "Ana Pop", email: "ana@firma.ro", enrolled: true },
        { id: 2, name: "Ion Vasile", email: "ion@firma.ro", enrolled: false },
      ]),
    ),
    http.get("/api/admin/journal/kinds", () => HttpResponse.json(KINDS)),
    http.get("/api/admin/journal", async ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.push(params);
      if (options.listDelay) await delay(options.listDelay);
      return respond(params);
    }),
  );
  return requests;
}

function pageOf(entries: Entry[], extra: Partial<{ page: number; has_next: boolean; has_prev: boolean }> = {}) {
  return HttpResponse.json({
    entries,
    page: 1,
    has_next: false,
    has_prev: false,
    timezone: "Europe/Bucharest",
    ...extra,
  });
}

const rowOf = async (text: RegExp | string) => within((await screen.findByText(text)).closest("li")!);

describe("ecranul Jurnal", () => {
  // formatul datelor depinde de „azi”: înghețăm doar ceasul, nu și temporizatoarele
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-01T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("arată schelet la încărcare, apoi rândurile cu momentul în ora Sălii (fără UTC), Angajatul, tipul, metoda și descrierea", async () => {
    mockApi(() => pageOf([entry({})]), { listDelay: 20 });
    renderApp("/journal");

    expect(await screen.findByRole("status", { name: "Se încarcă" })).toBeInTheDocument();
    const row = await rowOf(/Intrare: Ana Pop/);
    expect(row.getByText("5 ian., 10:12")).toBeInTheDocument(); // ora Sălii, format românesc
    expect(screen.queryByText(/UTC/)).not.toBeInTheDocument();
    expect(row.getByText("Ana Pop")).toBeInTheDocument();
    expect(row.getByText("Intrare")).toBeInTheDocument();
    expect(row.getByText("Cod QR")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Jurnal" })).toBeInTheDocument();
    expect(screen.getByText(/Tot ce s-a întâmplat în aplicație/)).toBeInTheDocument();
  });

  it("folosește ora de vară a Sălii pentru momentele din vară", async () => {
    mockApi(() => pageOf([entry({ at: "2026-07-05T08:12:00+00:00", summary: "Intrare vară" })]));
    renderApp("/journal");
    const row = await rowOf(/Intrare vară/);
    expect(row.getByText("5 iul., 11:12")).toBeInTheDocument();
  });

  it("arată acțiunile Adminilor cu autorul, Anomaliile ca insigne și evenimentele automate marcate pe înțeles", async () => {
    mockApi(() =>
      pageOf([
        entry({
          id: 3,
          kind: "admin_action",
          kind_label: "Acțiune Admin",
          employee_name: null,
          employee_id: null,
          method_label: null,
          author: "admin",
          summary: "Angajat creat: Ana Pop",
        }),
        entry({ id: 2, anomalies: ["Intrare în afara programului", "Ieșire lipsă"], summary: "Intrare târzie" }),
      ]),
    );
    renderApp("/journal");
    const action = await rowOf(/Angajat creat/);
    expect(action.getByText("Acțiune Admin")).toBeInTheDocument();
    expect(action.getByText("Făcut de admin")).toBeInTheDocument();
    expect(action.queryByText("—")).not.toBeInTheDocument();
    const late = await rowOf(/Intrare târzie/);
    expect(late.getByText("Intrare în afara programului")).toBeInTheDocument();
    expect(late.getByText("Ieșire lipsă")).toBeInTheDocument();
    expect(late.getByText("Eveniment automat")).toBeInTheDocument();
    expect(action.queryByText("Eveniment automat")).not.toBeInTheDocument();
  });

  it("marchează vizibil Sesiunile manuale, cu autorul, metoda și motivul, și nu pe celelalte rânduri", async () => {
    mockApi(() =>
      pageOf([
        entry({
          id: 2,
          kind: "manual_session",
          kind_label: "Sesiune manuală",
          manual: true,
          method_label: "Sesiune manuală",
          author: "admin",
          summary: "Sesiune manuală adăugată: Ana Pop. Motiv: Telefon stricat",
        }),
        entry({ id: 1 }),
      ]),
    );
    renderApp("/journal");
    const manual = await rowOf(/Telefon stricat/);
    expect(manual.getAllByText("Sesiune manuală")).toHaveLength(1); // doar tipul; metoda identică nu se repetă
    expect(manual.getByText("Făcut de admin")).toBeInTheDocument();
    expect(manual.getByTestId("manual-mark")).toBeInTheDocument();
    expect((await rowOf(/Intrare: Ana Pop/)).queryByTestId("manual-mark")).not.toBeInTheDocument();
  });

  it("arată starea de listă goală", async () => {
    mockApi(() => pageOf([]));
    renderApp("/journal");
    expect(await screen.findByText("Nicio înregistrare pentru filtrele alese.")).toBeInTheDocument();
  });

  it("filtrează după Angajat, tip și interval, combinat, și trimite filtrele serverului", async () => {
    const requests = mockApi(() => pageOf([entry({})]));
    const user = userEvent.setup();
    renderApp("/journal");
    await screen.findByText("Intrare: Ana Pop");
    expect(requests[0]!.toString()).toBe(""); // fără filtre la început

    await user.selectOptions(await screen.findByLabelText("Angajat"), "Ion Vasile");
    await user.selectOptions(screen.getByLabelText("Tip"), "Ieșire");
    fireEvent.change(screen.getByLabelText("De la (inclusiv)"), { target: { value: "2026-01-05" } });
    fireEvent.change(screen.getByLabelText("Până la (inclusiv)"), { target: { value: "2026-01-06" } });
    await user.click(screen.getByRole("button", { name: "Filtrează" }));

    await screen.findByText("Intrare: Ana Pop");
    const last = requests.at(-1)!;
    expect(Object.fromEntries(last)).toEqual({ employee: "2", kind: "exit", from: "2026-01-05", to: "2026-01-06" });
  });

  it("preia filtrele din adresă (inclusiv după redirectul de la ruta veche) și le arată în formular", async () => {
    const requests = mockApi(() => pageOf([]));
    renderApp("/journal?employee=2&kind=manual_session&from=2026-01-05");
    await screen.findByText("Nicio înregistrare pentru filtrele alese.");
    expect(Object.fromEntries(requests[0]!)).toEqual({ employee: "2", kind: "manual_session", from: "2026-01-05" });
    expect(screen.getByLabelText("De la (inclusiv)")).toHaveValue("2026-01-05");
    expect(screen.getByLabelText("Angajat")).toHaveValue("2");
    expect(screen.getByLabelText("Tip")).toHaveValue("manual_session");
  });

  it("Resetează șterge toate filtrele", async () => {
    const requests = mockApi(() => pageOf([]));
    const user = userEvent.setup();
    renderApp("/journal?kind=exit&from=2026-01-05");
    await screen.findByText("Nicio înregistrare pentru filtrele alese.");
    await user.click(screen.getByRole("button", { name: "Resetează" }));
    await vi.waitFor(() => expect(requests.at(-1)!.toString()).toBe(""));
    expect(screen.getByLabelText("De la (inclusiv)")).toHaveValue("");
    expect(screen.getByLabelText("Tip")).toHaveValue("");
  });

  it("arată eroarea serverului (interval invers) fără să piardă filtrele introduse", async () => {
    mockApi((params) =>
      params.get("from")
        ? HttpResponse.json({ detail: "Intervalul e invers: „De la” trebuie să fie înainte de „Până la”." }, { status: 400 })
        : pageOf([]),
    );
    const user = userEvent.setup();
    renderApp("/journal");
    await screen.findByText("Nicio înregistrare pentru filtrele alese.");
    fireEvent.change(screen.getByLabelText("De la (inclusiv)"), { target: { value: "2026-01-06" } });
    fireEvent.change(screen.getByLabelText("Până la (inclusiv)"), { target: { value: "2026-01-05" } });
    await user.click(screen.getByRole("button", { name: "Filtrează" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Intervalul e invers");
    expect(screen.getByLabelText("De la (inclusiv)")).toHaveValue("2026-01-06");
  });

  it("paginează păstrând filtrele: Mai vechi / Mai noi", async () => {
    const requests = mockApi((params) =>
      params.get("page") === "2"
        ? pageOf([entry({ id: 9, summary: "Intrare veche" })], { page: 2, has_prev: true })
        : pageOf([entry({})], { has_next: true }),
    );
    const user = userEvent.setup();
    renderApp("/journal?kind=entry");
    await screen.findByText("Intrare: Ana Pop");
    expect(screen.getByText("Pagina 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mai noi" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mai vechi" }));
    expect(await screen.findByText("Intrare veche")).toBeInTheDocument();
    expect(screen.getByText("Pagina 2")).toBeInTheDocument();
    expect(Object.fromEntries(requests.at(-1)!)).toEqual({ kind: "entry", page: "2" });

    await user.click(screen.getByRole("button", { name: "Mai noi" }));
    expect(await screen.findByText("Intrare: Ana Pop")).toBeInTheDocument();
  });

  it("pe telefon filtrele se deschid într-o foaie și se aplică de acolo", async () => {
    const base = window.matchMedia;
    window.matchMedia = (query: string) => ({ ...base(query), matches: query.includes("max-width") }) as MediaQueryList;
    const requests = mockApi(() => pageOf([entry({})]));
    const user = userEvent.setup();
    renderApp("/journal");
    await screen.findByText("Intrare: Ana Pop");
    expect(screen.queryByLabelText("De la (inclusiv)")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filtre" }));
    fireEvent.change(await screen.findByLabelText("De la (inclusiv)"), { target: { value: "2026-01-05" } });
    await user.click(screen.getByRole("button", { name: "Filtrează" }));

    await vi.waitFor(() => expect(Object.fromEntries(requests.at(-1)!)).toEqual({ from: "2026-01-05" }));
    expect(screen.queryByLabelText("De la (inclusiv)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filtre (1)" })).toBeInTheDocument();
  });

  it("duce la login când sesiunea a expirat (401)", async () => {
    server.use(
      http.get("/api/admin/me", () => HttpResponse.json({ detail: "Sesiune lipsă sau expirată." }, { status: 401 })),
    );
    renderApp("/journal");
    expect(await screen.findByRole("button", { name: "Intră în cont" })).toBeInTheDocument();
  });
});
