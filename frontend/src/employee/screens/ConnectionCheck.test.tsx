import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { renderEmployee } from "@/test/renderEmployee";
import { server } from "@/test/server";

const status = (body: { in_hall: boolean; server_time: string; time_zone?: string }) =>
  http.get("/api/employee/status", () => HttpResponse.json({ time_zone: "Europe/Bucharest", ...body }));

describe("Verificare conexiune", () => {
  it("arată logoul, că telefonul e în rețeaua Sălii și ora serverului formatată", async () => {
    // 08:12 UTC = 10:12 în ora Sălii (iarna)
    server.use(status({ in_hall: true, server_time: "2026-01-05T08:12:00+00:00" }));
    renderEmployee("/status");

    expect(await screen.findByRole("heading", { name: "Verificare conexiune" })).toBeInTheDocument();
    expect(screen.getByAltText("GymCtrl")).toBeInTheDocument();
    expect(await screen.findByText("Ești în rețeaua Sălii")).toBeInTheDocument();
    expect(screen.getByText("azi, 10:12")).toBeInTheDocument();
    expect(screen.queryByText(/\+00:00|Stare: ok/)).not.toBeInTheDocument();
  });

  it("spune să te conectezi la Wi-Fi-ul Sălii când telefonul e în afara rețelei", async () => {
    server.use(status({ in_hall: false, server_time: "2026-01-05T08:12:00+00:00" }));
    renderEmployee("/status");

    expect(await screen.findByText("Nu ești în rețeaua Sălii")).toBeInTheDocument();
    expect(screen.getByText(/Conectează-te la Wi-Fi-ul Sălii/)).toBeInTheDocument();
  });

  it("arată mesajul serverului când cererea eșuează", async () => {
    server.use(
      http.get("/api/employee/status", () =>
        HttpResponse.json({ detail: "Eroare internă.", reason: "x" }, { status: 500 }),
      ),
    );
    renderEmployee("/status");

    expect(await screen.findByRole("alert")).toHaveTextContent("Eroare internă.");
  });
});
