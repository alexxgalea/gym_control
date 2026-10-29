import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Door } from "@/employee/screens/Door";

// Fără router: pagina `/door` pornește direct ecranul (în rute și teste, `App.tsx` îl montează tot pe `/door`).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Door />
  </StrictMode>,
);
