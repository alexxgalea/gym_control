import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { renderEmployee } from "@/test/renderEmployee";
import { server } from "@/test/server";

const linkError = () => HttpResponse.json({ detail: "Link invalid.", reason: "link_invalid" }, { status: 410 });

describe("Activare telefon", () => {
  it("arată numele Angajatului, avertismentul și un singur buton", async () => {
    server.use(http.get("/api/employee/enroll/tok", () => HttpResponse.json({ name: "Ana Pop" })));
    renderEmployee("/enroll/tok");

    expect(await screen.findByText("Ana Pop")).toBeInTheDocument();
    expect(screen.getByText(/telefon activat anterior nu va mai funcționa/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Activează acest telefon" })).toBeInTheDocument();
  });

  it("după activare arată confirmarea și pasul următor", async () => {
    server.use(
      http.get("/api/employee/enroll/tok", () => HttpResponse.json({ name: "Ana Pop" })),
      http.post("/api/employee/enroll/tok", () => HttpResponse.json({ name: "Ana Pop" })),
    );
    renderEmployee("/enroll/tok");

    await userEvent.click(await screen.findByRole("button", { name: "Activează acest telefon" }));

    expect(await screen.findByText("Telefonul tău este activat")).toBeInTheDocument();
    expect(screen.getByText("Scanează codul de la ușă ca să faci Intrare")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("pentru un link nevalabil spune să ceri Adminului un link nou", async () => {
    server.use(http.get("/api/employee/enroll/tok", linkError));
    renderEmployee("/enroll/tok");

    expect(await screen.findByText(/Cere Adminului un link nou/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("dacă linkul a devenit nevalabil la activare, spune să ceri un link nou", async () => {
    server.use(
      http.get("/api/employee/enroll/tok", () => HttpResponse.json({ name: "Ana Pop" })),
      http.post("/api/employee/enroll/tok", linkError),
    );
    renderEmployee("/enroll/tok");

    await userEvent.click(await screen.findByRole("button", { name: "Activează acest telefon" }));
    expect(await screen.findByText(/Cere Adminului un link nou/)).toBeInTheDocument();
  });

  it("în afara rețelei Sălii spune să te conectezi la Wi-Fi și lasă butonul pentru o nouă încercare", async () => {
    server.use(
      http.get("/api/employee/enroll/tok", () => HttpResponse.json({ name: "Ana Pop" })),
      http.post("/api/employee/enroll/tok", () =>
        HttpResponse.json({ detail: "Conectează-te la Wi-Fi-ul Sălii.", reason: "not_in_hall_network" }, { status: 403 }),
      ),
    );
    renderEmployee("/enroll/tok");

    await userEvent.click(await screen.findByRole("button", { name: "Activează acest telefon" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conectează-te la Wi-Fi-ul Sălii");
    expect(screen.getByRole("button", { name: "Activează acest telefon" })).toBeEnabled();
  });
});
