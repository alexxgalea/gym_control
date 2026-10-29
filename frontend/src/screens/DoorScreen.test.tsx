import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { IN_HALL_KEY } from "@/lib/queryKeys";
import { createQueryClient } from "@/queryClient";
import { renderApp } from "@/test/render";
import { DoorScreen } from "@/screens/DoorScreen";
import { server } from "@/test/server";

const TZ = "Europe/Bucharest";
const signedIn = http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" }));
const status = (body: object) => http.get("/api/admin/door-screen", () => HttpResponse.json({ timezone: TZ, ...body }));
const issued = http.post("/api/admin/door-screen/activation-link", () =>
  HttpResponse.json({
    link: "http://laptop:8000/door/activate/tok",
    qr_svg: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    hours: 48,
  }),
);

describe("Ecranul de la ușă (Admin)", () => {
  it("neactivat: arată starea și butonul Activează", async () => {
    server.use(signedIn, status({ active: false, activated_at: null }));
    renderApp("/door-screen");

    expect(await screen.findByRole("heading", { name: "Ecranul de la ușă" })).toBeInTheDocument();
    expect(await screen.findByText("Neactivat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Activează" })).toBeInTheDocument();
  });

  it("activ: arată de când", async () => {
    server.use(signedIn, status({ active: true, activated_at: "2026-01-05 10:12" }));
    renderApp("/door-screen");

    expect(await screen.findByText(/Activ din 5 ian.*10:12/)).toBeInTheDocument();
  });

  it("Activează emite linkul cu QR, valabil 48 h, cu copiere", async () => {
    server.use(signedIn, status({ active: false, activated_at: null }), issued);
    const user = userEvent.setup();
    renderApp("/door-screen");

    await user.click(await screen.findByRole("button", { name: "Activează" }));

    expect(await screen.findByRole("img", { name: /cod qr/i })).toBeInTheDocument();
    expect(screen.getByText(/48 de ore/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copiază linkul" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Link copiat");
    expect(await navigator.clipboard.readText()).toBe("http://laptop:8000/door/activate/tok");
  });
  it("Scoate din uz cere confirmare, apoi trimite cererea și arată Neactivat", async () => {
    let active = true;
    let deleted = 0;
    server.use(
      signedIn,
      http.get("/api/admin/door-screen", () =>
        HttpResponse.json({ timezone: TZ, active, activated_at: active ? "2026-01-05 10:12" : null }),
      ),
      http.delete("/api/admin/door-screen", () => {
        deleted += 1;
        active = false;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp("/door-screen");

    await user.click(await screen.findByRole("button", { name: "Scoate din uz" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(/pierdut|furat/i);
    expect(deleted).toBe(0);
    await user.click(screen.getByRole("button", { name: "Anulează" }));
    expect(deleted).toBe(0);

    await user.click(screen.getByRole("button", { name: "Scoate din uz" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Scoate din uz" }));

    expect(await screen.findByText("Neactivat")).toBeInTheDocument();
    expect(deleted).toBe(1);
  });

  it("neactivat: nu oferă Scoate din uz", async () => {
    server.use(signedIn, status({ active: false, activated_at: null }));
    renderApp("/door-screen");

    await screen.findByText("Neactivat");
    expect(screen.queryByRole("button", { name: "Scoate din uz" })).not.toBeInTheDocument();
  });

  it("cu linkul emis, verifică periodic starea: Activarea apare fără reîncărcare", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    try {
      let active = false;
      server.use(
        signedIn,
        http.get("/api/admin/door-screen", () =>
          HttpResponse.json({ timezone: TZ, active, activated_at: active ? "2026-01-05 10:12" : null }),
        ),
        issued,
      );
      const settle = async () => {
        for (let i = 0; i < 5; i += 1) await act(() => vi.advanceTimersByTimeAsync(10));
      };
      render(
        <QueryClientProvider client={createQueryClient()}>
          <MemoryRouter>
            <DoorScreen />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Activează" }));
      await settle();
      expect(screen.getByRole("img", { name: /cod qr/i })).toBeInTheDocument();

      active = true;
      await act(() => vi.advanceTimersByTimeAsync(3000));
      await settle();

      expect(screen.getByText(/Activ din 5 ian.*10:12/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Activarea și Scoaterea din uz invalidează „Acum în Sală” (avertismentul de pe Acasă)", async () => {
    let active = false;
    server.use(
      signedIn,
      http.get("/api/admin/door-screen", () =>
        HttpResponse.json({ timezone: TZ, active, activated_at: active ? "2026-01-05 10:12" : null }),
      ),
      http.delete("/api/admin/door-screen", () => {
        active = false;
        return new HttpResponse(null, { status: 204 });
      }),
      issued,
    );
    const client = createQueryClient();
    client.setQueryData(IN_HALL_KEY, { door_screen_active: false });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <DoorScreen />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "Activează" }));
    await user.click(await screen.findByRole("button", { name: "Gata" }));
    await vi.waitFor(() => expect(client.getQueryState(IN_HALL_KEY)?.isInvalidated).toBe(true));

    client.setQueryData(IN_HALL_KEY, { door_screen_active: true });
    active = true;
    await client.invalidateQueries({ queryKey: ["admin", "door-screen"] });
    await user.click(await screen.findByRole("button", { name: "Scoate din uz" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Scoate din uz" }));
    await vi.waitFor(() => expect(client.getQueryState(IN_HALL_KEY)?.isInvalidated).toBe(true));
  });
});
