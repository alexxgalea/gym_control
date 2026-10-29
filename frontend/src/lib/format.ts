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

function describe(at: Parts, today: Parts): string {
  const time = `${two(at.hour)}:${two(at.minute)}`;
  const daysAgo = dayNumber(today) - dayNumber(at);
  if (daysAgo === 0) return `azi, ${time}`;
  if (daysAgo === 1) return `ieri, ${time}`;
  const date = `${at.day} ${MONTHS[at.month - 1]}`;
  return at.year === today.year ? `${date}, ${time}` : `${date} ${at.year}, ${time}`;
}

export function formatDateTime(iso: string, timeZone: string, now: Date = new Date()): string {
  const at = partsInZone(new Date(iso), timeZone);
  const today = partsInZone(now, timeZone);
  return describe(at, today);
}

/** Ca `formatDateTime`, dar pentru o oră locală a Sălii deja calculată de server (`AAAA-LL-ZZ HH:MM`). */
export function formatHallLocal(local: string, timeZone: string, now: Date = new Date()): string {
  const [datePart = "", timePart = ""] = local.split(/[ T]/);
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const at: Parts = { year: year!, month: month!, day: day!, hour: hour!, minute: minute! };
  const today = partsInZone(now, timeZone);
  return describe(at, today);
}
