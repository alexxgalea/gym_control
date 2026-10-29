import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderEmployee } from "@/test/renderEmployee";
import { server } from "@/test/server";

const base = { name: "Ana Pop", time_zone: "Europe/Bucharest", server_time: "2026-01-05T15:42:00+00:00" };
const state = (inside_since: string | null) =>
  http.get("/api/employee/me", () => HttpResponse.json({ ...base, inside_since }));
const failing = (method: "post" | "get", path: string, status: number, reason: string, detail = "Mesajul serverului.") =>
  http[method](path, () => HttpResponse.json({ detail, reason }, { status }));

const OUTSIDE = state(null);
const INSIDE = state("2026-01-05T08:12:00+00:00"); // 10:12 în ora Sălii

describe("Ecranul Angajatului (/me)", () => {
  it("în afara Sălii: numele și butonul Intrare", async () => {
    server.use(OUTSIDE);
    renderEmployee("/me?t=12345678");

    expect(await screen.findByRole("heading", { name: "Ana Pop" })).toBeInTheDocument();
    expect(screen.getByText("În afara Sălii")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Intrare" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Ieșire" })).not.toBeInTheDocument();
  });

  it("în Sală: de la ce oră și butonul Ieșire", async () => {
    server.use(INSIDE);
    renderEmployee("/me?t=12345678");

    expect(await screen.findByText("În Sală din azi, 10:12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ieșire" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Intrare" })).not.toBeInTheDocument();
  });

  it("succes: trimite codul, arată confirmarea, apoi starea se schimbă", async () => {
    let sent: unknown = null;
    let inside: string | null = null;
    server.use(
      http.get("/api/employee/me", () => HttpResponse.json({ ...base, inside_since: inside })),
      http.post("/api/employee/entry", async ({ request }) => {
        sent = await request.json();
        inside = "2026-01-05T15:42:00+00:00";
        return HttpResponse.json({ message: "Intrare înregistrată la 17:42", at: base.server_time, time_zone: base.time_zone });
      }),
    );
    renderEmployee("/me?t=12345678");

    await userEvent.click(await screen.findByRole("button", { name: "Intrare" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Intrare înregistrată la 17:42");
    expect(sent).toEqual({ totp: "12345678" });
    // după ~2 secunde starea se schimbă
    expect(await screen.findByRole("button", { name: "Ieșire" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("Ieșirea trimite la endpointul de Ieșire", async () => {
    server.use(
      INSIDE,
      http.post("/api/employee/exit", () =>
        HttpResponse.json({ message: "Ieșire înregistrată la 17:42", at: base.server_time, time_zone: base.time_zone }),
      ),
    );
    renderEmployee("/me?t=12345678");

    await userEvent.click(await screen.findByRole("button", { name: "Ieșire" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Ieșire înregistrată la 17:42");
  });

  it("rețea greșită: spune să te conectezi la Wi-Fi-ul Sălii și poți încerca din nou", async () => {
    server.use(OUTSIDE, failing("post", "/api/employee/entry", 403, "not_in_hall_network"));
    renderEmployee("/me?t=12345678");

    await userEvent.click(await screen.findByRole("button", { name: "Intrare" }));
    expect(await screen.findByText("Nu ești în rețeaua Sălii")).toBeInTheDocument();
    expect(screen.getByText(/Conectează-te la Wi-Fi-ul Sălii/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Încearcă din nou" }));
    expect(await screen.findByRole("button", { name: "Intrare" })).toBeInTheDocument();
  });

  it("telefon neactivat: cere Adminului un link de activare, fără buton", async () => {
    server.use(failing("get", "/api/employee/me", 401, "phone_not_activated"));
    renderEmployee("/me?t=12345678");

    expect(await screen.findByText("Telefonul nu este activat")).toBeInTheDocument();
    expect(screen.getByText(/Cere Adminului un link de activare/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("cod expirat sau greșit: „Scanează din nou codul de la ușă”", async () => {
    server.use(OUTSIDE, failing("post", "/api/employee/entry", 403, "code_invalid"));
    renderEmployee("/me?t=12345678");

    await userEvent.click(await screen.findByRole("button", { name: "Intrare" }));
    expect(await screen.findByText("Scanează din nou codul de la ușă.")).toBeInTheDocument();
  });

  it("conflict, Ieșire fără Intrare: spune pe înțeles că se ocupă Adminul", async () => {
    server.use(INSIDE, failing("post", "/api/employee/exit", 409, "no_open_entry"));
    renderEmployee("/me?t=12345678");

    await userEvent.click(await screen.findByRole("button", { name: "Ieșire" }));
    expect(await screen.findByText(/Se ocupă Adminul/)).toBeInTheDocument();
  });

  it("conflict, deja în Sală: spune că se ocupă Adminul", async () => {
    server.use(OUTSIDE, failing("post", "/api/employee/entry", 409, "already_inside"));
    renderEmployee("/me?t=12345678");

    await userEvent.click(await screen.findByRole("button", { name: "Intrare" }));
    expect(await screen.findByText("Ești deja în Sală")).toBeInTheDocument();
    expect(screen.getByText(/se ocupă Adminul/)).toBeInTheDocument();
  });

  it("fără cod scanat: niciun buton, doar îndemnul să scanezi codul de la ușă", async () => {
    server.use(OUTSIDE);
    renderEmployee("/me");

    expect(await screen.findByText(/Scanează codul de la ușă/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ana Pop" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
