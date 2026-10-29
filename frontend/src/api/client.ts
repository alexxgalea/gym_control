import type { components } from "./schema";

export type AdminAccount = components["schemas"]["AdminAccount"];
export type LoginRequest = components["schemas"]["LoginRequest"];
export type Employee = components["schemas"]["EmployeeOut"];
export type EmployeeInput = components["schemas"]["EmployeeIn"];
export type Anomaly = components["schemas"]["AnomalyOut"];
export type EnrollLink = components["schemas"]["EnrollLink"];
export type Incident = components["schemas"]["IncidentOut"];
export type IncidentInput = components["schemas"]["IncidentIn"];

/** Eroare a API-ului; `detail` este mesajul în română generat de server, `field` câmpul vizat (dacă e cazul). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public field: string | null = null,
  ) {
    super(detail);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(new URL(path, window.location.origin), {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    let detail = "A apărut o eroare. Încearcă din nou.";
    let field: string | null = null;
    try {
      const data = await response.json();
      if (typeof data?.detail === "string") detail = data.detail;
      if (typeof data?.field === "string") field = data.field;
    } catch {
      // corp non-JSON: rămâne mesajul implicit
    }
    throw new ApiError(response.status, detail, field);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const adminApi = {
  login: (body: LoginRequest) => api<AdminAccount>("/api/admin/login", { method: "POST", body }),
  logout: () => api<void>("/api/admin/logout", { method: "POST" }),
  employees: {
    list: () => api<Employee[]>("/api/admin/employees"),
    create: (body: EmployeeInput) => api<Employee>("/api/admin/employees", { method: "POST", body }),
    enrollLink: (id: number) => api<EnrollLink>(`/api/admin/employees/${id}/enroll-link`, { method: "POST" }),
    revoke: (id: number) => api<void>(`/api/admin/employees/${id}/revoke`, { method: "POST" }),
  },
  anomalies: {
    list: () => api<Anomaly[]>("/api/admin/anomalies"),
    dismiss: (id: number) => api<void>(`/api/admin/anomalies/${id}/dismiss`, { method: "POST" }),
  },
  incidents: {
    list: () => api<Incident[]>("/api/admin/incidents"),
    create: (body: IncidentInput) => api<Incident>("/api/admin/incidents", { method: "POST", body }),
    close: (id: number) => api<Incident>(`/api/admin/incidents/${id}/close`, { method: "POST" }),
  },
  /** Contul curent, sau `null` dacă nu există sesiune (401). */
  me: async (): Promise<AdminAccount | null> => {
    try {
      return await api<AdminAccount>("/api/admin/me");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
};
