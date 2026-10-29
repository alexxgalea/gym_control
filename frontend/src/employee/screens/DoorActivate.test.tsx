import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { goToDoor } from "@/employee/navigation";
import { renderEmployee } from "@/test/renderEmployee";
import { server } from "@/test/server";

vi.mock("@/employee/navigation", () => ({ goToDoor: vi.fn() }));

const linkError = () => HttpResponse.json({ detail: "Link invalid.", reason: "link_invalid" }, { status: 410 });
const BUTTON = "Activează acest telefon";

beforeEach(() => vi.mocked(goToDoor).mockClear());

describe("Activare Ecran de la ușă (/door/activate/:token)", () => {
  it("pune întrebarea și arată un singur buton, fără să consume linkul", async () => {
    let posted = false;
    server.use(
      http.get("/api/employee/door/activate/tok", () => HttpResponse.json({})),
      http.post("/api/employee/door/activate/tok", () => ((posted = true), HttpResponse.json({}))),
    );
    renderEmployee("/door/activate/tok");

    expect(await screen.findByText("Activezi acest telefon ca Ecran de la ușă?")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(posted).toBe(false);
    expect(goToDoor).not.toHaveBeenCalled();
  });

  it("la apăsare consumă linkul și duce telefonul la /door", async () => {
    server.use(
      http.get("/api/employee/door/activate/tok", () => HttpResponse.json({})),
      http.post("/api/employee/door/activate/tok", () => HttpResponse.json({})),
    );
    renderEmployee("/door/activate/tok");

    await userEvent.click(await screen.findByRole("button", { name: BUTTON }));

    await vi.waitFor(() => expect(goToDoor).toHaveBeenCalledTimes(1));
  });

  it("link nevalabil: cere un link nou, fără buton", async () => {
    server.use(http.get("/api/employee/door/activate/tok", linkError));
    renderEmployee("/door/activate/tok");

    expect(await screen.findByText(/Cere Adminului un link nou/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("în afara rețelei Sălii: arată mesajul serverului și rămâne pe pagină", async () => {
    server.use(
      http.get("/api/employee/door/activate/tok", () => HttpResponse.json({})),
      http.post("/api/employee/door/activate/tok", () =>
        HttpResponse.json({ detail: "Conectează-te la Wi-Fi-ul Sălii.", reason: "not_in_hall_network" }, { status: 403 }),
      ),
    );
    renderEmployee("/door/activate/tok");

    await userEvent.click(await screen.findByRole("button", { name: BUTTON }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Conectează-te la Wi-Fi-ul Sălii.");
    expect(goToDoor).not.toHaveBeenCalled();
  });
});
