import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

const noSession = http.get("/api/admin/me", () => HttpResponse.json({ detail: "Sesiune lipsă sau expirată." }, { status: 401 }));

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, username: string, password: string) {
  await user.type(await screen.findByLabelText("Nume de utilizator"), username);
  await user.type(screen.getByLabelText("Parolă"), password);
  await user.click(screen.getByRole("button", { name: "Intră în cont" }));
}

describe("ecranul de login", () => {
  it("duce în shell cu numele contului după credențiale corecte", async () => {
    let signedIn = false;
    server.use(
      http.get("/api/admin/employees", () => HttpResponse.json([])),
      http.get("/api/admin/me", () =>
        signedIn ? HttpResponse.json({ username: "admin" }) : HttpResponse.json({ detail: "x" }, { status: 401 }),
      ),
      http.post("/api/admin/login", async ({ request }) => {
        expect(await request.json()).toEqual({ username: "admin", password: "parola-buna" });
        signedIn = true;
        return HttpResponse.json({ username: "admin" });
      }),
    );
    const user = userEvent.setup();
    renderApp("/");
    await fillAndSubmit(user, "admin", "parola-buna");

    await screen.findByRole("heading", { name: /^Angajați/ }); // după redirecționarea către ruta de pornire
    await user.click(await screen.findByRole("button", { name: "Meniu" }));
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("arată identitatea GymCtrl și câmpuri numite clar", async () => {
    server.use(noSession);
    renderApp("/login");

    expect(await screen.findByRole("img", { name: "GymCtrl" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "GymCtrl" })).toBeInTheDocument();
    expect(screen.getByLabelText("Nume de utilizator")).toBeInTheDocument();
    expect(screen.getByLabelText("Parolă")).toHaveAttribute("type", "password");
  });

  it("arată mesajul serverului la credențiale greșite", async () => {
    server.use(
      noSession,
      http.post("/api/admin/login", () => HttpResponse.json({ detail: "Cont sau parolă greșite." }, { status: 401 })),
    );
    const user = userEvent.setup();
    renderApp("/login");
    await fillAndSubmit(user, "admin", "gresita");

    expect(await screen.findByRole("alert")).toHaveTextContent("Cont sau parolă greșite.");
  });

  it("arată mesajul de blocare după prea multe încercări (429)", async () => {
    server.use(
      noSession,
      http.post("/api/admin/login", () =>
        HttpResponse.json({ detail: "Prea multe încercări eșuate. Încearcă din nou peste 15 min." }, { status: 429 }),
      ),
    );
    const user = userEvent.setup();
    renderApp("/login");
    await fillAndSubmit(user, "admin", "orice");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Prea multe încercări eșuate. Încearcă din nou peste 15 min.",
    );
  });
});

describe("sesiunea", () => {
  it("duce la login când nu există sesiune (401)", async () => {
    server.use(noSession);
    renderApp("/employees");

    expect(await screen.findByRole("button", { name: "Intră în cont" })).toBeInTheDocument();
    expect(screen.queryByRole("banner")).not.toBeInTheDocument();
  });

  it("duce la login când un ecran primește 401 după ce sesiunea a expirat", async () => {
    let expired = false;
    server.use(
      http.get("/api/admin/employees", () => HttpResponse.json([])),
      http.get("/api/admin/me", () =>
        expired ? HttpResponse.json({ detail: "x" }, { status: 401 }) : HttpResponse.json({ username: "admin" }),
      ),
    );
    renderApp("/employees");
    expect(await screen.findByRole("banner")).toBeInTheDocument();
    // sesiunea expiră; următoarea verificare a identității primește 401
    expired = true;
    window.dispatchEvent(new Event("visibilitychange"));

    expect(await screen.findByRole("button", { name: "Intră în cont" })).toBeInTheDocument();
  });
});
