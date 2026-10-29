import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { renderApp } from "@/test/render";

type Report = { created: number; errors: string[] };

/** API simulat: lista (cu un contor de apeluri) și importul CSV, la granița HTTP. */
function mockApi(respond: () => Response | Promise<Response>) {
  const uploads: { name: string; text: string }[] = [];
  let lists = 0;
  // fetch-ul din Node nu poate serializa File-ul din jsdom, deci corpul se verifică înainte de trimitere
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (init?.body instanceof FormData) {
      const file = init.body.get("file") as File;
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader(); // jsdom nu are Blob.text()
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(file);
      });
      uploads.push({ name: file.name, text });
      expect(init.headers).toBeUndefined(); // Content-Type multipart îl pune browserul
      init = { ...init, body: undefined };
    }
    return realFetch(input, init);
  });
  server.use(
    http.get("/api/admin/me", () => HttpResponse.json({ username: "admin" })),
    http.get("/api/admin/employees", () => {
      lists += 1;
      return HttpResponse.json([]);
    }),
    http.post("/api/admin/employees/import", () => {
      return respond();
    }),
  );
  return { uploads, lists: () => lists };
}

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  renderApp("/employees");
  await user.click(await screen.findByRole("button", { name: "Importă listă din Excel" }));
  return await screen.findByRole("dialog");
}

describe("import listă din Excel pe ecranul Angajați", () => {
  it("trimite fișierul multipart, arată câți s-au importat și rândurile respinse cu numărul rândului", async () => {
    const report: Report = { created: 2, errors: ["Rândul 3: email invalid.", "Rândul 7: se așteaptă două coloane (nume, email)."] };
    const api = mockApi(() => HttpResponse.json(report));
    const user = userEvent.setup();
    const dialog = await openImport(user);
    const initialLists = api.lists();
    expect(dialog).toHaveTextContent(/nume și email/); // explică simplu coloanele

    const csv = new File(["nume,email\nAna,ana@firma.ro\n"], "angajati.csv", { type: "text/csv" });
    await user.upload(within(dialog).getByLabelText("Fișierul cu lista"), csv);
    await user.click(within(dialog).getByRole("button", { name: "Importă Angajații" }));

    expect(await within(dialog).findByText("2 Angajați importați")).toBeInTheDocument();
    expect(within(dialog).getByText("Rândul 3: email invalid.")).toBeInTheDocument();
    expect(within(dialog).getByText("Rândul 7: se așteaptă două coloane (nume, email).")).toBeInTheDocument();
    expect(within(dialog).getByText(/2 rânduri respinse/)).toBeInTheDocument();
    expect(api.uploads).toEqual([{ name: "angajati.csv", text: "nume,email\nAna,ana@firma.ro\n" }]);
    await waitFor(() => expect(api.lists()).toBeGreaterThan(initialLists)); // lista se reîncarcă
  });

  it("fără rânduri respinse nu arată lista de erori", async () => {
    mockApi(() => HttpResponse.json({ created: 1, errors: [] }));
    const user = userEvent.setup();
    const dialog = await openImport(user);
    await user.upload(within(dialog).getByLabelText("Fișierul cu lista"), new File(["nume,email\nA,a@b.ro\n"], "a.csv"));
    await user.click(within(dialog).getByRole("button", { name: "Importă Angajații" }));
    expect(await within(dialog).findByText("1 Angajat importat")).toBeInTheDocument();
    expect(within(dialog).queryByText(/respinse/)).not.toBeInTheDocument();
  });

  it("arată eroarea de antet a serverului și lasă dialogul deschis pentru alt fișier", async () => {
    mockApi(() => HttpResponse.json({ detail: "Lipsește antetul „nume,email” pe primul rând." }, { status: 400 }));
    const user = userEvent.setup();
    const dialog = await openImport(user);
    await user.upload(within(dialog).getByLabelText("Fișierul cu lista"), new File(["foo,bar\n"], "gresit.csv"));
    await user.click(within(dialog).getByRole("button", { name: "Importă Angajații" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Lipsește antetul „nume,email” pe primul rând.");
    expect(within(dialog).getByRole("button", { name: "Importă Angajații" })).toBeEnabled();
  });

  it("nu trimite nimic fără fișier ales", async () => {
    const api = mockApi(() => HttpResponse.json({ created: 0, errors: [] }));
    const user = userEvent.setup();
    const dialog = await openImport(user);
    await user.click(within(dialog).getByRole("button", { name: "Importă Angajații" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Alege un fișier cu lista.");
    expect(api.uploads).toEqual([]);
  });
});
