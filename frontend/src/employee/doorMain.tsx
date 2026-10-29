import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Door } from "@/employee/screens/Door";

// Fără router: `?k=` apare aici doar când serverul a respins tokenul (altfel redirecționează la `/door`).
const setupToken = new URLSearchParams(window.location.search).get("k");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Door setupToken={setupToken} />
  </StrictMode>,
);
