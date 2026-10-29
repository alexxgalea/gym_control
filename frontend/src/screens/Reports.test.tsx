import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

const DISCLAIMER = "Text de neacceptare trimis de server.";
const OPEN_TEXT = "Sesiune deschisă";
const SCOPE = "Explicația intervalului trimisă de server.";

// orele vin ca instante UTC; Sala e în Europe/Bucharest (iarna UTC+2): 08:00Z = 10:00 local
const report = {
  timezone: "Europe/Bucharest",
  date_from: "2026-01-05T08:00:00+00:00",
  date_to: "2026-01-05T10:00:00+00:00",
  generated_at: "2026-01-05T10:30:00+00:00",
  generated_by: "admin",
  disclaimer: DISCLAIMER,
  scope_text: SCOPE,
  open_text: OPEN_TEXT,
  rows: [
    { employee_name: "Ana Pop", entry: "2026-01-05T07:00:00+00:00", exit: "2026-01-05T08:30:00+00:00", open: false, manual: false, label: "", method_label: "Cod QR" },
    { employee_name: "Bob Ionescu", entry: "2026-01-05T09:00:00+00:00", exit: null, open: true, manual: true, label: "Sesiune manuală (Telefon defect)", method_label: "Sesiune manuală" },
  ],
};

// „azi” fix: anul curent nu se afișează, deci testele nu depind de data rulării
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-06-01T12:00:00Z") });
});
afterEach(() => {
  vi.useRealTimers();
});

const INVALID = "Intervalul e invalid: „De la” trebuie să fie înainte de „Până la”.";

/** API-ul simulat; notează interogările de generare primite. */
function mockApi(rows = report.rows) {
  const queries: string[] = [];
  server.use(
    http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
    http.get("/api/admin/reports", ({ request }) => {
      const url = new URL(request.url);
      queries.push(url.search);
      if (url.searchParams.get("from")! >= url.searchParams.get("to")!) {
        return HttpResponse.json({ detail: INVALID }, { status: 400 });
      }
      return HttpResponse.json({ ...report, rows });
    }),
  );
  return queries;
}

async function generate(from = "2026-01-05T10:00", to = "2026-01-05T12:00") {
  await userEvent.type(await screen.findByLabelText("De la"), from);
  await userEvent.type(screen.getByLabelText("Până la"), to);
  await userEvent.click(screen.getByRole("button", { name: "Generează raportul" }));
}

