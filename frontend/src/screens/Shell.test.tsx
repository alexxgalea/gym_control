import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

const signedIn = http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" }));

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Meniu" }));
  return screen.findByRole("navigation", { name: "Meniu principal" });
}

const menuIsClosed = () =>
  waitFor(() => expect(screen.queryByRole("navigation", { name: "Meniu principal" })).not.toBeInTheDocument());

describe("bara de sus și meniul", () => {
  // ecranul Angajați (rută implicită) își cere lista; aici nu e obiectul testelor
  // la fel ecranele către care navighează testele (Incidente, Jurnal)
  beforeEach(() =>
    server.use(
      http.get("/api/admin/employees", () => HttpResponse.json([])),
      http.get("/api/admin/incidents", () => HttpResponse.json([])),
      http.get("/api/admin/journal/kinds", () => HttpResponse.json([])),
      http.get("/api/admin/journal", () =>
        HttpResponse.json({ entries: [], page: 1, has_next: false, has_prev: false, timezone: "Europe/Bucharest" }),
      ),
    ),
  );

  it("arată logoul și numele GymCtrl, plus butonul Meniu, cu meniul închis", async () => {
    server.use(signedIn);
    renderApp("/employees");

    const bar = await screen.findByRole("banner");
    expect(within(bar).getByRole("img", { name: "GymCtrl" })).toBeInTheDocument();
    expect(within(bar).getByText("GymCtrl")).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Meniu" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("navigation", { name: "Meniu principal" })).not.toBeInTheDocument();
  });

  it("deschide meniul cu toate secțiunile, numele Adminului, comutatorul de temă și Deconectare", async () => {
    server.use(signedIn);
    const user = userEvent.setup();
    renderApp("/employees");

    const nav = await openMenu(user);
    expect(screen.getByRole("button", { name: "Meniu" })).toHaveAttribute("aria-expanded", "true");
    const labels = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual(["Acasă", "Angajați", "Jurnal", "Anomalii", "Incidente", "Raport de prezență", "Setări"]);
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Temă" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deconectare" })).toBeInTheDocument();
  });

  it("marchează ecranul activ, duce la alt ecran și închide meniul", async () => {
    server.use(signedIn);
    const user = userEvent.setup();
    renderApp("/incidents");

    const nav = await openMenu(user);
    expect(within(nav).getByRole("link", { name: "Incidente" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Angajați" })).not.toHaveAttribute("aria-current");

    await user.click(within(nav).getByRole("link", { name: "Jurnal" }));
    expect(await screen.findByRole("heading", { name: "Jurnal" })).toBeInTheDocument();
    await menuIsClosed();

    const reopened = await openMenu(user);
    expect(within(reopened).getByRole("link", { name: "Jurnal" })).toHaveAttribute("aria-current", "page");
  });

  it("închide meniul cu Escape", async () => {
    server.use(signedIn);
    const user = userEvent.setup();
    renderApp("/employees");
    await openMenu(user);

    await user.keyboard("{Escape}");
    await menuIsClosed();
  });

  it("deschide implicit Angajații, iar Acasă duce la ruta de pornire", async () => {
    server.use(signedIn);
    const user = userEvent.setup();
    renderApp("/incidents");

    const nav = await openMenu(user);
    await user.click(within(nav).getByRole("link", { name: "Acasă" }));
    expect(await screen.findByRole("heading", { name: /^Angajați/ })).toBeInTheDocument();
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
    renderApp("/employees");
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Deconectare" }));

    expect(await screen.findByRole("button", { name: "Intră în cont" })).toBeInTheDocument();
    expect(loggedOut).toBe(true);
  });
});

describe("comutatorul de temă", () => {
  beforeEach(() => server.use(signedIn, http.get("/api/admin/employees", () => HttpResponse.json([]))));

  it("urmează sistemul implicit și are trei alegeri", async () => {
    const user = userEvent.setup();
    renderApp("/employees");
    await openMenu(user);

    const group = screen.getByRole("radiogroup", { name: "Temă" });
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
    await openMenu(user);
    await user.click(screen.getByRole("radio", { name: "Întunecată" }));

    expect(screen.getByRole("radio", { name: "Întunecată" })).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    first.unmount();
    document.documentElement.removeAttribute("data-theme");
    renderApp("/employees");
    await openMenu(user);
    expect(screen.getByRole("radio", { name: "Întunecată" })).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    await user.click(screen.getByRole("radio", { name: "Luminoasă" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    await user.click(screen.getByRole("radio", { name: "Sistem" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });
});
