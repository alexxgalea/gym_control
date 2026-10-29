/**
 * Clientul API-ului Angajatului. Separat de cel al Adminului, ca punctul de intrare Angajat să nu includă cod Admin.
 * Erorile au forma `{detail, reason}`: `reason` e codul stabil după care interfața alege ecranul.
 */
import type { components } from "@/api/schema";

export type ConnectionStatus = components["schemas"]["ConnectionStatus"];

export type Enrollment = components["schemas"]["EnrollmentOut"];

export const GENERIC_ERROR = "A apărut o eroare. Încearcă din nou.";

export class EmployeeApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public reason: string | null = null,
  ) {
    super(detail);
  }
}

async function request<T>(path: string, method: "GET" | "POST"): Promise<T> {
  const response = await fetch(new URL(path, window.location.origin), { method, credentials: "same-origin" });
  if (!response.ok) {
    let detail = GENERIC_ERROR;
    let reason: string | null = null;
    try {
      const data = await response.json();
      if (typeof data?.detail === "string") detail = data.detail;
      if (typeof data?.reason === "string") reason = data.reason;
    } catch {
      // corp non-JSON: rămâne mesajul implicit
    }
    throw new EmployeeApiError(response.status, detail, reason);
  }
  return (await response.json()) as T;
}

const get = <T>(path: string) => request<T>(path, "GET");
const post = <T>(path: string) => request<T>(path, "POST");

export const employeeApi = {
  status: () => get<ConnectionStatus>("/api/employee/status"),
  enrollmentLink: (token: string) => get<Enrollment>(`/api/employee/enroll/${encodeURIComponent(token)}`),
  activatePhone: (token: string) => post<Enrollment>(`/api/employee/enroll/${encodeURIComponent(token)}`),
};