describe("ecranul Rapoarte", () => {
  it("generează raportul pe interval și afișează textele trimise de server", async () => {
    const queries = mockApi();
    renderApp("/reports");
    expect(await screen.findByRole("heading", { name: "Raport de prezență" })).toBeInTheDocument();
    expect(screen.queryByText(DISCLAIMER)).not.toBeInTheDocument();

    await generate();

    expect(await screen.findByText(DISCLAIMER)).toBeInTheDocument();
    expect(screen.getByText(SCOPE)).toBeInTheDocument();
    expect(queries).toEqual(["?from=2026-01-05T10%3A00&to=2026-01-05T12%3A00"]);
    const ana = within(screen.getByRole("row", { name: /Ana Pop/ }));
    expect(ana.getByText("5 ian., 09:00")).toBeInTheDocument(); // ora Sălii, formatul unic
    expect(ana.getByText("5 ian., 10:30")).toBeInTheDocument();
    expect(ana.getByText("Cod QR")).toBeInTheDocument();
    const bob = within(screen.getByRole("row", { name: /Bob Ionescu/ }));
    expect(bob.getByText(OPEN_TEXT)).toBeInTheDocument(); // textul vine din API, nu din TS
    expect(bob.getByText("Sesiune manuală (Telefon defect)")).toBeInTheDocument();
    expect(bob.getByText("Sesiune manuală")).toBeInTheDocument(); // metoda
  });

  it("explică raportul înainte de prima generare și apoi lasă doar mesajul serverului", async () => {
    mockApi();
    renderApp("/reports");
    expect(await screen.findByText(/nu e o dovadă a vinovăției/)).toBeInTheDocument();
    expect(screen.getByText(/rămâne scrisă în Jurnal/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await generate();
    expect(await screen.findByText(DISCLAIMER)).toBeInTheDocument();
    expect(screen.queryByText(/rămâne scrisă în Jurnal/)).not.toBeInTheDocument();
  });

  it("afișează un mesaj pentru interval fără Sesiuni", async () => {
    mockApi([]);
    renderApp("/reports");
    await generate();
    expect(await screen.findByText("Nicio Sesiune în acest interval.")).toBeInTheDocument();
  });

  it("la interval invalid arată eroarea serverului și păstrează valorile introduse", async () => {
    mockApi();
    renderApp("/reports");
    await generate("2026-01-05T12:00", "2026-01-05T10:00");

    expect(await screen.findByRole("alert")).toHaveTextContent(INVALID);
    expect(screen.getByLabelText("De la")).toHaveValue("2026-01-05T12:00");
    expect(screen.getByLabelText("Până la")).toHaveValue("2026-01-05T10:00");
    expect(screen.queryByText(DISCLAIMER)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Descarcă pentru Excel" })).not.toBeInTheDocument();
  });

  it("oferă CSV-ul ca descărcare și varianta tipărită pentru același interval", async () => {
    mockApi();
    renderApp("/reports");
    await generate();

    const csv = await screen.findByRole("link", { name: "Descarcă pentru Excel" });
    expect(csv).toHaveAttribute("href", "/api/admin/reports.csv?from=2026-01-05T10%3A00&to=2026-01-05T12%3A00");
    expect(csv).toHaveAttribute("download");
    expect(screen.getByRole("link", { name: "Versiune pentru tipărit" })).toHaveAttribute(
      "href",
      "/reports/print?from=2026-01-05T10%3A00&to=2026-01-05T12%3A00",
    );
  });

  it("duce la login când sesiunea a expirat (401)", async () => {
    let signedIn = true;
    server.use(
      http.get("/api/admin/me", () =>
        signedIn ? HttpResponse.json({ username: "admin" }) : new HttpResponse(null, { status: 401 }),
      ),
      http.get("/api/admin/reports", () => {
        signedIn = false;
        return HttpResponse.json({ detail: "Neautentificat" }, { status: 401 });
      }),
    );
    renderApp("/reports");
    await generate();
    expect(await screen.findByRole("button", { name: "Intră în cont" })).toBeInTheDocument();
  });
});

describe("varianta tipărită", () => {
  it("afișează logoul, intervalul în ora Sălii, autorul, disclaimer-ul și tabelul, fără navigare", async () => {
    const queries = mockApi();
    renderApp("/reports/print?from=2026-01-05T10%3A00&to=2026-01-05T12%3A00");

    expect(await screen.findByText(DISCLAIMER)).toBeInTheDocument();
    expect(screen.getByText(SCOPE)).toBeInTheDocument();
    expect(queries).toHaveLength(1);
    expect(screen.getByRole("img", { name: "GymCtrl" })).toBeInTheDocument();
    expect(screen.getByText(/5 ian\., 10:00 – 5 ian\., 12:00/)).toBeInTheDocument();
    expect(screen.getByText(/Generat de admin, 5 ian\., 12:30/)).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Ana Pop/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    // butoanele nu apar la tipărire
    expect(screen.getByRole("button", { name: "Tipărește" }).className).toContain("print:hidden");
    expect(screen.getByRole("link", { name: "Înapoi" }).className).toContain("print:hidden");
  });

  it("tipărește la click pe Tipărește", async () => {
    mockApi();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderApp("/reports/print?from=2026-01-05T10%3A00&to=2026-01-05T12%3A00");
    await userEvent.click(await screen.findByRole("button", { name: "Tipărește" }));
    await waitFor(() => expect(print).toHaveBeenCalled());
  });

  it("arată eroarea serverului pentru interval invalid", async () => {
    mockApi();
    renderApp("/reports/print?from=2026-01-05T12%3A00&to=2026-01-05T10%3A00");
    expect(await screen.findByRole("alert")).toHaveTextContent(INVALID);
  });
});
