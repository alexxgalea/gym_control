import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

/**
 * Semnalele din meniul Adminului (cine e în Sală, Anomalii, Incidente) se cer pe orice ecran; implicit Sala e goală.
 * Un test care are nevoie de alte date le suprascrie cu `server.use(...)`.
 */
const hallSignals = [
  http.get("/api/admin/in-hall", () =>
    HttpResponse.json({ people: [], door_screen_active: true, timezone: "Europe/Bucharest" }),
  ),
  http.get("/api/admin/anomalies", () => HttpResponse.json([])),
  http.get("/api/admin/incidents", () => HttpResponse.json([])),
];

/** API-ul simulat la granița HTTP; fiecare test își declară handler-ele cu `server.use(...)`. */
export const server = setupServer(...hallSignals);
