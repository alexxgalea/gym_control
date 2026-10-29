import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

const signedIn = http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" }));

describe("shell-ul", () => {
  it("are navigare către toate ecranele și marchează ecranul activ", async () => {
    server.use(signedIn);
    renderApp("/incidents");

    const nav = await screen.findByRole("navigation");
    for (const label of ["Angajați", "Jurnal", "Anomalii", "Incidente", "Rapoarte", "Setări"]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(within(nav).getByRole("link", { name: "Incidente" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Angajați" })).not.toHaveAttribute("aria-current");

    await userEvent.click(within(nav).getByRole("link", { name: "Jurnal" }));
    expect(within(nav).getByRole("link", { name: "Jurnal" })).toHaveAttribute("aria-current", "page");
  });

  it("deschide implicit Angajații", async () => {
    server.use(signedIn);
    renderApp("/");
    const nav = await screen.findByRole("navigation");
    expect(within(nav).getByRole("link", { name: "Angajați" })).toHaveAttribute("aria-current", "page");
  });

  it("închide sesiunea la Ieșire cont și duce la login", async () => {
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
    renderApp("/employees");
    await userEvent.click(await screen.findByRole("button", { name: "Ieșire cont" }));

    expect(await screen.findByRole("button", { name: "Intră" })).toBeInTheDocument();
    expect(loggedOut).toBe(true);
  });
});
