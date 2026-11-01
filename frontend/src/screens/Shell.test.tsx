import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

const signedIn = http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" }));

const person = (id: number, name: string) => ({ session_id: id, employee_name: name, entry_at: "2026-10-30 08:00", minutes: 12 });
const anomaly = (id: number) => ({
  id,
  code: "outside_hours",
  label: "Intrare în afara programului",
  employee_name: "Ana Pop",
  at: "2026-10-30 23:10",
  entry_at: "2026-10-30 23:10",
  exit_at: null,
});
const incident = (id: number, status: "open" | "closed") => ({
  id,
  start: "2026-10-30 10:00",
  end: "2026-10-30 11:00",
  note: "Gantera spartă",
  status,
  created_by: "admin",
  closed_at: null,
  closed_by: null,
  timezone: "Europe/Bucharest",
});

/** Sala cu doi Angajați înăuntru, trei Anomalii, un Incident deschis (și unul închis) și ușa neactivată. */
const busyHall = [
  http.get("/api/admin/in-hall", () =>
    HttpResponse.json({ people: [person(1, "Ana Pop"), person(2, "Ion Ionescu")], door_screen_active: false, timezone: "Europe/Bucharest" }),
  ),
  http.get("/api/admin/anomalies", () => HttpResponse.json([anomaly(1), anomaly(2), anomaly(3)])),
  http.get("/api/admin/incidents", () => HttpResponse.json([incident(1, "open"), incident(2, "closed")])),
];

const sidebar = () => screen.findByRole("navigation", { name: "Meniu principal" });
const bottomBar = () => screen.findByRole("navigation", { name: "Navigare rapidă" });

