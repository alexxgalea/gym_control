/** Formatul românesc al datelor și orelor (`05.01.2026, 10:12`), în fusul orar dat (al Sălii, din API). */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ro-RO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(iso));
}
