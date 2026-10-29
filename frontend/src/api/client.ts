import type { components } from "./schema";

export type AdminAccount = components["schemas"]["AdminAccount"];
export type LoginRequest = components["schemas"]["LoginRequest"];
export type Employee = components["schemas"]["EmployeeOut"];
export type EmployeeInput = components["schemas"]["EmployeeIn"];
export type Anomaly = components["schemas"]["AnomalyOut"];
export type InHall = components["schemas"]["InHallOut"];
export type InHallPerson = components["schemas"]["InHallPerson"];
export type EnrollLink = components["schemas"]["EnrollLink"];
export type Incident = components["schemas"]["IncidentOut"];
export type IncidentInput = components["schemas"]["IncidentIn"];
export type HallSettings = components["schemas"]["SettingsOut"];
export type NetworkSuggestion = components["schemas"]["NetworkSuggestion"];
export type HallSettingsInput = components["schemas"]["SettingsIn"];
export type ImportReport = components["schemas"]["ImportReport"];
export type Report = components["schemas"]["ReportOut"];
export type JournalEntry = components["schemas"]["JournalEntryOut"];
export type JournalPage = components["schemas"]["JournalPageOut"];
export type JournalKind = components["schemas"]["KindOption"];
export type ManualSessionInput = components["schemas"]["SessionIn"];
export type SessionCorrectionInput = components["schemas"]["SessionCorrection"];
/** Filtrele Jurnalului (zilele `AAAA-LL-ZZ`, în ora Sălii); câmpurile goale sau lipsă nu filtrează. */
export type JournalFilters = { employee?: string; from?: string; to?: string; kind?: string; page?: number };

/** Mesajul implicit când serverul nu trimite unul. */
export const GENERIC_ERROR = "A apărut o eroare. Încearcă din nou.";

/** Eroare de validare a unui câmp, ca în corpul 400 al serverului. */
export type FieldError = { field: string; detail: string };

/** Eroare a API-ului; `detail` este mesajul în română generat de server, `field` câmpul vizat (dacă e cazul). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
    public field: string | null = null,
    public errors: FieldError[] = [],
  ) {
    super(detail);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(new URL(path, window.location.origin), {
    method: init.method ?? "GET",
    credentials: "same-origin",
    // FormData: browserul pune singur Content-Type multipart cu delimitatorul
    headers: init.body === undefined || init.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined || init.body instanceof FormData ? (init.body as FormData | undefined) : JSON.stringify(init.body),
  });
  if (!response.ok) {
    let detail = GENERIC_ERROR;
    let field: string | null = null;
    let errors: FieldError[] = [];
    try {
      const data = await response.json();
      if (typeof data?.detail === "string") detail = data.detail;
      if (typeof data?.field === "string") field = data.field;
      if (Array.isArray(data?.errors)) errors = data.errors;
    } catch {
      // corp non-JSON: rămâne mesajul implicit
    }
    throw new ApiError(response.status, detail, field, errors);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Parametrii intervalului unui Raport, ca în adresa API-ului și a variantei tipărite. */
export const reportQuery = (from: string, to: string) => new URLSearchParams({ from, to }).toString();

export const adminApi = {
  login: (body: LoginRequest) => api<AdminAccount>("/api/admin/login", { method: "POST", body }),
  logout: () => api<void>("/api/admin/logout", { method: "POST" }),
  employees: {
    list: () => api<Employee[]>("/api/admin/employees"),
    create: (body: EmployeeInput) => api<Employee>("/api/admin/employees", { method: "POST", body }),
    importCsv: (file: File) => {
      const body = new FormData();
      body.append("file", file);
      return api<ImportReport>("/api/admin/employees/import", { method: "POST", body });
    },
    enrollLink: (id: number) => api<EnrollLink>(`/api/admin/employees/${id}/enroll-link`, { method: "POST" }),
    revoke: (id: number) => api<void>(`/api/admin/employees/${id}/revoke`, { method: "POST" }),
  },
  journal: {
    list: (filters: JournalFilters = {}) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, String(value));
      const text = query.toString();
      return api<JournalPage>(`/api/admin/journal${text ? `?${text}` : ""}`);
    },
    kinds: () => api<JournalKind[]>("/api/admin/journal/kinds"),
  },
  sessions: {
    /** Sesiune manuală nouă (închisă); orele în ora locală a Sălii (`YYYY-MM-DDTHH:MM`). */
    create: (body: ManualSessionInput) => api<{ id: number }>("/api/admin/sessions", { method: "POST", body }),
    /** Închide o Sesiune deschisă cu o Ieșire manuală. */
    correct: (id: number, body: SessionCorrectionInput) =>
      api<void>(`/api/admin/sessions/${id}/correct`, { method: "POST", body }),
  },
  /** „Acum în Sală”: Sesiunile de azi fără Ieșire. */
  inHall: () => api<InHall>("/api/admin/in-hall"),
  anomalies: {
    list: () => api<Anomaly[]>("/api/admin/anomalies"),
    dismiss: (id: number) => api<void>(`/api/admin/anomalies/${id}/dismiss`, { method: "POST" }),
  },
  incidents: {
    list: () => api<Incident[]>("/api/admin/incidents"),
    create: (body: IncidentInput) => api<Incident>("/api/admin/incidents", { method: "POST", body }),
    close: (id: number) => api<Incident>(`/api/admin/incidents/${id}/close`, { method: "POST" }),
  },
  settings: {
    get: () => api<HallSettings>("/api/admin/settings"),
    save: (body: HallSettingsInput) => api<HallSettings>("/api/admin/settings", { method: "PUT", body }),
    /** Rețeaua calculată din conexiunea curentă; doar o sugestie, nu se salvează. */
    networkSuggestion: () => api<NetworkSuggestion>("/api/admin/settings/network-suggestion"),
  },
  reports: {
    /** Generează (și înscrie în Jurnal) Raportul pe intervalul dat, în ora locală (`YYYY-MM-DDTHH:MM`). */
    generate: (from: string, to: string) => api<Report>(`/api/admin/reports?${reportQuery(from, to)}`),
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
