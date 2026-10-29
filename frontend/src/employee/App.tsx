import { Route, Routes } from "react-router-dom";
import { Enroll } from "@/employee/screens/Enroll";
import { ConnectionCheck } from "@/employee/screens/ConnectionCheck";

/**
 * Rutele punctului de intrare Angajat (fără router propriu: `main.tsx` pune BrowserRouter).
 * Fiecare tichet adaugă aici adresa lui (`/me`, `/enroll/:token`, `/door`).
 */
export function EmployeeRoutes() {
  return (
    <Routes>
      <Route path="/status" element={<ConnectionCheck />} />
      <Route path="/enroll/:token" element={<Enroll />} />
    </Routes>
  );
}
