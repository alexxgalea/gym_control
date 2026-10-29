import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

type Values = { hall_subnet: string; opening_time: string; closing_time: string; retention_months: number };
const DEFAULTS: Values = { hall_subnet: "192.168.10.0/24", opening_time: "06:00", closing_time: "22:00", retention_months: 12 };

type Suggestion = { address: string; network: string | null; message: string | null };

/** API-ul Setărilor simulat; `rejectWith` face PUT-ul să întoarcă erori de validare ca serverul. */
function mockApi(options: { loadDelay?: number; rejectWith?: { field: string; detail: string }[]; suggestion?: Suggestion } = {}) {
  const puts: unknown[] = [];
  server.use(
    http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
    http.get("/api/admin/settings", async () => {
      if (options.loadDelay) await delay(options.loadDelay);
      return HttpResponse.json(DEFAULTS);
    }),
    http.get("/api/admin/settings/network-suggestion", () =>
      HttpResponse.json(options.suggestion ?? { address: "10.20.30.40", network: "10.20.30.0/24", message: null }),
    ),
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
  it("arată schelet la încărcare, apoi trei secțiuni cu explicații și valorile curente", async () => {
    mockApi({ loadDelay: 20 });
    renderApp("/settings");
    expect(await screen.findByRole("status", { name: "Se încarcă" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Rețeaua Wi-Fi a Sălii")).toHaveValue("192.168.10.0/24");
    expect(screen.getByLabelText("Ora de deschidere")).toHaveValue("06:00");
    expect(screen.getByLabelText("Ora de închidere")).toHaveValue("22:00");
    expect(screen.getByLabelText("Perioadă de păstrare")).toHaveValue("12");
    expect(screen.getByRole("heading", { name: "Setări" })).toBeInTheDocument();
    for (const title of ["Programul Sălii", "Păstrarea datelor", "Avansat"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText("luni")).toBeInTheDocument();
  });

  it("alege orele cu selectoare de oră", async () => {
    mockApi();
    renderApp("/settings");
    expect(await screen.findByLabelText("Ora de deschidere")).toHaveAttribute("type", "time");
    expect(screen.getByLabelText("Ora de închidere")).toHaveAttribute("type", "time");
  });

  it("salvează valorile modificate și confirmă cu toast", async () => {
    const puts = mockApi();
    const user = userEvent.setup();
    renderApp("/settings");
    const subnet = await screen.findByLabelText("Rețeaua Wi-Fi a Sălii");
    await user.clear(subnet);
    await user.type(subnet, "10.0.0.0/24");
    await user.clear(screen.getByLabelText("Ora de închidere"));
    await user.type(screen.getByLabelText("Ora de închidere"), "21:15");
    await user.click(screen.getByRole("button", { name: "Salvează" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Setările au fost salvate.");
    expect(puts).toEqual([
      { hall_subnet: "10.0.0.0/24", opening_time: "06:00", closing_time: "21:15", retention_months: "12" },
    ]);
  });

  it("arată fiecare eroare a serverului lângă câmpul ei și păstrează ce a scris Adminul", async () => {
    mockApi({
      rejectWith: [
        { field: "hall_subnet", detail: "Rețeaua Wi-Fi a Sălii nu e validă." },
        { field: "retention_months", detail: "Păstrarea datelor nu e validă." },
      ],
    });
    const user = userEvent.setup();
    renderApp("/settings");
    const subnet = await screen.findByLabelText("Rețeaua Wi-Fi a Sălii");
    await user.clear(subnet);
    await user.type(subnet, "nu-e-ip");
    await user.click(screen.getByRole("button", { name: "Salvează" }));

    await waitFor(() => expect(subnet).toHaveAccessibleDescription("Rețeaua Wi-Fi a Sălii nu e validă."));
    expect(subnet).toHaveValue("nu-e-ip");
    expect(screen.getByLabelText("Perioadă de păstrare")).toHaveAccessibleDescription("Păstrarea datelor nu e validă.");
    expect(screen.getByLabelText("Ora de deschidere")).not.toHaveAccessibleDescription(/./);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  describe("sugestia de rețea", () => {
    it("completează câmpul, dar nu salvează nimic", async () => {
      const puts = mockApi();
      const user = userEvent.setup();
      renderApp("/settings");
      await user.click(await screen.findByRole("button", { name: "Folosește rețeaua la care sunt conectat acum" }));
      await waitFor(() => expect(screen.getByLabelText("Rețeaua Wi-Fi a Sălii")).toHaveValue("10.20.30.0/24"));
      expect(screen.getByText(/10\.20\.30\.40/)).toBeInTheDocument();
      expect(puts).toEqual([]);
    });

    it("arată mesajul pe înțeles când nu există sugestie și lasă câmpul neschimbat", async () => {
      mockApi({
        suggestion: { address: "2001:db8::1", network: null, message: "Nu putem completa rețeaua automat din această conexiune." },
      });
      const user = userEvent.setup();
      renderApp("/settings");
      await user.click(await screen.findByRole("button", { name: "Folosește rețeaua la care sunt conectat acum" }));
      expect(await screen.findByText("Nu putem completa rețeaua automat din această conexiune.")).toBeInTheDocument();
      expect(screen.getByLabelText("Rețeaua Wi-Fi a Sălii")).toHaveValue("192.168.10.0/24");
    });
  });

  describe("Păstrarea datelor", () => {
    it("cere confirmare când valoarea scade: spune că datele mai vechi se șterg și nu salvează la anulare", async () => {
      const puts = mockApi();
      const user = userEvent.setup();
      renderApp("/settings");
      const months = await screen.findByLabelText("Perioadă de păstrare");
      await user.clear(months);
      await user.type(months, "6");
      await user.click(screen.getByRole("button", { name: "Salvează" }));

      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveTextContent(/datele mai vechi de 6 luni se vor șterge/i);
      await user.click(within(dialog).getByRole("button", { name: "Anulează" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(puts).toEqual([]);

      await user.click(screen.getByRole("button", { name: "Salvează" }));
      await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Salvează și șterge/ }));
      expect(await screen.findByRole("status")).toHaveTextContent("Setările au fost salvate.");
      expect(puts).toEqual([
        { hall_subnet: "192.168.10.0/24", opening_time: "06:00", closing_time: "22:00", retention_months: "6" },
      ]);
    });

    it("nu cere confirmare la creștere", async () => {
      const puts = mockApi();
      const user = userEvent.setup();
      renderApp("/settings");
      const months = await screen.findByLabelText("Perioadă de păstrare");
      await user.clear(months);
      await user.type(months, "24");
      await user.click(screen.getByRole("button", { name: "Salvează" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Setările au fost salvate.");
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(puts).toHaveLength(1);
    });

    it("compară cu valoarea salvată, nu cu cea din câmp: după scurtare, aceeași valoare nu mai cere confirmare", async () => {
      const puts = mockApi();
      const user = userEvent.setup();
      renderApp("/settings");
      const months = await screen.findByLabelText("Perioadă de păstrare");
      await user.clear(months);
      await user.type(months, "6");
      await user.click(screen.getByRole("button", { name: "Salvează" }));
      await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: /Salvează și șterge/ }));
      await waitFor(() => expect(puts).toHaveLength(1));
      await screen.findByRole("status");

      await user.click(screen.getByRole("button", { name: "Salvează" }));
      await waitFor(() => expect(puts).toHaveLength(2));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
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
    expect(await screen.findByRole("button", { name: "Intră în cont" })).toBeInTheDocument();
  });
});
