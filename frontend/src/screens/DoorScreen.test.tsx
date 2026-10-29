import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderApp } from "@/test/render";
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
});
