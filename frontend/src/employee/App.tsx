import { Route, Routes } from "react-router-dom";
import { Door } from "@/employee/screens/Door";
import { DoorActivate } from "@/employee/screens/DoorActivate";
import { Enroll } from "@/employee/screens/Enroll";
import { Me } from "@/employee/screens/Me";
import { ConnectionCheck } from "@/employee/screens/ConnectionCheck";

/** Rutele punctului de intrare Angajat (fără router propriu: `appMain.tsx` pune BrowserRouter). */
export function EmployeeRoutes() {
  return (
    <Routes>
      <Route path="/me" element={<Me />} />
      <Route path="/status" element={<ConnectionCheck />} />
      <Route path="/enroll/:token" element={<Enroll />} />
      <Route path="/door" element={<Door />} />
      <Route path="/door/activate/:token" element={<DoorActivate />} />
    </Routes>
  );
}
