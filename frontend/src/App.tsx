import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "@/auth";
import { Shell, SCREENS } from "@/screens/Shell";
import { Placeholder } from "@/screens/Placeholder";
import { Login } from "@/screens/Login";
import { Employees } from "@/screens/Employees";
import { Anomalies } from "@/screens/Anomalies";
import { Incidents } from "@/screens/Incidents";
import { Settings } from "@/screens/Settings";

/**
 * Rutele aplicației (fără router propriu: `main.tsx` pune BrowserRouter cu basename `/admin`).
 * Un ecran nou: adaugă-l în `SCREENS` (navigare) și înlocuiește `Placeholder`-ul lui cu ecranul real.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/employees" replace />} />
          <Route path="employees" element={<Employees />} />
          <Route path="anomalies" element={<Anomalies />} />
          <Route path="incidents" element={<Incidents />} />
          <Route path="settings" element={<Settings />} />
          {SCREENS.filter((screen) => !["employees", "anomalies", "incidents", "settings"].includes(screen.path)).map((screen) => (
            <Route key={screen.path} path={screen.path} element={<Placeholder title={screen.label} />} />
          ))}
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
