import { Route, Routes, useSearchParams } from "react-router-dom";
import { Door } from "@/employee/screens/Door";
import { Enroll } from "@/employee/screens/Enroll";
import { Me } from "@/employee/screens/Me";
import { ConnectionCheck } from "@/employee/screens/ConnectionCheck";

/** `/door` în rute (și în teste). În producție pagina `/door` pornește direct din `doorMain.tsx`, fără router. */
function DoorRoute() {
  return <Door setupToken={useSearchParams()[0].get("k")} />;
}

/** Rutele punctului de intrare Angajat (fără router propriu: `appMain.tsx` pune BrowserRouter). */
export function EmployeeRoutes() {
  return (
    <Routes>
      <Route path="/me" element={<Me />} />
      <Route path="/status" element={<ConnectionCheck />} />
      <Route path="/enroll/:token" element={<Enroll />} />
      <Route path="/door" element={<DoorRoute />} />
    </Routes>
  );
}
