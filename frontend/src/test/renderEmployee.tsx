import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EmployeeRoutes } from "@/employee/App";

/** Randează punctul de intrare Angajat (rute + provider-e) la o cale dată, ca și cum telefonul ar fi acolo. */
export function renderEmployee(path = "/status") {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <EmployeeRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
