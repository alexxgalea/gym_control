import { act, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { renderEmployee } from "@/test/renderEmployee";
import { server } from "@/test/server";

const WARNING = "Codul nu se mai actualizează. Verifică Wi-Fi-ul telefonului.";
const svg = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${label}</title></svg>`;
const code = (n: number, remaining = 30) => ({
  svg: svg(`cod-${n}`),
  url: `http://telefon/me?t=0000000${n}`,
  period_seconds: 30,
  remaining_seconds: remaining,
});

const qr = (handler: () => Response | Promise<Response>) => http.get("/api/employee/door/qr", handler);
const failing = (status: number, reason: string, detail = "Mesajul serverului.") =>
  qr(() => HttpResponse.json({ detail, reason }, { status }));

/** Avansează timpul fals și lasă promisiunile (fetch simulat) să se termine. */
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] }));
afterEach(() => vi.useRealTimers());

describe("Ecranul de la ușă (/door)", () => {
  it("arată QR-ul și un inel pornit, sincronizat cu secundele rămase de la server", async () => {
    server.use(qr(() => HttpResponse.json(code(1, 18))));
    renderEmployee("/door");
    await tick(0);

    expect(screen.getByRole("img", { name: /cod qr/i })).toHaveTextContent("cod-1");
    const ring = screen.getByRole("timer");
    expect(ring).toHaveAttribute("data-state", "running");
    // 30 s în total, 18 rămase: animația pornește „în urmă” cu 12 s
    expect(ring.style.getPropertyValue("--door-ring-duration")).toBe("30s");
    expect(ring.style.getPropertyValue("--door-ring-delay")).toBe("-12s");
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
  });

  it("se reîmprospătează singur: la schimbarea codului apare QR-ul nou și inelul pornește de la capăt", async () => {
    let current = code(1, 5);
    server.use(qr(() => HttpResponse.json(current)));
    renderEmployee("/door");
    await tick(0);
    expect(screen.getByRole("img", { name: /cod qr/i })).toHaveTextContent("cod-1");

    current = code(2, 30);
    await tick(6000);

    expect(screen.getByRole("img", { name: /cod qr/i })).toHaveTextContent("cod-2");
    expect(screen.getByRole("timer").style.getPropertyValue("--door-ring-delay")).toBe("-0s");
  });

  it("dacă reîmprospătarea eșuează peste 30 s: inelul se oprește și apare avertismentul", async () => {
    let up = true;
    server.use(qr(() => (up ? HttpResponse.json(code(1, 30)) : HttpResponse.error())));
    renderEmployee("/door");
    await tick(0);

    up = false;
    await tick(25_000);
    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveAttribute("data-state", "running");

    await tick(10_000);
    expect(screen.getByRole("alert")).toHaveTextContent(WARNING);
    expect(screen.getByRole("timer")).toHaveAttribute("data-state", "stopped");
  });

  it("revine singur când reîmprospătarea merge din nou", async () => {
    let up = true;
    server.use(qr(() => (up ? HttpResponse.json(code(1, 30)) : HttpResponse.error())));
    renderEmployee("/door");
    await tick(0);
    up = false;
    await tick(40_000);
    expect(screen.getByRole("alert")).toHaveTextContent(WARNING);

    up = true;
    await tick(10_000);

    expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
    expect(screen.getByRole("timer")).toHaveAttribute("data-state", "running");
  });

  it("dacă nu s-a putut încărca niciun cod, spune asta în loc să arate un ecran gol", async () => {
    server.use(qr(() => HttpResponse.error()));
    renderEmployee("/door");
    await tick(0);

    expect(screen.getByRole("alert")).toHaveTextContent(WARNING);
    expect(screen.queryByRole("img", { name: /cod qr/i })).not.toBeInTheDocument();
  });

  it("telefon neactivat: pagină explicativă, nu mesaj brut", async () => {
    server.use(failing(403, "door_not_configured"));
    renderEmployee("/door");
    await tick(0);

    expect(screen.getByRole("heading", { name: "Telefon neactivat" })).toBeInTheDocument();
    expect(screen.getByText(/Cere Adminului să activeze/i)).toBeInTheDocument();
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });

  it("telefon înlocuit de o nouă Activare: pagină explicativă", async () => {
    server.use(failing(403, "door_token_invalid"));
    renderEmployee("/door");
    await tick(0);

    expect(screen.getByRole("heading", { name: "Acest telefon nu mai este Ecranul de la ușă" })).toBeInTheDocument();
    // la fel de adevărat dacă telefonul a fost înlocuit sau scos din uz de Admin
    expect(screen.getByText(/înlocuit sau scos din uz/)).toBeInTheDocument();
    expect(screen.getByText(/cere adminului un link nou/i)).toBeInTheDocument();
    expect(screen.queryByText(/alt telefon/)).not.toBeInTheDocument();
  });

  it("are logoul GymCtrl", async () => {
    server.use(qr(() => HttpResponse.json(code(1))));
    renderEmployee("/door");
    await tick(0);

    expect(screen.getByAltText("GymCtrl")).toBeInTheDocument();
  });
});
