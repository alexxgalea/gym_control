/**
 * Singurul loc în care se formatează datele și orele pentru ecran.
 * Formatul: „azi, 10:12”, „ieri, 18:40”, „5 ian., 10:12”; anul apare doar dacă diferă de cel curent.
 * Ora e mereu cea a Sălii (fusul dat, din API), nu cea a browserului; nu se afișează UTC sau ISO.
 */
const MONTHS = ["ian.", "feb.", "mar.", "apr.", "mai", "iun.", "iul.", "aug.", "sept.", "oct.", "nov.", "dec."];

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function partsInZone(date: Date, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute") };
}

const dayNumber = (p: Parts) => Math.round(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
const two = (n: number) => String(n).padStart(2, "0");

function render(at: Parts, today: Parts): string {
  const time = `${two(at.hour)}:${two(at.minute)}`;
  const daysAgo = dayNumber(today) - dayNumber(at);
  if (daysAgo === 0) return `azi, ${time}`;
  if (daysAgo === 1) return `ieri, ${time}`;
  const date = `${at.day} ${MONTHS[at.month - 1]}`;
  return at.year === today.year ? `${date}, ${time}` : `${date} ${at.year}, ${time}`;
}

/** Un moment (ISO cu fus) scris în ora Sălii. */
export function formatDateTime(iso: string, timeZone: string, now: Date = new Date()): string {
  return render(partsInZone(new Date(iso), timeZone), partsInZone(now, timeZone));
}

/** Un moment deja în ora Sălii (`AAAA-LL-ZZ HH:MM`, cum îl dau Anomaliile); fusul e doar pentru „azi”/„ieri”. */
export function formatLocalDateTime(local: string, timeZone: string, now: Date = new Date()): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(local);
  if (!match) return local;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  return render({ year, month, day, hour, minute }, partsInZone(now, timeZone));
}

/** Doar ora („17:42”) dintr-un moment deja în ora Sălii (`AAAA-LL-ZZ HH:MM`). */
export function formatLocalTime(local: string): string {
  return /^\d{4}-\d{2}-\d{2}[ T](\d{2}:\d{2})/.exec(local)?.[1] ?? local;
}

/** O durată în minute: „35 min”, „1 h”, „2 h 5 min”. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const rest = total % 60;
  return rest === 0 ? `${total / 60} h` : `${Math.floor(total / 60)} h ${rest} min`;
}