describe("meniul Adminului", () => {
  // ecranele către care navighează testele își cer datele; aici nu sunt obiectul testelor
  beforeEach(() =>
    server.use(
      signedIn,
      http.get("/api/admin/employees", () => HttpResponse.json([{ id: 7, name: "Ștefan Marin", email: "s@firma.ro", enrolled: true }])),
      http.get("/api/admin/settings", () =>
        HttpResponse.json({ hall_subnet: "192.168.10.0/24", opening_time: "06:00", closing_time: "22:00", retention_months: 12 }),
      ),
      http.get("/api/admin/journal/kinds", () => HttpResponse.json([])),
      http.get("/api/admin/journal", () =>
        HttpResponse.json({ entries: [], page: 1, has_next: false, has_prev: false, timezone: "Europe/Bucharest" }),
      ),
    ),
  );

  it("pe desktop: bara laterală grupează toate ecranele și marchează ecranul activ", async () => {
    renderApp("/incidents");

    const nav = await sidebar();
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Acasă",
      "Jurnal",
      "Ecranul de la ușă",
      "Anomalii",
      "Incidente",
      "Angajați",
      "Raport de prezență",
      "Setări",
    ]);
    for (const group of ["Operare", "De verificat", "Administrare"]) expect(within(nav).getByText(group)).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Incidente" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Angajați" })).not.toHaveAttribute("aria-current");
  });

  it("pe telefon: bara de jos are Acasă, Anomalii, ＋, Jurnal și Mai mult; Acasă e ruta de pornire", async () => {
    const user = userEvent.setup();
    renderApp("/journal");

    const bar = await bottomBar();
    expect(within(bar).getByRole("link", { name: "Jurnal" })).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("button", { name: "Acțiuni rapide" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Mai mult" })).toBeInTheDocument();

    await user.click(within(bar).getByRole("link", { name: "Acasă" }));
    expect(await screen.findByRole("heading", { name: "Acasă" })).toBeInTheDocument();
  });

  it("arată ce e de făcut: cifre la Anomalii și Incidente, câți sunt în Sală, ușa neactivată", async () => {
    server.use(...busyHall);
    renderApp("/journal");

    const nav = await sidebar();
    expect(await within(nav).findByRole("link", { name: "Anomalii, 3 de verificat" })).toBeInTheDocument();
    // doar Incidentele deschise se numără
    expect(within(nav).getByRole("link", { name: "Incidente, 1 deschis" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Acasă, 2 în Sală" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Ecranul de la ușă, neactivat" })).toBeInTheDocument();

    const hall = screen.getByRole("navigation", { name: "Starea Sălii" });
    expect(within(hall).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "2 în Sală",
      "3 Anomalii",
      "1 Incident deschis",
      "Ușa neactivată",
    ]);
    expect(within(hall).getByRole("link", { name: "3 Anomalii" })).toHaveAttribute("href", "/anomalies");
    // cardul „Acum în Sală” din bara laterală
    expect(screen.getByRole("link", { name: /Acum în Sală\s*2/ })).toHaveTextContent("Ecranul de la ușă nu e activat");
  });

  it("fără nimic de verificat, meniul nu arată cifre", async () => {
    renderApp("/journal");

    const nav = await sidebar();
    expect(within(nav).getByRole("link", { name: "Anomalii" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Incidente" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Ecranul de la ușă" })).toBeInTheDocument();
  });

  it("„Mai mult” deschide restul ecranelor și contul; alegerea unui ecran închide foaia", async () => {
    const user = userEvent.setup();
    renderApp("/journal");

    await user.click(within(await bottomBar()).getByRole("button", { name: "Mai mult" }));
    const sheet = await screen.findByRole("dialog", { name: "Mai mult" });
    expect(within(sheet).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Ecranul de la ușă",
      "Incidente",
      "Angajați",
      "Raport de prezență",
      "Setări",
    ]);
    expect(within(sheet).getByText("admin")).toBeInTheDocument();
    expect(within(sheet).getByRole("radiogroup", { name: "Temă" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Deconectare" })).toBeInTheDocument();

    await user.click(within(sheet).getByRole("link", { name: "Angajați" }));
    expect(await screen.findByRole("heading", { name: "Angajați" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Mai mult" })).not.toBeInTheDocument());
  });

  it("închide foaia „Mai mult” cu Escape; avatarul o deschide și el", async () => {
    const user = userEvent.setup();
    renderApp("/journal");

    await user.click(await screen.findByRole("button", { name: "Contul meu" }));
    expect(await screen.findByRole("dialog", { name: "Mai mult" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Mai mult" })).not.toBeInTheDocument());
  });

  it("＋ are cele patru acțiuni rapide; „Incident nou” deschide direct foaia de pe ecranul Incidente", async () => {
    const user = userEvent.setup();
    renderApp("/journal");

    await user.click(within(await bottomBar()).getByRole("button", { name: "Acțiuni rapide" }));
    const sheet = await screen.findByRole("dialog", { name: "Acțiuni rapide" });
    expect(within(sheet).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Sesiune manuală",
      "Angajat nou",
      "Incident nou",
      "Raport de prezență",
    ]);

    await user.click(within(sheet).getByRole("button", { name: "Incident nou" }));
    expect(await screen.findByRole("dialog", { name: "Incident nou" })).toBeInTheDocument();
    // sub foaie e ecranul Incidente (ascuns de cititoarele de ecran cât timp foaia e deschisă)
    expect(screen.getByRole("heading", { name: "Incidente", level: 1, hidden: true })).toBeInTheDocument();
  });

  it("＋ → Sesiune manuală deschide dialogul pe loc, fără să schimbe ecranul", async () => {
    const user = userEvent.setup();
    renderApp("/journal");

    await user.click(within(await bottomBar()).getByRole("button", { name: "Acțiuni rapide" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Acțiuni rapide" })).getByRole("button", { name: "Sesiune manuală" }));
    expect(await screen.findByRole("dialog", { name: /Sesiune manuală/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Jurnal", level: 1, hidden: true })).toBeInTheDocument();
  });

  it("Ctrl+K deschide căutarea: găsește un ecran fără diacritice și duce la el cu Enter", async () => {
    const user = userEvent.setup();
    renderApp("/journal");
    await sidebar();

    await user.keyboard("{Control>}k{/Control}");
    const search = await screen.findByRole("combobox", { name: /Caută un ecran/ });
    await user.type(search, "setari");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Setări"]);

    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Setări" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("căutarea găsește un Angajat și deschide Jurnalul filtrat pe el", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Caută" }));

    await user.type(await screen.findByRole("combobox"), "stef");
    const option = await screen.findByRole("option", { name: /Ștefan Marin/ });
    await user.click(option);

    expect(await screen.findByRole("heading", { name: "Jurnal" })).toBeInTheDocument();
    // filtrul Jurnalului ia id-ul Angajatului din adresă
    expect(await screen.findByLabelText("Angajat", { selector: "select" })).toHaveValue("7");
  });

  it("închide sesiunea la Deconectare și duce la login", async () => {
    let loggedOut = false;
    server.use(
      http.get("/api/admin/me", () =>
        loggedOut ? HttpResponse.json({ detail: "x" }, { status: 401 }) : HttpResponse.json({ username: "admin" }),
      ),
      http.post("/api/admin/logout", () => {
        loggedOut = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp("/journal");
    const side = await screen.findByRole("complementary", { name: "Bara laterală" });
    await user.click(within(side).getByRole("button", { name: "Deconectare" }));

    expect(await screen.findByRole("button", { name: "Intră în cont" })).toBeInTheDocument();
    expect(loggedOut).toBe(true);
  });

  it("are fundalul viu", async () => {
    renderApp("/journal");
    await sidebar();
    expect(screen.getByTestId("live-background")).toBeInTheDocument();
  });
});

describe("comutatorul de temă", () => {
  beforeEach(() => server.use(signedIn, http.get("/api/admin/employees", () => HttpResponse.json([]))));

  const themeSwitch = async () =>
    within(await screen.findByRole("complementary", { name: "Bara laterală" })).getByRole("radiogroup", { name: "Temă" });

  it("urmează sistemul implicit și are trei alegeri", async () => {
    renderApp("/employees");

    const group = await themeSwitch();
    expect(within(group).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "Sistem",
      "Luminoasă",
      "Întunecată",
    ]);
    expect(within(group).getByRole("radio", { name: "Sistem" })).toBeChecked();
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("aplică tema aleasă și o ține minte la următoarea deschidere", async () => {
    const user = userEvent.setup();
    const first = renderApp("/employees");
    await user.click(within(await themeSwitch()).getByRole("radio", { name: "Întunecată" }));

    expect(within(await themeSwitch()).getByRole("radio", { name: "Întunecată" })).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    first.unmount();
    document.documentElement.removeAttribute("data-theme");
    renderApp("/employees");
    const group = await themeSwitch();
    expect(within(group).getByRole("radio", { name: "Întunecată" })).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await user.click(within(group).getByRole("radio", { name: "Luminoasă" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    await user.click(within(group).getByRole("radio", { name: "Sistem" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });
});
