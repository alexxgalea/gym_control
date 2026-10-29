import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

type Values = { hall_subnet: string; opening_time: string; closing_time: string; retention_months: number };
const DEFAULTS: Values = { hall_subnet: "192.168.10.0/24", opening_time: "06:00", closing_time: "22:00", retention_months: 12 };

/** API-ul Setărilor simulat; `rejectWith` face PUT-ul să întoarcă erori de validare ca serverul. */
function mockApi(options: { loadDelay?: number; rejectWith?: { field: string; detail: string }[] } = {}) {
  const puts: unknown[] = [];
  server.use(
    http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
    http.get("/api/admin/settings", async () => {
      if (options.loadDelay) await delay(options.loadDelay);
      return HttpResponse.json(DEFAULTS);
    }),
    http.put("/api/admin/settings", async ({ request }) => {
      const body = (await request.json()) as Record<string, string>;
      puts.push(body);
      if (options.rejectWith) {
        const first = options.rejectWith[0]!;
        return HttpResponse.json({ detail: first.detail, field: first.field, errors: options.rejectWith }, { status: 400 });
      }
      return HttpResponse.json({ ...body, retention_months: Number(body.retention_months) });
    }),
  );
  return puts;
}

describe("ecranul Setări", () => {
  it("arată stare de încărcare, apoi valorile curente în câmpuri", async () => {
    mockApi({ loadDelay: 20 });
    renderApp("/settings");
    expect(await screen.findByText("Se încarcă…")).toBeInTheDocument();
    expect(await screen.findByLabelText(/Subrețeaua Sălii/)).toHaveValue("192.168.10.0/24");
    expect(screen.getByLabelText(/Ora de deschidere/)).toHaveValue("06:00");
    expect(screen.getByLabelText(/Ora de închidere/)).toHaveValue("22:00");
    expect(screen.getByLabelText(/Perioada de retenție/)).toHaveValue("12");
    expect(screen.getByRole("heading", { name: "Setări" })).toBeInTheDocument();
  });

  it("salvează valorile modificate și confirmă cu toast", async () => {
    const puts = mockApi();
    const user = userEvent.setup();
    renderApp("/settings");
    const subnet = await screen.findByLabelText(/Subrețeaua Sălii/);
    await user.clear(subnet);
    await user.type(subnet, "10.0.0.0/24");
    const closing = screen.getByLabelText(/Ora de închidere/);
    await user.clear(closing);
    await user.type(closing, "21:15");
    await user.click(screen.getByRole("button", { name: "Salvează" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Setările au fost salvate.");
    expect(puts).toEqual([
      { hall_subnet: "10.0.0.0/24", opening_time: "06:00", closing_time: "21:15", retention_months: "12" },
    ]);
  });

  it("arată fiecare eroare a serverului lângă câmpul ei și păstrează ce a scris Adminul", async () => {
    mockApi({
      rejectWith: [
        { field: "hall_subnet", detail: "Subrețea invalidă: folosește notația CIDR, de exemplu 192.168.10.0/24." },
        { field: "retention_months", detail: "Perioada de retenție invalidă: introdu un număr întreg pozitiv de luni, de exemplu 12." },
      ],
    });
    const user = userEvent.setup();
    renderApp("/settings");
    const subnet = await screen.findByLabelText(/Subrețeaua Sălii/);
    await user.clear(subnet);
    await user.type(subnet, "nu-e-ip");
    await user.click(screen.getByRole("button", { name: "Salvează" }));

    await waitFor(() => expect(subnet).toHaveAccessibleDescription(/Subrețea invalidă/));
    expect(subnet).toHaveValue("nu-e-ip");
    expect(screen.getByLabelText(/Perioada de retenție/)).toHaveAccessibleDescription(/Perioada de retenție invalidă/);
    expect(screen.getByLabelText(/Ora de deschidere/)).not.toHaveAccessibleDescription(/invalid/);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("arată eroarea când setările nu se pot încărca", async () => {
    server.use(
      http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
      http.get("/api/admin/settings", () => HttpResponse.json({ detail: "Eroare internă." }, { status: 500 })),
    );
    renderApp("/settings");
    expect(await screen.findByRole("alert")).toHaveTextContent("Eroare internă.");
  });

  it("duce la login când sesiunea a expirat", async () => {
    server.use(
      http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
      http.get("/api/admin/settings", () => HttpResponse.json({ detail: "Sesiune lipsă sau expirată." }, { status: 401 })),
    );
    renderApp("/settings");
    expect(await screen.findByRole("button", { name: "Intră" })).toBeInTheDocument();
  });
});
