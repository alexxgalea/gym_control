import { setupServer } from "msw/node";

/** API-ul simulat la granița HTTP; fiecare test își declară handler-ele cu `server.use(...)`. */
export const server = setupServer();
